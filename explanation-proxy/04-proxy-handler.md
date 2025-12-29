# Proxy Handler (internal/proxy/handler.go)

The proxy handler is the **core component** that forwards requests from the frontend to NocoDB.

## Structure

### ProxyHandler
```go
type ProxyHandler struct {
    NocoDBURL      string
    NocoDBToken    string
    Meta           *MetaCache
    ResolvedConfig *config.ResolvedConfig
    Validator      *Validator
}
```

**Fields explained:**
- `NocoDBURL`: Base URL for NocoDB API (e.g., "http://localhost:8090/api/v3/data/project/")
- `NocoDBToken`: NocoDB authentication token (kept secret from frontend)
- `Meta`: MetaCache for name-to-ID translation
- `ResolvedConfig`: Configuration with resolved IDs (optional)
- `Validator`: Validates requests against config (optional)

## Constructor

### NewProxyHandler()
```go
func NewProxyHandler(nocoDBURL, nocoDBToken string, meta *MetaCache) *ProxyHandler {
    return &ProxyHandler{
        NocoDBURL:   nocoDBURL,
        NocoDBToken: nocoDBToken,
        Meta:        meta,
    }
}
```

**What it does:**
Creates a new proxy handler with NocoDB connection details and MetaCache.

**Usage:**
```go
proxyHandler := proxy.NewProxyHandler(
    "http://localhost:8090/api/v3/data/project/",
    "your_nocodb_token",
    metaCache
)
```

### SetResolvedConfig()
```go
func (p *ProxyHandler) SetResolvedConfig(config *config.ResolvedConfig) {
    p.ResolvedConfig = config
    p.Validator = NewValidator(config, p.Meta)
    log.Printf("[PROXY] Resolved configuration set with %d tables", len(config.Tables))
}
```

**What it does:**
- Sets the resolved configuration
- Creates a validator
- Enables schema-driven validation mode

**Called from main.go:**
```go
if resolvedConfig != nil {
    proxyHandler.SetResolvedConfig(resolvedConfig)
}
```

## Main Function: ServeHTTP()

This is the **heart of the proxy** - it handles every request.

```go
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

    // Execute the request
    client := &http.Client{}
    resp, err := client.Do(proxyReq)
    if err != nil {
        log.Printf("[PROXY ERROR] Failed to execute proxy request: %v", err)
        http.Error(w, "failed to proxy request", http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()

    // Copy response headers (excluding CORS headers)
    for key, values := range resp.Header {
        if strings.HasPrefix(key, "Access-Control-") {
            continue
        }
        for _, value := range values {
            w.Header().Add(key, value)
        }
    }

    // Read response body
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        log.Printf("[PROXY ERROR] Failed to read response body: %v", err)
        http.Error(w, "failed to read response", http.StatusInternalServerError)
        return
    }

    // Log response
    if resp.StatusCode >= 400 {
        log.Printf("[PROXY ERROR] NocoDB error response (status %d): %s", resp.StatusCode, string(body))
    } else {
        log.Printf("[PROXY] Response body length: %d bytes", len(body))
    }

    // Set status code and write response
    w.WriteHeader(resp.StatusCode)
    w.Write(body)
    log.Printf("[PROXY] Request completed successfully")
}
```

### Breaking Down ServeHTTP() - Step by Step

#### Step 1: Extract Path
```go
path := strings.TrimPrefix(r.URL.Path, "/proxy/")
```

**Example:**
```
Input:  "/proxy/quotes/records"
Output: "quotes/records"
```

#### Step 2: Choose Mode (Config-Driven or Legacy)

**Config-Driven Mode** (if validator exists):
```go
if p.Validator != nil && p.ResolvedConfig != nil {
    validation, err := p.Validator.ValidateRequest(r.Method, path)
    if err != nil {
        http.Error(w, "forbidden: "+err.Error(), http.StatusForbidden)
        return
    }
    resolvedPath = validation.ResolvedPath
}
```

**What it does:**
- Validates operation is allowed
- Resolves table name to ID
- Returns resolved path or error

**Legacy Mode** (no validator):
```go
else {
    if tableID, ok := p.Meta.Resolve(tableName); ok {
        resolvedPath = tableID + "/" + remainingPath
    }
}
```

**What it does:**
- Only translates table name to ID
- No validation (all operations allowed)

#### Step 3: Resolve Link Fields (if needed)

```go
if len(parts) == 2 {
    remainingPath := parts[1]
    resolvedRemainingPath, err := p.resolveLinkFieldInPath(tableID, tableName, remainingPath)
    resolvedPath = tableID + "/" + resolvedRemainingPath
}
```

**What it does:**
Detects link requests and resolves link field aliases.

**Example:**
```
Input:  "quotes/links/products/123"
Parts:  ["quotes", "links/products/123"]
Resolve: "products" -> "lnk_xyz789"
Output: "clkczb2ifl6l25g/links/lnk_xyz789/123"
```

#### Step 4: Construct Target URL
```go
targetURL := p.NocoDBURL + resolvedPath
if r.URL.RawQuery != "" {
    targetURL += "?" + r.URL.RawQuery
}
```

