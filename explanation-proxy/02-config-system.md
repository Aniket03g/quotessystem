# Configuration System (internal/config/)

The configuration system has 4 main files that work together to load and resolve configuration.

## File Overview

| File | Purpose |
|------|---------|
| `schema.go` | Defines data structures |
| `config.go` | Loads environment variables |
| `loader.go` | Loads YAML configuration |
| `resolver.go` | Converts names to IDs |

## 1. schema.go - Data Structures

This file defines the "shape" of the configuration data.

### ProxyConfig (YAML structure)
```go
type ProxyConfig struct {
    NocoDB NocoDBConfig           `yaml:"nocodb"`
    Tables map[string]TableConfig `yaml:"tables"`
}
```

**What it represents:**
The structure of `proxy.yaml` file.

**Example:**
```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"
tables:
  quotes:
    name: "Quotes"
    operations: [read, create]
```

Maps to:
```go
ProxyConfig{
    NocoDB: NocoDBConfig{BaseID: "pbf7tt48gxdl50h"},
    Tables: map[string]TableConfig{
        "quotes": TableConfig{
            Name: "Quotes",
            Operations: []string{"read", "create"},
        },
    },
}
```

### TableConfig (Single table definition)
```go
type TableConfig struct {
    Name       string            `yaml:"name"`
    Operations []string          `yaml:"operations"`
    Fields     map[string]string `yaml:"fields,omitempty"`
    Links      map[string]Link   `yaml:"links,omitempty"`
}
```

**Fields explained:**
- `Name`: Actual table name in NocoDB (e.g., "Quotes")
- `Operations`: Allowed operations (e.g., ["read", "create", "update"])
- `Fields`: Optional field mappings (currently unused)
- `Links`: Optional link definitions (currently unused)

**The `yaml:"..."` tags:**
Tell Go how to parse YAML. `omitempty` means "skip if empty".

### ResolvedConfig (Runtime structure)
```go
type ResolvedConfig struct {
    BaseID string
    Tables map[string]ResolvedTable
}
```

**What it represents:**
Configuration after names are converted to IDs.

**Example transformation:**
```
ProxyConfig (YAML):
  tables.quotes.name = "Quotes"

↓ (Resolver uses MetaCache)

ResolvedConfig (Runtime):
  tables.quotes.table_id = "clkczb2ifl6l25g"
```

### ResolvedTable (Single resolved table)
```go
type ResolvedTable struct {
    Name       string
    TableID    string
    Operations []string
    Fields     map[string]string
    Links      map[string]ResolvedLink
}
```

**Key difference from TableConfig:**
- Has `TableID` (the actual NocoDB ID)
- Ready to use for validation and routing

## 2. config.go - Environment Variables

This file loads settings from `.env` file.

### Config Structure
```go
type Config struct {
    Port              string
    NocoDBURL         string
    NocoDBToken       string
    NocoDBBaseID      string
    JWTSecret         string
    DatabasePath      string
    SessionSecret     string
    GoogleClientID    string
    GoogleClientSecret string
    GoogleCallbackURL string
    GitHubClientID    string
    GitHubClientSecret string
    GitHubCallbackURL string
}
```

### Load() Function
```go
func Load() *Config {
    if err := godotenv.Load(); err != nil {
        log.Println("[CONFIG WARN] .env file not found, using environment variables")
    }

    return &Config{
        Port:         getEnv("PORT", "8080"),
        NocoDBURL:    getEnv("NOCODB_URL", ""),
        NocoDBToken:  getEnv("NOCODB_TOKEN", ""),
        // ... more fields
    }
}
```

**What it does:**
1. Tries to load `.env` file
2. If not found, uses system environment variables
3. Returns Config struct with all values

**getEnv() helper:**
```go
func getEnv(key, defaultValue string) string {
    if value := os.Getenv(key); value != "" {
        return value
    }
    return defaultValue
}
```

Gets environment variable or returns default if not set.

### MaskSecret() Function
```go
func (c *Config) MaskSecret(secret string) string {
    if len(secret) <= 8 {
        return "***"
    }
    return secret[:4] + "..." + secret[len(secret)-4:]
}
```

**What it does:**
Hides sensitive values in logs.

**Example:**
```
Input:  "my_super_secret_jwt_key_12345"
Output: "my_s...2345"
```

