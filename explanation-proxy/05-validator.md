# Validator (internal/proxy/validator.go)

The validator checks if requests are allowed based on the configuration.

## Structure

### Validator
```go
type Validator struct {
    config    *config.ResolvedConfig
    metaCache *MetaCache
}
```

**Fields:**
- `config`: Configuration with resolved IDs
- `metaCache`: For additional lookups if needed

### ValidationResult
```go
type ValidationResult struct {
    TableKey     string
    TableID      string
    Operation    string
    ResolvedPath string
}
```

**What it contains:**
- `TableKey`: Key from config (e.g., "quotes")
- `TableID`: NocoDB table ID (e.g., "clkczb2ifl6l25g")
- `Operation`: What operation is being performed (e.g., "read")
- `ResolvedPath`: Full path with IDs (e.g., "clkczb2ifl6l25g/records")

## Constructor

### NewValidator()
```go
func NewValidator(config *config.ResolvedConfig, metaCache *MetaCache) *Validator {
    return &Validator{
        config:    config,
        metaCache: metaCache,
    }
}
```

**Usage:**
```go
validator := proxy.NewValidator(resolvedConfig, metaCache)
```

## Main Function: ValidateRequest()

```go
func (v *Validator) ValidateRequest(method, path string) (*ValidationResult, error) {
    log.Printf("[VALIDATOR] Validating request: %s %s", method, path)

    // Parse the path to extract table key
    parts := strings.SplitN(path, "/", 2)
    if len(parts) == 0 || parts[0] == "" {
        return nil, fmt.Errorf("invalid path: %s", path)
    }

    tableKey := parts[0]
    log.Printf("[VALIDATOR] Table key: %s", tableKey)

    // Look up table in configuration
    table, exists := v.config.Tables[tableKey]
    if !exists {
        return nil, fmt.Errorf("table '%s' not found in configuration", tableKey)
    }
    log.Printf("[VALIDATOR] ✓ Table '%s' found in config", tableKey)

    // Determine operation from HTTP method and path
    operation := v.determineOperation(method, path)
    log.Printf("[VALIDATOR] Operation: %s", operation)

    // Check if operation is allowed
    if !v.isOperationAllowed(table.Operations, operation) {
        return nil, fmt.Errorf("operation '%s' not allowed for table '%s'", operation, tableKey)
    }
    log.Printf("[VALIDATOR] ✓ Operation '%s' is allowed", operation)

    // Build resolved path
    var resolvedPath string
    if len(parts) == 2 {
        resolvedPath = table.TableID + "/" + parts[1]
    } else {
        resolvedPath = table.TableID
    }

    return &ValidationResult{
        TableKey:     tableKey,
        TableID:      table.TableID,
        Operation:    operation,
        ResolvedPath: resolvedPath,
    }, nil
}
```

### Breaking Down ValidateRequest()

#### Step 1: Parse Path
```go
parts := strings.SplitN(path, "/", 2)
tableKey := parts[0]
```

**Example:**
```
Input:  "quotes/records"
Parts:  ["quotes", "records"]
TableKey: "quotes"
```

#### Step 2: Look Up Table in Config
```go
table, exists := v.config.Tables[tableKey]
if !exists {
    return nil, fmt.Errorf("table '%s' not found in configuration", tableKey)
}
```

**What it checks:**
Is this table defined in `proxy.yaml`?

**Example config:**
```yaml
tables:
  quotes:
    name: "Quotes"
    operations: [read, create]
```

If `tableKey = "quotes"`, lookup succeeds.
If `tableKey = "unicorns"`, lookup fails → error.

#### Step 3: Determine Operation
```go
operation := v.determineOperation(method, path)
```

**What it does:**
Maps HTTP method + path to operation type.

**Examples:**
- `GET /quotes/records` → "read"
- `POST /quotes/records` → "create"
- `PATCH /quotes/records/123` → "update"
- `DELETE /quotes/records/123` → "delete"
- `POST /quotes/links/products/123` → "link"

#### Step 4: Check If Operation Is Allowed
```go
if !v.isOperationAllowed(table.Operations, operation) {
    return nil, fmt.Errorf("operation '%s' not allowed for table '%s'", operation, tableKey)
}
```

**What it checks:**
Is this operation in the allowed list?

**Example:**
```yaml
tables:
  quotes:
    operations: [read, create, update]
```

- "read" → ✓ Allowed
- "create" → ✓ Allowed
- "delete" → ✗ Not allowed (returns error)

#### Step 5: Build Resolved Path
```go
if len(parts) == 2 {
    resolvedPath = table.TableID + "/" + parts[1]
} else {
    resolvedPath = table.TableID
}
```

**Example:**
```
TableID: "clkczb2ifl6l25g"
Parts: ["quotes", "records"]
Result: "clkczb2ifl6l25g/records"
```

