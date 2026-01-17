package proxy

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/grove/generic-proxy/internal/config"
)

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
	targetURL := p.NocoDBURL + resolvedPath
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
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

	// Copy headers from original request (except Authorization)
	for key, values := range r.Header {
		if key != "Authorization" {
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

// handlePagination checks for 'next' key in response and fetches all pages
// Combines all records from paginated responses into a single response
func (p *ProxyHandler) handlePagination(initialBody []byte, initialURL string) ([]byte, error) {
	// Parse the initial response
	var response map[string]interface{}
	if err := json.Unmarshal(initialBody, &response); err != nil {
		// Not JSON or parse error - return as-is
		log.Printf("[PAGINATION] Response is not JSON, skipping pagination")
		return initialBody, nil
	}

	// Check if response has 'records' array and 'next' key
	records, hasRecords := response["records"].([]interface{})
	nextURL, hasNext := response["next"].(string)

	if !hasRecords {
		log.Printf("[PAGINATION] No 'records' array found, skipping pagination")
		return initialBody, nil
	}

	if !hasNext || nextURL == "" {
		log.Printf("[PAGINATION] No 'next' key or empty, single page response")
		return initialBody, nil
	}

	// We have pagination - collect all records
	log.Printf("[PAGINATION] Detected paginated response, initial records: %d", len(records))
	allRecords := records
	pageCount := 1

	// Fetch subsequent pages
	client := &http.Client{}
	currentNextURL := nextURL

	for currentNextURL != "" {
		pageCount++
		log.Printf("[PAGINATION] Fetching page %d from: %s", pageCount, currentNextURL)

		// Create request for next page
		nextReq, err := http.NewRequest("GET", currentNextURL, nil)
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to create request for page %d: %v", pageCount, err)
			break
		}

		// Add NocoDB authentication token
		nextReq.Header.Set("xc-token", p.NocoDBToken)

		// Execute request
		nextResp, err := client.Do(nextReq)
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to fetch page %d: %v", pageCount, err)
			break
		}

		// Read response body
		nextBody, err := io.ReadAll(nextResp.Body)
		nextResp.Body.Close()
		if err != nil {
			log.Printf("[PAGINATION ERROR] Failed to read page %d body: %v", pageCount, err)
			break
		}

		if nextResp.StatusCode != 200 {
			log.Printf("[PAGINATION ERROR] Page %d returned status %d", pageCount, nextResp.StatusCode)
			break
		}

		// Parse next page response
		var nextResponse map[string]interface{}
		if err := json.Unmarshal(nextBody, &nextResponse); err != nil {
			log.Printf("[PAGINATION ERROR] Failed to parse page %d JSON: %v", pageCount, err)
			break
		}

		// Extract records from next page
		nextRecords, ok := nextResponse["records"].([]interface{})
		if !ok {
			log.Printf("[PAGINATION ERROR] Page %d has no 'records' array", pageCount)
			break
		}

		log.Printf("[PAGINATION] Page %d fetched: %d records", pageCount, len(nextRecords))
		allRecords = append(allRecords, nextRecords...)

		// Check for next page
		nextURL, hasNext := nextResponse["next"].(string)
		if !hasNext || nextURL == "" {
			log.Printf("[PAGINATION] No more pages after page %d", pageCount)
			currentNextURL = ""
		} else {
			currentNextURL = nextURL
		}
	}

	log.Printf("[PAGINATION] Complete: fetched %d pages with %d total records", pageCount, len(allRecords))

	// Reconstruct response with all records
	response["records"] = allRecords
	response["next"] = nil // Clear next since we've fetched all pages

	// Marshal back to JSON
	combinedBody, err := json.Marshal(response)
	if err != nil {
		log.Printf("[PAGINATION ERROR] Failed to marshal combined response: %v", err)
		return initialBody, err
	}

	return combinedBody, nil
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
