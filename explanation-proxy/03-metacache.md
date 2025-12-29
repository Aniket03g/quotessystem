# MetaCache (internal/proxy/metacache.go)

MetaCache is the **translation dictionary** that converts human-readable names to NocoDB IDs.

## Data Structures

### FieldMeta - Single Field Information
```go
type FieldMeta struct {
    ID    string `json:"id"`
    Title string `json:"title"`
    Type  string `json:"type"`
}
```

**Example:**
```go
FieldMeta{
    ID:    "fld_aaa111",
    Title: "Subject",
    Type:  "SingleLineText",
}
```

### TableMeta - Single Table Information
```go
type TableMeta struct {
    ID        string      `json:"id"`
    Title     string      `json:"title"`
    TableName string      `json:"table_name"`
    Columns   []FieldMeta `json:"columns,omitempty"`
    Fields    []FieldMeta `json:"fields,omitempty"`
}
```

**Example:**
```go
TableMeta{
    ID:        "clkczb2ifl6l25g",
    Title:     "Quotes",
    TableName: "quotes",
    Fields:    []FieldMeta{...},
}
```

### TablesResponse - API Response
```go
type TablesResponse struct {
    List []TableMeta `json:"list"`
}
```

**What NocoDB returns:**
```json
{
  "list": [
    {"id": "clkczb2ifl6l25g", "title": "Quotes"},
    {"id": "tbl_abc123", "title": "Products"}
  ]
}
```

### MetaCache - The Main Structure
```go
type MetaCache struct {
    mu                sync.RWMutex
    tableByName       map[string]string
    fieldsByTable     map[string]map[string]string
    linkFieldsByTable map[string]map[string]string
    metaBaseURL       string
    baseID            string
    token             string
    httpClient        *http.Client
    lastLoadedAt      time.Time
    refreshInterval   time.Duration
}
```

**Fields explained:**

- `mu`: Lock for thread safety (multiple requests at once)
- `tableByName`: Maps "quotes" → "clkczb2ifl6l25g"
- `fieldsByTable`: Maps table ID + field name → field ID
- `linkFieldsByTable`: Maps table ID + link field name → link field ID
- `metaBaseURL`: NocoDB metadata API URL
- `baseID`: Your NocoDB project ID
- `token`: NocoDB authentication token
- `httpClient`: HTTP client for API calls
- `lastLoadedAt`: When cache was last refreshed
- `refreshInterval`: How often to refresh (10 minutes)

## Constructor

### NewMetaCache()
```go
func NewMetaCache(metaBaseURL, baseID, token string) *MetaCache {
    return &MetaCache{
        tableByName:       make(map[string]string),
        fieldsByTable:     make(map[string]map[string]string),
        linkFieldsByTable: make(map[string]map[string]string),
        metaBaseURL:       strings.TrimRight(metaBaseURL, "/") + "/",
        baseID:            baseID,
        token:             token,
        httpClient:        &http.Client{Timeout: 10 * time.Second},
        refreshInterval:   10 * time.Minute,
    }
}
```

**What it does:**
- Creates empty maps for storing translations
- Stores NocoDB connection details
- Creates HTTP client with 10-second timeout
- Sets refresh interval to 10 minutes

**Usage:**
```go
metaCache := proxy.NewMetaCache(
    "http://localhost:8090/api/v2/",
    "pbf7tt48gxdl50h",
    "your_nocodb_token"
)
```

## Core Functions

### 1. Refresh() - Fetch Metadata from NocoDB

This is the **most important function** - it fetches all metadata.

```go
func (m *MetaCache) Refresh() error {
    log.Printf("[META] Fetching table metadata from NocoDB...")

    // Build the metadata API URL
    url := fmt.Sprintf("%smeta/bases/%s/tables", m.metaBaseURL, m.baseID)
    
    // Create request
    req, err := http.NewRequest("GET", url, nil)
    if err != nil {
        return fmt.Errorf("failed to create metadata request: %w", err)
    }

    // Add authentication header
    req.Header.Set("xc-token", m.token)

    // Execute request
    resp, err := m.httpClient.Do(req)
    if err != nil {
        return fmt.Errorf("failed to fetch metadata: %w", err)
    }
    defer resp.Body.Close()

    // Check status code
    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        return fmt.Errorf("metadata API returned status %d: %s", resp.StatusCode, string(body))
    }

    // Parse response
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return fmt.Errorf("failed to read metadata response: %w", err)
    }

    var tablesResp TablesResponse
    if err := json.Unmarshal(body, &tablesResp); err != nil {
        return fmt.Errorf("failed to parse metadata JSON: %w", err)
    }

    // Build new mapping
    newMapping := make(map[string]string)
    newFieldMappings := make(map[string]map[string]string)
    newLinkFieldMappings := make(map[string]map[string]string)

    for _, table := range tablesResp.List {
        // Map table names to IDs
        if table.Title != "" {
            newMapping[strings.ToLower(table.Title)] = table.ID
            log.Printf("[META] Mapped table '%s' -> '%s'", table.Title, table.ID)
        }

        // Fetch detailed table metadata for fields
        tableDetails, err := m.fetchTableDetails(table.ID)
        if err != nil {
            log.Printf("[META WARNING] Failed to fetch field details for table '%s': %v", table.Title, err)
            continue
        }

        // Extract link fields
        linkFieldMap := make(map[string]string)
        for _, field := range tableDetails.Fields {
            if field.Type == "Links" || field.Type == "LinkToAnotherRecord" {
                if field.Title != "" {
                    linkFieldMap[strings.ToLower(field.Title)] = field.ID
                    log.Printf("[META] ✓ Found link field '%s.%s' (ID: %s)", table.Title, field.Title, field.ID)
                }
            }
        }

        if len(linkFieldMap) > 0 {
            newLinkFieldMappings[table.ID] = linkFieldMap
        }
    }

    // Update cache atomically
    m.mu.Lock()
    m.tableByName = newMapping
    m.fieldsByTable = newFieldMappings
    m.linkFieldsByTable = newLinkFieldMappings
    m.lastLoadedAt = time.Now()
    m.mu.Unlock()

    log.Printf("[META] ✅ Successfully loaded %d tables", len(tablesResp.List))
    return nil
}
```

