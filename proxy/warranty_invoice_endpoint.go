package main

// Invoice PDF for a warranty/AMC cover record, kept in the record's
// "Invoice PDF" attachment column in NocoDB.
//
//   GET    /api/warranty/invoice?id=N              streams the PDF (inline; &download=1 to save)
//   POST   /api/warranty/invoice?id=N  (multipart "file")  uploads, replacing any existing one
//   DELETE /api/warranty/invoice?id=N              removes it from the record
//
// Why a dedicated endpoint rather than the generic /proxy/ path:
//   - the browser never sees NocoDB's host or token, and the file is streamed
//     back through here, so an HTTPS page never links to NocoDB's plain-HTTP port;
//   - NocoDB 0.265's v3 data API cannot write attachment columns ("Cannot read
//     properties of undefined (reading 'split')"), so writes go through v2.
//
// Admin / super_admin only — the same gate as the warranty pages themselves.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/grove/generic-proxy/internal/middleware"
	"github.com/grove/generic-proxy/internal/proxy"
)

const (
	invoiceTable     = "Warranty Reminders"
	invoiceField     = "Invoice PDF"
	invoiceMaxBytes  = 15 << 20 // 15 MB — a scanned multi-page invoice fits comfortably
	invoiceUploadDir = "invoice_pdf"
)

type nocoAttachment map[string]interface{}