#### Step 6: Return ValidationResult
```go
return &ValidationResult{
    TableKey:     "quotes",
    TableID:      "clkczb2ifl6l25g",
    Operation:    "read",
    ResolvedPath: "clkczb2ifl6l25g/records",
}, nil
```

## Helper Function: determineOperation()

```go
func (v *Validator) determineOperation(method, path string) string {
    // Check if it's a link operation
    if strings.Contains(path, "/links/") {
        return "link"
    }

    // Map HTTP methods to operations
    switch method {
    case "GET":
        return "read"
    case "POST":
        return "create"
    case "PATCH", "PUT":
        return "update"
    case "DELETE":
        return "delete"
    default:
        return "unknown"
    }
}
```

**What it does:**
Converts HTTP method to operation name.

**Mapping:**
```
GET    → read
POST   → create (or link if path contains "/links/")
PATCH  → update
PUT    → update
DELETE → delete
```

**Special case - Links:**
```
POST /quotes/links/products/123 → "link" (not "create")
```

## Helper Function: isOperationAllowed()

```go
func (v *Validator) isOperationAllowed(allowedOps []string, operation string) bool {
    for _, op := range allowedOps {
        if op == operation {
            return true
        }
    }
    return false
}
```

**What it does:**
Checks if operation is in the allowed list.

**Example:**
```go
allowedOps := []string{"read", "create", "update"}
isOperationAllowed(allowedOps, "read")   // true
isOperationAllowed(allowedOps, "delete") // false
```

## Validation Examples

### Example 1: Allowed Request
```
Request: GET /proxy/quotes/records
Config:
  quotes:
    operations: [read, create]

Validation:
1. Parse: tableKey = "quotes"
2. Lookup: ✓ Found in config
3. Operation: "read" (from GET)
4. Check: ✓ "read" is in [read, create]
5. Result: ValidationResult{...}
```

**Outcome:** ✓ Request proceeds

### Example 2: Operation Not Allowed
```
Request: DELETE /proxy/quotes/records/123
Config:
  quotes:
    operations: [read, create]

Validation:
1. Parse: tableKey = "quotes"
2. Lookup: ✓ Found in config
3. Operation: "delete" (from DELETE)
4. Check: ✗ "delete" is NOT in [read, create]
5. Error: "operation 'delete' not allowed for table 'quotes'"
```

**Outcome:** ✗ Request blocked (403 Forbidden)

### Example 3: Table Not in Config
```
Request: GET /proxy/unicorns/records
Config:
  quotes:
    operations: [read, create]
  products:
    operations: [read]

Validation:
1. Parse: tableKey = "unicorns"
2. Lookup: ✗ NOT found in config
3. Error: "table 'unicorns' not found in configuration"
```

**Outcome:** ✗ Request blocked (403 Forbidden)

### Example 4: Link Operation
```
Request: POST /proxy/quotes/links/products/123
Config:
  quotes:
    operations: [read, create, link]

Validation:
1. Parse: tableKey = "quotes"
2. Lookup: ✓ Found in config
3. Operation: "link" (path contains "/links/")
4. Check: ✓ "link" is in [read, create, link]
5. Result: ValidationResult{...}
```

**Outcome:** ✓ Request proceeds

## Integration with ProxyHandler

The validator is called from `ProxyHandler.ServeHTTP()`:

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

**Flow:**
1. ProxyHandler receives request
2. Calls Validator.ValidateRequest()
3. If validation fails → return 403 error
4. If validation succeeds → use resolved path

## Security Benefits

### 1. Whitelist Approach
Only explicitly allowed operations work.

**Config:**
```yaml
products:
  operations: [read]
```

**Result:**
- GET → ✓ Allowed
- POST → ✗ Blocked
- PATCH → ✗ Blocked
- DELETE → ✗ Blocked

### 2. Table-Level Control
Different tables can have different permissions.

**Config:**
```yaml
quotes:
  operations: [read, create, update, delete, link]
products:
  operations: [read]
```

**Result:**
- Users can fully manage quotes
- Users can only view products

### 3. Prevents Unauthorized Access
Even if someone knows a table ID, they can't access it without config entry.

**Attempt:**
```
GET /proxy/secret_table/records
```

**Result:**
```
403 Forbidden
"table 'secret_table' not found in configuration"
```

## Error Messages

### Table Not Found
```
"table 'unicorns' not found in configuration"
```

**Cause:** Table not defined in `proxy.yaml`

### Operation Not Allowed
```
"operation 'delete' not allowed for table 'quotes'"
```

**Cause:** Operation not in the allowed list

### Invalid Path
```
"invalid path: "
```

**Cause:** Empty or malformed path

## Key Takeaway

**The validator is the security gatekeeper:**
- Checks every request against configuration
- Only allows explicitly permitted operations
- Provides clear error messages
- Works with resolved IDs for efficiency

Without the validator, all operations would be allowed (legacy mode). With the validator, you have fine-grained control over what users can do!

---

**Next:** [06-auth-system.md](./06-auth-system.md) - Authentication and user management.