**What it does - Step by Step:**

1. **Build API URL**
   ```
   http://localhost:8090/api/v2/meta/bases/pbf7tt48gxdl50h/tables
   ```

2. **Make HTTP request with authentication**
   ```go
   req.Header.Set("xc-token", m.token)
   ```

3. **Parse JSON response**
   ```json
   {
     "list": [
       {"id": "clkczb2ifl6l25g", "title": "Quotes"},
       ...
     ]
   }
   ```

4. **Build translation maps**
   ```go
   newMapping["quotes"] = "clkczb2ifl6l25g"
   newMapping["products"] = "tbl_abc123"
   ```

5. **For each table, fetch field details**
   ```go
   tableDetails, err := m.fetchTableDetails(table.ID)
   ```

6. **Extract link fields** (type = "Links")
   ```go
   if field.Type == "Links" {
       linkFieldMap[strings.ToLower(field.Title)] = field.ID
   }
   ```

7. **Update cache atomically** (thread-safe)
   ```go
   m.mu.Lock()
   m.tableByName = newMapping
   m.linkFieldsByTable = newLinkFieldMappings
   m.mu.Unlock()
   ```

### 2. fetchTableDetails() - Get Field Information

```go
func (m *MetaCache) fetchTableDetails(tableID string) (*TableMeta, error) {
    // Construct v3 API URL for table details
    url := fmt.Sprintf("%sapi/v3/meta/bases/%s/tables/%s", 
        strings.TrimSuffix(m.metaBaseURL, "api/v2/"), 
        m.baseID, 
        tableID)

    req, err := http.NewRequest("GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("failed to create table details request: %w", err)
    }

    req.Header.Set("xc-token", m.token)

    resp, err := m.httpClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("failed to fetch table details: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("table details API returned status %d: %s", resp.StatusCode, string(body))
    }

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("failed to read table details response: %w", err)
    }

    var tableMeta TableMeta
    if err := json.Unmarshal(body, &tableMeta); err != nil {
        return nil, fmt.Errorf("failed to parse table details JSON: %w", err)
    }

    return &tableMeta, nil
}
```

**What it does:**
- Fetches detailed info for a specific table
- Returns all fields including their types
- Used to identify link fields

**API URL:**
```
http://localhost:8090/api/v3/meta/bases/pbf7tt48gxdl50h/tables/clkczb2ifl6l25g
```

**Returns:**
```json
{
  "id": "clkczb2ifl6l25g",
  "title": "Quotes",
  "fields": [
    {"id": "fld_aaa111", "title": "Subject", "type": "SingleLineText"},
    {"id": "lnk_xyz789", "title": "Products", "type": "Links"}
  ]
}
```

### 3. Resolve() - Lookup Table ID

```go
func (m *MetaCache) Resolve(name string) (string, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()

    if m.tableByName == nil {
        return "", false
    }

    id, ok := m.tableByName[strings.ToLower(name)]
    return id, ok
}
```

**What it does:**
- Looks up table ID by name
- Case-insensitive ("Quotes" = "quotes" = "QUOTES")
- Thread-safe (uses read lock)

**Usage:**
```go
tableID, ok := metaCache.Resolve("quotes")
if ok {
    // Found: tableID = "clkczb2ifl6l25g"
} else {
    // Not found
}
```

**The `RLock()` pattern:**
```go
m.mu.RLock()         // Lock for reading
defer m.mu.RUnlock() // Unlock when function exits
```

Multiple reads can happen simultaneously, but writes block everything.

### 4. ResolveLinkField() - Lookup Link Field ID

