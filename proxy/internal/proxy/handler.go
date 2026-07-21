package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/grove/generic-proxy/internal/config"
)

// defaultListLimit is the page size requested from NocoDB for list reads that
// don't specify one. 1000 is NocoDB's maximum; anything larger is clamped by it.
const defaultListLimit = 1000

// isRecordsListPath reports whether a proxy path is a list read of the form
// /proxy/<table>/records (no trailing record id, no link sub-path).
func isRecordsListPath(path string) bool {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/proxy/"), "/")
	segments := strings.Split(trimmed, "/")
	return len(segments) == 2 && segments[1] == "records"
}

// getRawQueryParam returns the raw (still-encoded) value of key from a raw query
// string, or "" if absent. Works on the raw string rather than url.Values so the
// caller's exact encoding of other params (notably `where`) is left untouched.
func getRawQueryParam(rawQuery, key string) string {
	prefix := key + "="
	for _, p := range strings.Split(rawQuery, "&") {
		if strings.HasPrefix(p, prefix) {
			return strings.TrimPrefix(p, prefix)
		}
	}
	return ""
}

type ProxyHandler struct {
	NocoDBURL      string
	NocoDBToken    string
	Meta           *MetaCache
	ResolvedConfig *config.ResolvedConfig
	Validator      *Validator
}

// NewProxyHandler creates a new proxy handler
func NewProxyHandler(nocoDBURL, nocoDBToken string, meta *MetaCache) *ProxyHandler {
	return &ProxyHandler{
		NocoDBURL:   nocoDBURL,
		NocoDBToken: nocoDBToken,
		Meta:        meta,
	}
}

// SetResolvedConfig sets the resolved configuration and initializes the validator
func (p *ProxyHandler) SetResolvedConfig(config *config.ResolvedConfig) {
	p.ResolvedConfig = config
	p.Validator = NewValidator(config, p.Meta)
	log.Printf("[PROXY] Resolved configuration set with %d tables", len(config.Tables))
}