**Example:**
```
NocoDBURL:    "http://localhost:8090/api/v3/data/project/"
resolvedPath: "clkczb2ifl6l25g/records"
Query:        "limit=10&offset=0"

Result: "http://localhost:8090/api/v3/data/project/clkczb2ifl6l25g/records?limit=10&offset=0"
```

#### Step 5: Create New Request
```go
proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
```

**What it does:**
Creates a new HTTP request to NocoDB with:
- Same method (GET, POST, PATCH, DELETE)
- New URL (with resolved IDs)
- Same body

#### Step 6: Copy Headers (Except Authorization)
```go
for key, values := range r.Header {
    if key != "Authorization" {
        for _, value := range values {
            proxyReq.Header.Add(key, value)
        }
    }
}
```

**Why skip Authorization:**
Frontend sends JWT token, but NocoDB needs its own token.

**Headers copied:**
- Content-Type
- Accept
- User-Agent
- etc.

#### Step 7: Add NocoDB Token
```go
proxyReq.Header.Set("xc-token", p.NocoDBToken)
```

**Critical security feature:**
- Frontend never sees this token
- Proxy adds it to every request
- NocoDB authenticates the proxy, not the user

#### Step 8: Execute Request
```go
client := &http.Client{}
resp, err := client.Do(proxyReq)
```

**What it does:**
Sends the request to NocoDB and waits for response.

#### Step 9: Copy Response Headers
```go
for key, values := range resp.Header {
    if strings.HasPrefix(key, "Access-Control-") {
        continue
    }
    for _, value := range values {
        w.Header().Add(key, value)
    }
}
```

**Why skip CORS headers:**
CORSMiddleware already added them. Duplicates cause errors.

#### Step 10: Read and Return Response
```go
body, err := io.ReadAll(resp.Body)
w.WriteHeader(resp.StatusCode)
w.Write(body)
```

**What it does:**
- Reads NocoDB's response
- Sets same status code
- Returns same body to frontend

## Helper Function: resolveLinkFieldInPath()

```go
func (p *ProxyHandler) resolveLinkFieldInPath(tableID, tableName, remainingPath string) (string, error) {
    parts := strings.Split(remainingPath, "/")

    // Check if this is a link request: links/{linkAlias}/{recordId}
    if len(parts) >= 3 && parts[0] == "links" {
        linkAlias := parts[1]
        log.Printf("[LINK RESOLVER] Detected link request for table '%s', alias '%s'", tableName, linkAlias)

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
                parts[1] = linkFieldID
                return strings.Join(parts, "/"), nil
            }

            return "", fmt.Errorf("unknown link field '%s' for table '%s'", linkAlias, tableName)
        }
    }

    return remainingPath, nil
}
```

**What it does:**
Detects and resolves link field aliases in paths.

**Example transformation:**
```
Input:  "links/products/123"
Parts:  ["links", "products", "123"]
Resolve: "products" -> "lnk_xyz789"
Output: "links/lnk_xyz789/123"
```

**Normalization:**
Tries both "products" and "products" (with spaces) to handle different naming conventions.

## Request Flow Example

### Frontend Request:
```
POST /proxy/quotes/records
Authorization: Bearer eyJhbGc...
Body: {"fields": {"Subject": "Q-001"}}
```

### Proxy Processing:
```
1. Extract path: "quotes/records"
2. Validate: "quotes" table exists, "create" operation allowed
3. Resolve: "quotes" -> "clkczb2ifl6l25g"
4. Build URL: "http://nocodb.../clkczb2ifl6l25g/records"
5. Create request with NocoDB token
6. Forward to NocoDB
```

### NocoDB Response:
```
200 OK
{"id": 123, "fields": {"Subject": "Q-001"}}
```

### Proxy Returns:
```
200 OK
{"id": 123, "fields": {"Subject": "Q-001"}}
```

## Two Modes Compared

### Config-Driven Mode (Recommended)
```
✓ Validates operations against proxy.yaml
✓ Only allowed operations succeed
✓ Secure and controlled
✓ Requires proxy.yaml
```

### Legacy Mode (Development)
```
✓ No validation
✓ All operations allowed
✓ Flexible but less secure
✓ Works without proxy.yaml
```

## Error Handling

### Validation Failed
```go
if err != nil {
    http.Error(w, "forbidden: "+err.Error(), http.StatusForbidden)
    return
}
```

**Response:** 403 Forbidden

### Link Field Not Found
```go
return "", fmt.Errorf("unknown link field '%s' for table '%s'", linkAlias, tableName)
```

**Response:** 400 Bad Request

### NocoDB Request Failed
```go
if err != nil {
    http.Error(w, "failed to proxy request", http.StatusBadGateway)
    return
}
```

**Response:** 502 Bad Gateway

### NocoDB Error Response
```go
if resp.StatusCode >= 400 {
    log.Printf("[PROXY ERROR] NocoDB error response (status %d): %s", resp.StatusCode, string(body))
}
```

**Response:** Same status code as NocoDB (400, 404, 500, etc.)

## Key Takeaway

**The proxy handler is a smart forwarder:**
- Validates requests (if configured)
- Translates names to IDs
- Adds authentication
- Forwards to NocoDB
- Returns responses unchanged

It's the **bridge** between your frontend and NocoDB, making everything work seamlessly!

---

**Next:** [05-validator.md](./05-validator.md) - Request validation logic.