```go
func (m *MetaCache) ResolveLinkField(tableID, fieldName string) (string, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()

    if m.linkFieldsByTable == nil {
        return "", false
    }

    linkFieldMap, ok := m.linkFieldsByTable[tableID]
    if !ok {
        return "", false
    }

    fieldID, ok := linkFieldMap[strings.ToLower(fieldName)]
    return fieldID, ok
}
```

**What it does:**
- Looks up link field ID by table ID and field name
- Two-level lookup: table → field

**Usage:**
```go
linkFieldID, ok := metaCache.ResolveLinkField("clkczb2ifl6l25g", "products")
if ok {
    // Found: linkFieldID = "lnk_xyz789"
}
```

**Data structure:**
```go
linkFieldsByTable = {
    "clkczb2ifl6l25g": {  // Quotes table
        "products": "lnk_xyz789",
        "accounts_copy": "lnk_abc123",
    },
    "tbl_abc123": {  // Products table
        "quotes": "lnk_def456",
    },
}
```

### 5. LoadInitial() - Synchronous Initial Load

```go
func (m *MetaCache) LoadInitial() error {
    log.Printf("[META] Performing initial synchronous metadata load...")
    if err := m.Refresh(); err != nil {
        return fmt.Errorf("initial metadata load failed: %w", err)
    }
    log.Printf("[META] Initial metadata load complete: %d tables cached", m.GetTableCount())
    return nil
}
```

**What it does:**
- Calls `Refresh()` synchronously (blocks)
- Used at startup before accepting requests

**Why synchronous:**
The proxy can't work without metadata, so we wait for it to load.

### 6. StartAutoRefresh() - Background Refresh

```go
func (m *MetaCache) StartAutoRefresh() {
    go func() {
        log.Printf("[META] Starting auto-refresh goroutine (interval: %v)", m.refreshInterval)

        ticker := time.NewTicker(m.refreshInterval)
        defer ticker.Stop()

        for range ticker.C {
            log.Printf("[META] Auto-refreshing metadata cache...")
            if err := m.Refresh(); err != nil {
                log.Printf("[META ERROR] Auto-refresh failed: %v", err)
            }
        }
    }()
}
```

**What it does:**
- Starts a background goroutine
- Refreshes metadata every 10 minutes
- Runs forever until program exits

**The `go func()` pattern:**
```go
go func() {
    // This runs in the background
}()
```

Creates a new goroutine (lightweight thread).

**The `ticker` pattern:**
```go
ticker := time.NewTicker(10 * time.Minute)
for range ticker.C {
    // Runs every 10 minutes
}
```

### 7. Helper Functions

```go
func (m *MetaCache) IsReady() bool {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return !m.lastLoadedAt.IsZero()
}
```

**What it does:** Checks if metadata has been loaded at least once.

```go
func (m *MetaCache) GetTableCount() int {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return len(m.tableByName)
}
```

**What it does:** Returns number of cached tables.

```go
func (m *MetaCache) GetLastRefreshTime() time.Time {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.lastLoadedAt
}
```

**What it does:** Returns when cache was last refreshed.

## Thread Safety

### Why Locks Are Needed

Multiple requests can happen simultaneously:
```
Request 1: Resolve("quotes")   ← Reading
Request 2: Resolve("products") ← Reading
Request 3: Refresh()           ← Writing
```

Without locks, Request 3 could corrupt data while Requests 1 & 2 are reading.

### RWMutex (Read-Write Mutex)

```go
var mu sync.RWMutex

// Reading (multiple readers allowed)
mu.RLock()
value := data[key]
mu.RUnlock()

// Writing (exclusive access)
mu.Lock()
data[key] = newValue
mu.Unlock()
```

**Rules:**
- Multiple reads can happen simultaneously
- Writes block everything (no reads, no other writes)
- Reads block writes (but not other reads)

## Lifecycle

### 1. Creation
```go
metaCache := proxy.NewMetaCache(url, baseID, token)
```

### 2. Initial Load (Blocking)
```go
if err := metaCache.LoadInitial(); err != nil {
    log.Fatal("Failed to load metadata")
}
```

### 3. Start Auto-Refresh (Background)
```go
metaCache.StartAutoRefresh()
```

### 4. Usage (Throughout Program Lifetime)
```go
tableID, ok := metaCache.Resolve("quotes")
linkID, ok := metaCache.ResolveLinkField(tableID, "products")
```

### 5. Auto-Refresh (Every 10 Minutes)
```
[META] Auto-refreshing metadata cache...
[META] Fetching table metadata from NocoDB...
[META] ✅ Successfully loaded 6 tables
```

## Key Takeaway

**MetaCache is the brain of the proxy:**
- Fetches metadata from NocoDB
- Stores translations in memory
- Provides fast lookups (no API calls)
- Refreshes automatically to stay current
- Thread-safe for concurrent requests

Without MetaCache, every request would need to query NocoDB for IDs. With MetaCache, translation is instant!

---

**Next:** [04-proxy-handler.md](./04-proxy-handler.md) - The core request handler.