// ServeHTTP handles proxying requests to NocoDB
func (p *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("[PROXY] Incoming request: %s %s", r.Method, r.URL.Path)

	// Extract the path after /proxy/
	path := strings.TrimPrefix(r.URL.Path, "/proxy/")
	log.Printf("[PROXY] Extracted path: %s", path)

	var resolvedPath string

	// If we have a validator (config-driven mode), use it
	if p.Validator != nil && p.ResolvedConfig != nil {
		log.Printf("[PROXY] Using config-driven validation")

		validation, err := p.Validator.ValidateRequest(r.Method, path)
		if err != nil {
			log.Printf("[PROXY ERROR] Validation failed: %v", err)
			http.Error(w, "forbidden: "+err.Error(), http.StatusForbidden)
			return
		}

		resolvedPath = validation.ResolvedPath
		log.Printf("[PROXY] Validated and resolved: %s -> %s", path, resolvedPath)
	} else {
		// Fallback to MetaCache-only resolution (legacy mode)
		log.Printf("[PROXY] Using legacy MetaCache-only mode")

		if p.Meta != nil {
			parts := strings.SplitN(path, "/", 2)
			if len(parts) > 0 && parts[0] != "" {
				tableName := parts[0]
				if tableID, ok := p.Meta.Resolve(tableName); ok {
					log.Printf("[META] Resolved table '%s' -> '%s'", tableName, tableID)

					// Check if this is a link request and resolve link field alias
					if len(parts) == 2 {
						remainingPath := parts[1]
						resolvedRemainingPath, err := p.resolveLinkFieldInPath(tableID, tableName, remainingPath)
						if err != nil {
							log.Printf("[PROXY ERROR] Link field resolution failed: %v", err)
							http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
							return
						}
						resolvedPath = tableID + "/" + resolvedRemainingPath
					} else {
						resolvedPath = tableID
					}
				} else {
					log.Printf("[META] No mapping found for table '%s', using raw name", tableName)
					resolvedPath = path
				}
			} else {
				resolvedPath = path
			}
		} else {
			resolvedPath = path
		}
	}

	// Construct the target URL
	// targetURL := p.NocoDBURL + resolvedPath
	// if r.URL.RawQuery != "" {
	// 	targetURL += "?" + r.URL.RawQuery
	// }
	targetURL := p.NocoDBURL
	if !strings.HasSuffix(targetURL, "/") {
		targetURL += "/"
	}
	if p.ResolvedConfig != nil && p.ResolvedConfig.BaseID != "" {
		targetURL += p.ResolvedConfig.BaseID + "/" + resolvedPath
	} else {
		targetURL += resolvedPath
	}
	// Default the page size on list reads. Without an explicit limit NocoDB
	// returns 25 rows per page, and handlePagination then walks the remainder
	// serially — ~46 round-trips for a 1,100-row table, which dominates page
	// load. Asking for the maximum collapses that to one or two requests.
	// Restricted to GET /<table>/records: link endpoints keep their own paging.
	rawQuery := r.URL.RawQuery
	if r.Method == http.MethodGet && isRecordsListPath(r.URL.Path) && getRawQueryParam(rawQuery, "limit") == "" {
		if rawQuery != "" {
			rawQuery += "&"
		}
		rawQuery += fmt.Sprintf("limit=%d", defaultListLimit)
	}
	if rawQuery != "" {
		targetURL += "?" + rawQuery
	}
	log.Printf("[PROXY] Target URL: %s", targetURL)

	// Create a new request to NocoDB
	proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("[PROXY ERROR] Failed to create proxy request: %v", err)
		http.Error(w, "failed to create proxy request", http.StatusInternalServerError)
		return
	}
	log.Printf("[PROXY] Created proxy request successfully")

	// Copy headers from original request, stripping auth and cache-validation
	// headers. Cache headers (If-None-Match, If-Modified-Since, etc.) must be
	// stripped so NocoDB always returns 200 with a full body — otherwise it
	// returns 304 Not Modified with an empty body, breaking pagination.
	skipHeaders := map[string]bool{
		"Authorization":       true,
		"If-None-Match":       true,
		"If-Modified-Since":   true,
		"If-Unmodified-Since": true,
		"If-Match":            true,
		"If-Range":            true,
	}
	for key, values := range r.Header {
		if !skipHeaders[key] {
			for _, value := range values {
				proxyReq.Header.Add(key, value)
			}
		}
	}

	// Add NocoDB authentication token
	proxyReq.Header.Set("xc-token", p.NocoDBToken)
	log.Printf("[PROXY] Added xc-token header")

	// Execute the request
	log.Printf("[PROXY] Executing request to NocoDB...")
	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("[PROXY ERROR] Failed to execute proxy request: %v", err)
		http.Error(w, "failed to proxy request", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	log.Printf("[PROXY] NocoDB responded with status: %d %s", resp.StatusCode, resp.Status)

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[PROXY ERROR] Failed to read response body: %v", err)
		http.Error(w, "failed to read response", http.StatusInternalServerError)
		return
	}

	// Log response details
	if resp.StatusCode >= 400 {
		log.Printf("[PROXY ERROR] NocoDB error response (status %d): %s", resp.StatusCode, string(body))
	} else {
		log.Printf("[PROXY] Response body length: %d bytes", len(body))
		if len(body) < 500 {
			log.Printf("[PROXY] Response body: %s", string(body))
		}
	}

	// Handle pagination for GET requests with records
	// This may modify the body size, so must be done BEFORE copying headers
	if r.Method == "GET" && resp.StatusCode == 200 && strings.Contains(path, "/records") {
		body, err = p.handlePagination(body, targetURL)
		if err != nil {
			log.Printf("[PROXY ERROR] Pagination handling failed: %v", err)
			http.Error(w, "failed to handle pagination", http.StatusInternalServerError)
			return
		}
	}

	// Copy response headers AFTER pagination handling (excluding CORS headers)
	// This ensures Content-Length matches the actual body size
	for key, values := range resp.Header {
		// Skip CORS headers - these are handled by CORSMiddleware
		if strings.HasPrefix(key, "Access-Control-") {
			continue
		}
		// Skip Content-Length - we'll set it correctly below
		if key == "Content-Length" {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Set correct Content-Length for the (possibly modified) body
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))

	// Set status code
	w.WriteHeader(resp.StatusCode)

	// Write response body
	_, err = w.Write(body)
	if err != nil {
		log.Printf("[PROXY ERROR] Failed to write response: %v", err)
	}
	log.Printf("[PROXY] Request completed successfully")
}