**Why:** Don't want to log full secrets (security risk).

## 3. loader.go - YAML Loading

This file loads `proxy.yaml` configuration.

### LoadProxyConfig() Function
```go
func LoadProxyConfig(path string) (*ProxyConfig, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("failed to read config file: %w", err)
    }

    var config ProxyConfig
    if err := yaml.Unmarshal(data, &config); err != nil {
        return nil, fmt.Errorf("failed to parse YAML: %w", err)
    }

    return &config, nil
}
```

**What it does:**
1. Read file from disk
2. Parse YAML into ProxyConfig struct
3. Return the config

**Error handling:**
- File not found → returns error
- Invalid YAML → returns error
- Valid YAML → returns ProxyConfig

**Example usage:**
```go
config, err := LoadProxyConfig("./config/proxy.yaml")
if err != nil {
    log.Printf("Failed to load config: %v", err)
}
```

## 4. resolver.go - Name to ID Resolution

This is where the magic happens - converting human names to NocoDB IDs.

### MetaCacheInterface
```go
type MetaCacheInterface interface {
    ResolveTable(name string) (string, bool)
    ResolveField(tableID, fieldName string) (string, bool)
}
```

**What it is:**
An interface (contract) that MetaCache must implement.

**Why use interface:**
Makes testing easier - can create fake MetaCache for tests.

### Resolver Structure
```go
type Resolver struct {
    metaCache MetaCacheInterface
}
```

**What it holds:**
Reference to MetaCache for looking up IDs.

### NewResolver() Function
```go
func NewResolver(metaCache MetaCacheInterface) *Resolver {
    return &Resolver{
        metaCache: metaCache,
    }
}
```

**What it does:**
Creates a new Resolver with the given MetaCache.

**Usage:**
```go
resolver := config.NewResolver(metaCache)
```

### Resolve() Function - The Core Logic
```go
func (r *Resolver) Resolve(config *ProxyConfig) (*ResolvedConfig, error) {
    log.Printf("[RESOLVER] Starting resolution of proxy configuration...")

    resolved := &ResolvedConfig{
        BaseID: config.NocoDB.BaseID,
        Tables: make(map[string]ResolvedTable),
    }

    for tableKey, tableConfig := range config.Tables {
        log.Printf("[RESOLVER] Resolving table: %s (name: %s)", tableKey, tableConfig.Name)

        tableID, ok := r.metaCache.ResolveTable(tableConfig.Name)
        if !ok {
            return nil, fmt.Errorf("failed to resolve table '%s' to ID", tableConfig.Name)
        }

        log.Printf("[RESOLVER] Resolved table '%s' -> '%s'", tableConfig.Name, tableID)

        resolvedTable := ResolvedTable{
            Name:       tableConfig.Name,
            TableID:    tableID,
            Operations: tableConfig.Operations,
            Fields:     make(map[string]string),
            Links:      make(map[string]ResolvedLink),
        }

        // Resolve field names to IDs
        for fieldName, fieldAlias := range tableConfig.Fields {
            fieldID, ok := r.metaCache.ResolveField(tableID, fieldName)
            if !ok {
                log.Printf("[RESOLVER WARN] Failed to resolve field '%s' in table '%s', using as-is", fieldName, tableConfig.Name)
                fieldID = fieldName
            } else {
                log.Printf("[RESOLVER] Resolved field '%s' -> '%s'", fieldName, fieldID)
            }
            resolvedTable.Fields[fieldAlias] = fieldID
        }

        // Resolve link field names to IDs
        for linkName, link := range tableConfig.Links {
            fieldID, ok := r.metaCache.ResolveField(tableID, link.Field)
            if !ok {
                log.Printf("[RESOLVER WARN] Failed to resolve link field '%s' in table '%s', using as-is", link.Field, tableConfig.Name)
                fieldID = link.Field
            } else {
                log.Printf("[RESOLVER] Resolved link field '%s' -> '%s'", link.Field, fieldID)
            }

            resolvedTable.Links[linkName] = ResolvedLink{
                FieldID:     fieldID,
                TargetTable: link.TargetTable,
            }
        }

        resolved.Tables[tableKey] = resolvedTable
    }

    log.Printf("[RESOLVER] Successfully resolved %d tables", len(resolved.Tables))
    return resolved, nil
}
```