func warrantyInvoiceHandler(meta *proxy.MetaCache, metaBase, baseID, token string) http.HandlerFunc {
	// metaBase is "http://host/api/v2/"; files are served from the host root.
	root := strings.TrimSuffix(metaBase, "api/v2/")
	client := &http.Client{Timeout: 60 * time.Second}

	fail := func(w http.ResponseWriter, code int, msg string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}

	nocoReq := func(method, url string, body io.Reader, contentType string) (*http.Response, error) {
		req, err := http.NewRequest(method, url, body)
		if err != nil {
			return nil, err
		}
		req.Header.Set("xc-token", token)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		return client.Do(req)
	}

	// The record's current attachments, or nil when the column is empty.
	readAttachments := func(tableID string, id int64) ([]nocoAttachment, int, error) {
		url := fmt.Sprintf("%stables/%s/records/%d?fields=%s", metaBase, tableID, id, strings.ReplaceAll(invoiceField, " ", "%20"))
		res, err := nocoReq(http.MethodGet, url, nil, "")
		if err != nil {
			return nil, http.StatusBadGateway, err
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusNotFound {
			return nil, http.StatusNotFound, fmt.Errorf("cover record %d not found", id)
		}
		if res.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
			return nil, http.StatusBadGateway, fmt.Errorf("NocoDB read failed (HTTP %d): %s", res.StatusCode, b)
		}
		var row map[string]json.RawMessage
		if err := json.NewDecoder(res.Body).Decode(&row); err != nil {
			return nil, http.StatusBadGateway, err
		}
		// NocoDB returns an empty object for an unknown id rather than a 404.
		if len(row) == 0 {
			return nil, http.StatusNotFound, fmt.Errorf("cover record %d not found", id)
		}
		var atts []nocoAttachment
		if raw, ok := row[invoiceField]; ok && len(raw) > 0 && string(raw) != "null" {
			if err := json.Unmarshal(raw, &atts); err != nil {
				return nil, http.StatusBadGateway, err
			}
		}
		return atts, http.StatusOK, nil
	}

	writeAttachments := func(tableID string, id int64, atts interface{}) error {
		body, _ := json.Marshal([]map[string]interface{}{{"Id": id, invoiceField: atts}})
		res, err := nocoReq(http.MethodPatch, fmt.Sprintf("%stables/%s/records", metaBase, tableID), bytes.NewReader(body), "application/json")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
			return fmt.Errorf("NocoDB write failed (HTTP %d): %s", res.StatusCode, b)
		}
		return nil
	}

	return func(w http.ResponseWriter, r *http.Request) {
		role, _ := r.Context().Value(middleware.RoleKey).(string)
		if role != "admin" && role != "super_admin" {
			fail(w, http.StatusForbidden, "admin or super_admin only")
			return
		}
		if meta == nil {
			fail(w, http.StatusServiceUnavailable, "NocoDB metadata is not loaded")
			return
		}
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			fail(w, http.StatusBadRequest, "id is required")
			return
		}
		tableID, ok := meta.ResolveTable(invoiceTable)
		if !ok {
			fail(w, http.StatusServiceUnavailable, fmt.Sprintf("table %q not found", invoiceTable))
			return
		}
		email, _ := r.Context().Value(middleware.EmailKey).(string)

		switch r.Method {
		case http.MethodGet:
			atts, code, err := readAttachments(tableID, id)
			if err != nil {
				fail(w, code, err.Error())
				return
			}
			if len(atts) == 0 {
				fail(w, http.StatusNotFound, "no invoice PDF on this record")
				return
			}
			a := atts[0]
			// signedPath needs no token; a bare path does. Either is relative to the host.
			fileURL, needsToken := "", false
			if sp, _ := a["signedPath"].(string); sp != "" {
				fileURL = root + strings.TrimPrefix(sp, "/")
			} else if su, _ := a["signedUrl"].(string); su != "" {
				fileURL = su
			} else if p, _ := a["path"].(string); p != "" {
				fileURL, needsToken = root+strings.TrimPrefix(p, "/"), true
			} else if u, _ := a["url"].(string); u != "" {
				fileURL = u
			}
			if fileURL == "" {
				fail(w, http.StatusBadGateway, "attachment has no downloadable location")
				return
			}
			req, _ := http.NewRequest(http.MethodGet, fileURL, nil)
			if needsToken {
				req.Header.Set("xc-token", token)
			}
			res, err := client.Do(req)
			if err != nil {
				fail(w, http.StatusBadGateway, err.Error())
				return
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				fail(w, http.StatusBadGateway, fmt.Sprintf("NocoDB file fetch failed (HTTP %d)", res.StatusCode))
				return
			}
			title, _ := a["title"].(string)
			if title == "" {
				title = "invoice.pdf"
			}
			disposition := "inline"
			if r.URL.Query().Get("download") == "1" {
				disposition = "attachment"
			}
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename=%q", disposition, safeFilename(title)))
			w.Header().Set("Cache-Control", "private, no-store")
			if res.ContentLength > 0 {
				w.Header().Set("Content-Length", strconv.FormatInt(res.ContentLength, 10))
			}
			io.Copy(w, res.Body)

		case http.MethodPost:
			r.Body = http.MaxBytesReader(w, r.Body, invoiceMaxBytes+(1<<20))
			if err := r.ParseMultipartForm(invoiceMaxBytes); err != nil {
				fail(w, http.StatusRequestEntityTooLarge, "file too large (15 MB max) or not a form upload")
				return
			}
			file, header, err := r.FormFile("file")
			if err != nil {
				fail(w, http.StatusBadRequest, "no file in the upload")
				return
			}
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, invoiceMaxBytes+1))
			if err != nil {
				fail(w, http.StatusBadRequest, "could not read the file")
				return
			}
			if len(data) > invoiceMaxBytes {
				fail(w, http.StatusRequestEntityTooLarge, "file too large (15 MB max)")
				return
			}
			// Check the bytes, not the name or the browser's claimed type.
			if !bytes.HasPrefix(bytes.TrimLeft(data[:min(len(data), 1024)], "\x00\t\r\n "), []byte("%PDF-")) {
				fail(w, http.StatusUnsupportedMediaType, "that file is not a PDF")
				return
			}
			if _, code, err := readAttachments(tableID, id); err != nil {
				fail(w, code, err.Error())
				return
			}

			name := safeFilename(header.Filename)
			if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
				name += ".pdf"
			}
			var buf bytes.Buffer
			mw := multipart.NewWriter(&buf)
			part, _ := mw.CreatePart(textproto.MIMEHeader{
				"Content-Disposition": {fmt.Sprintf(`form-data; name="file"; filename=%q`, name)},
				"Content-Type":        {"application/pdf"},
			})
			part.Write(data)
			mw.Close()

			uploadURL := fmt.Sprintf("%sstorage/upload?path=noco/%s/%s/%s", metaBase, baseID, tableID, invoiceUploadDir)
			res, err := nocoReq(http.MethodPost, uploadURL, &buf, mw.FormDataContentType())
			if err != nil {
				fail(w, http.StatusBadGateway, err.Error())
				return
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
				fail(w, http.StatusBadGateway, fmt.Sprintf("NocoDB upload failed (HTTP %d): %s", res.StatusCode, b))
				return
			}
			var uploaded []nocoAttachment
			if err := json.NewDecoder(res.Body).Decode(&uploaded); err != nil || len(uploaded) == 0 {
				fail(w, http.StatusBadGateway, "NocoDB upload returned nothing")
				return
			}

			// One invoice per record: a new upload replaces the old one.
			if err := writeAttachments(tableID, id, uploaded[:1]); err != nil {
				fail(w, http.StatusBadGateway, err.Error())
				return
			}
			log.Printf("[WARRANTY INVOICE] %s attached %q (%d bytes) to cover %d", email, name, len(data), id)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"title": uploaded[0]["title"], "size": uploaded[0]["size"]})

		case http.MethodDelete:
			if _, code, err := readAttachments(tableID, id); err != nil {
				fail(w, code, err.Error())
				return
			}
			if err := writeAttachments(tableID, id, nil); err != nil {
				fail(w, http.StatusBadGateway, err.Error())
				return
			}
			log.Printf("[WARRANTY INVOICE] %s removed the invoice from cover %d", email, id)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"removed": true})

		default:
			fail(w, http.StatusMethodNotAllowed, "GET, POST or DELETE only")
		}
	}
}

// safeFilename keeps a name usable in a header and on disk: no path, no quotes
// or control characters.
func safeFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == '"' || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == "/" {
		return "invoice.pdf"
	}
	return name
}