// handlePagination fetches all pages from NocoDB and merges them into a single response.
// Supports NocoDB v3 pageInfo format (isLastPage + offset) and legacy next-URL format.
func (p *ProxyHandler) handlePagination(initialBody []byte, initialURL string) ([]byte, error) {
	var response map[string]interface{}
	if err := json.Unmarshal(initialBody, &response); err != nil {
		log.Printf("[PAGINATION] Response is not JSON, skipping pagination")
		return initialBody, nil
	}

	records, hasRecords := response["records"].([]interface{})
	if !hasRecords {
		log.Printf("[PAGINATION] No 'records' array found, skipping pagination")
		return initialBody, nil
	}

	// ── NocoDB v3: pageInfo-based pagination ──────────────────────────────
	if pageInfo, ok := response["pageInfo"].(map[string]interface{}); ok {
		isLastPage, _ := pageInfo["isLastPage"].(bool)
		if isLastPage {
			log.Printf("[PAGINATION] Single page response (pageInfo.isLastPage=true), records: %d", len(records))
			return initialBody, nil
		}

		pageSize := 25
		if ps, ok := pageInfo["pageSize"].(float64); ok && ps > 0 {
			pageSize = int(ps)
		}

		log.Printf("[PAGINATION] NocoDB v3 multi-page response detected, pageSize=%d, initial records=%d", pageSize, len(records))
		allRecords := make([]interface{}, len(records))
		copy(allRecords, records)

		client := &http.Client{}
		offset := pageSize
		pageCount := 1

		for {
			pageCount++
			pageURL := addOrReplaceQueryParam(initialURL, "offset", fmt.Sprintf("%d", offset))
			log.Printf("[PAGINATION] Fetching page %d, offset=%d: %s", pageCount, offset, pageURL)

			req, err := http.NewRequest("GET", pageURL, nil)
			if err != nil {
				log.Printf("[PAGINATION ERROR] Failed to create request: %v", err)
				break
			}
			req.Header.Set("xc-token", p.NocoDBToken)

			resp, err := client.Do(req)
			if err != nil {
				log.Printf("[PAGINATION ERROR] Request failed: %v", err)
				break
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil || resp.StatusCode != 200 {
				log.Printf("[PAGINATION ERROR] Bad response (status=%d): %v", resp.StatusCode, err)
				break
			}

			var nextResp map[string]interface{}
			if err := json.Unmarshal(body, &nextResp); err != nil {
				log.Printf("[PAGINATION ERROR] Failed to parse page %d JSON: %v", pageCount, err)
				break
			}

			nextRecords, ok := nextResp["records"].([]interface{})
			if !ok || len(nextRecords) == 0 {
				log.Printf("[PAGINATION] Page %d returned no records, stopping", pageCount)
				break
			}

			allRecords = append(allRecords, nextRecords...)
			log.Printf("[PAGINATION] Page %d: %d records (total so far: %d)", pageCount, len(nextRecords), len(allRecords))

			nextPageInfo, ok := nextResp["pageInfo"].(map[string]interface{})
			if !ok {
				break
			}
			done, _ := nextPageInfo["isLastPage"].(bool)
			if done {
				break
			}
			offset += pageSize
		}

		log.Printf("[PAGINATION] Complete: %d pages, %d total records", pageCount, len(allRecords))
		response["records"] = allRecords
		response["pageInfo"] = map[string]interface{}{"isLastPage": true, "totalRows": len(allRecords)}

		combined, err := json.Marshal(response)
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to marshal combined response: %v", err)
			return initialBody, err
		}
		return combined, nil
	}

	// ── Legacy: next-URL pagination (?page=N format) ─────────────────────
	// NocoDB returns "next" with its external IP, which is unreachable from
	// inside Docker containers (hairpin NAT). We use initialURL (internal
	// Docker hostname) and increment the page counter ourselves instead.
	_, hasNext := response["next"].(string)
	if !hasNext {
		log.Printf("[PAGINATION] Single page response (no pageInfo, no next), records: %d", len(records))
		return initialBody, nil
	}

	log.Printf("[PAGINATION] Legacy page-based pagination, initial records: %d", len(records))
	allRecords := make([]interface{}, len(records))
	copy(allRecords, records)
	client := &http.Client{}

	for page := 2; ; page++ {
		pageURL := addOrReplaceQueryParam(initialURL, "page", fmt.Sprintf("%d", page))
		log.Printf("[PAGINATION] Fetching page %d: %s", page, pageURL)

		nextReq, err := http.NewRequest("GET", pageURL, nil)
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to create request for page %d: %v", page, err)
			break
		}
		nextReq.Header.Set("xc-token", p.NocoDBToken)

		nextResp, err := client.Do(nextReq)
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to fetch page %d: %v", page, err)
			break
		}
		nextBody, err := io.ReadAll(nextResp.Body)
		nextResp.Body.Close()
		if err != nil || nextResp.StatusCode != 200 {
			log.Printf("[PAGINATION ERROR] Page %d bad response (status=%d): %v", page, nextResp.StatusCode, err)
			break
		}

		var nextResponse map[string]interface{}
		if err := json.Unmarshal(nextBody, &nextResponse); err != nil {
			log.Printf("[PAGINATION ERROR] Failed to parse page %d JSON: %v", page, err)
			break
		}

		nextRecords, ok := nextResponse["records"].([]interface{})
		if !ok || len(nextRecords) == 0 {
			log.Printf("[PAGINATION] Page %d returned no records, stopping", page)
			break
		}

		log.Printf("[PAGINATION] Page %d: %d records (total so far: %d)", page, len(nextRecords), len(allRecords)+len(nextRecords))
		allRecords = append(allRecords, nextRecords...)

		// Stop if NocoDB signals no more pages
		nxt, hasNxt := nextResponse["next"].(string)
		if !hasNxt || nxt == "" {
			log.Printf("[PAGINATION] No more pages after page %d", page)
			break
		}
	}

	log.Printf("[PAGINATION] Complete: %d total records", len(allRecords))
	response["records"] = allRecords
	response["next"] = nil

	combined, err := json.Marshal(response)
	if err != nil {
		log.Printf("[PAGINATION ERROR] Failed to marshal combined response: %v", err)
		return initialBody, err
	}
	return combined, nil
}