**What it does - Step by Step:**

1. **Create empty ResolvedConfig**
   ```go
   resolved := &ResolvedConfig{
       BaseID: config.NocoDB.BaseID,
       Tables: make(map[string]ResolvedTable),
   }
   ```

2. **Loop through each table in proxy.yaml**
   ```go
   for tableKey, tableConfig := range config.Tables {
   ```

3. **Resolve table name to ID**
   ```go
   tableID, ok := r.metaCache.ResolveTable(tableConfig.Name)
   if !ok {
       return nil, fmt.Errorf("failed to resolve table '%s' to ID", tableConfig.Name)
   }
   ```
   
   Example:
   - Input: "Quotes"
   - MetaCache lookup: "quotes" → "clkczb2ifl6l25g"
   - Output: "clkczb2ifl6l25g"

4. **Create ResolvedTable with the ID**
   ```go
   resolvedTable := ResolvedTable{
       Name:       tableConfig.Name,
       TableID:    tableID,  // ← The resolved ID!
       Operations: tableConfig.Operations,
       // ...
   }
   ```

5. **Resolve field names (if any)**
   ```go
   for fieldName, fieldAlias := range tableConfig.Fields {
       fieldID, ok := r.metaCache.ResolveField(tableID, fieldName)
       // ...
   }
   ```

6. **Resolve link field names (if any)**
   ```go
   for linkName, link := range tableConfig.Links {
       fieldID, ok := r.metaCache.ResolveField(tableID, link.Field)
       // ...
   }
   ```

7. **Store resolved table**
   ```go
   resolved.Tables[tableKey] = resolvedTable
   ```

8. **Return complete ResolvedConfig**
   ```go
   return resolved, nil
   ```

## How They Work Together

### Startup Flow:
```
1. main.go calls config.Load()
   ↓
   config.go reads .env file
   ↓
   Returns Config struct

2. main.go calls config.LoadProxyConfig()
   ↓
   loader.go reads proxy.yaml
   ↓
   Returns ProxyConfig struct

3. main.go creates MetaCache and fetches metadata

4. main.go calls resolver.Resolve()
   ↓
   resolver.go loops through tables
   ↓
   For each table, asks MetaCache for ID
   ↓
   Returns ResolvedConfig struct
```

### Example Transformation:

**Input (proxy.yaml):**
```yaml
tables:
  quotes:
    name: "Quotes"
    operations: [read, create]
```

**Loaded (ProxyConfig):**
```go
ProxyConfig{
    Tables: map[string]TableConfig{
        "quotes": {
            Name: "Quotes",
            Operations: []string{"read", "create"},
        },
    },
}
```

**Resolved (ResolvedConfig):**
```go
ResolvedConfig{
    Tables: map[string]ResolvedTable{
        "quotes": {
            Name: "Quotes",
            TableID: "clkczb2ifl6l25g",  // ← Added by Resolver!
            Operations: []string{"read", "create"},
        },
    },
}
```

## Key Concepts

### Why Two Config Structures?

**ProxyConfig** (YAML):
- Human-readable names
- Easy to edit
- Stored in file

**ResolvedConfig** (Runtime):
- NocoDB IDs
- Ready for validation
- Stored in memory

### Error Handling Strategy

**Fatal errors** (can't continue):
```go
if !ok {
    return nil, fmt.Errorf("failed to resolve table '%s' to ID", tableConfig.Name)
}
```

**Non-fatal errors** (log warning, continue):
```go
if !ok {
    log.Printf("[RESOLVER WARN] Failed to resolve field '%s', using as-is", fieldName)
    fieldID = fieldName
}
```

### The `ok` Pattern

Go functions often return `(value, bool)`:
```go
tableID, ok := r.metaCache.ResolveTable(name)
if !ok {
    // Not found
}
```

- `ok = true`: Found
- `ok = false`: Not found

## Key Takeaway

**The configuration system has a clear pipeline:**

1. **Load** environment variables (`.env`)
2. **Load** YAML configuration (`proxy.yaml`)
3. **Resolve** names to IDs using MetaCache
4. **Use** resolved config for validation

Each file has a single responsibility, making the system easy to understand and maintain.

---

**Next:** [03-metacache.md](./03-metacache.md) - The translation dictionary in detail.