// addOrReplaceQueryParam adds or replaces a query parameter in a URL string.
func addOrReplaceQueryParam(rawURL, key, value string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL + "&" + key + "=" + value
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

// resolveLinkFieldInPath detects link requests and resolves link field aliases to field IDs
// Handles paths like: links/{linkAlias}/{recordId} -> links/{linkFieldID}/{recordId}
func (p *ProxyHandler) resolveLinkFieldInPath(tableID, tableName, remainingPath string) (string, error) {
	// Split the remaining path to check if it's a link request
	parts := strings.Split(remainingPath, "/")

	// Check if this is a link request: links/{linkAlias}/{recordId}
	// Pattern: parts[0] = "links", parts[1] = linkAlias, parts[2] = recordId
	if len(parts) >= 3 && parts[0] == "links" {
		linkAlias := parts[1]
		log.Printf("[LINK RESOLVER] Detected link request for table '%s', alias '%s'", tableName, linkAlias)

		// Try to resolve the link field alias to field ID using MetaCache
		if p.Meta != nil {
			// Try direct match first
			linkFieldID, ok := p.Meta.ResolveLinkField(tableID, linkAlias)
			if !ok {
				// Try normalized version (replace underscores with spaces)
				normalizedAlias := strings.ReplaceAll(linkAlias, "_", " ")
				linkFieldID, ok = p.Meta.ResolveLinkField(tableID, normalizedAlias)
			}

			if ok {
				log.Printf("[LINK RESOLVER] %s.%s → %s", tableName, linkAlias, linkFieldID)
				// Replace the alias with the resolved field ID
				parts[1] = linkFieldID
				return strings.Join(parts, "/"), nil
			}

			// Link field not found in cache
			return "", fmt.Errorf("unknown link field '%s' for table '%s'", linkAlias, tableName)
		}

		log.Printf("[LINK RESOLVER WARNING] MetaCache not available, using alias as-is")
	}

	// Not a link request or MetaCache unavailable, return path as-is
	return remainingPath, nil
}
