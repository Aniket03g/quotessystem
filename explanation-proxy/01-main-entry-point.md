# Main Entry Point (main.go)

## What This File Does

`main.go` is where the proxy starts. When you run `./generic-proxy.exe`, this file executes.

Think of it as the **conductor of an orchestra** - it doesn't play instruments itself, but it coordinates all the musicians (components) to work together.

## The main() Function - Step by Step

### Step 1: Setup Logging
```go
log.SetFlags(log.LstdFlags | log.Lshortfile)
log.Println("[STARTUP] Initializing Generic Proxy Server with OAuth...")
```

**What it does:**
- Configures log format to show timestamps and file locations
- Prints startup message

**Why:** Helps debug issues by showing where log messages come from.

### Step 2: Load Environment Configuration
```go
cfg := config.Load()
```

**What it does:**
- Reads `.env` file
- Gets values like `PORT`, `NOCODB_URL`, `NOCODB_TOKEN`, `JWT_SECRET`

**Why:** Configuration should be in environment variables, not hardcoded.

**Returns:**
```go
type Config struct {
    Port           string  // "8080"
    NocoDBURL      string  // "http://localhost:8090/api/v3/data/project/"
    NocoDBToken    string  // "your_token_here"
    NocoDBBaseID   string  // "pbf7tt48gxdl50h"
    JWTSecret      string  // "your_jwt_secret"
    DatabasePath   string  // "./users.db"
    // ... more fields
}
```

### Step 3: Load Proxy Configuration (Optional)
```go
proxyConfigPath := os.Getenv("PROXY_CONFIG_PATH")
if proxyConfigPath == "" {
    proxyConfigPath = "./config/proxy.yaml"
}

if _, err := os.Stat(proxyConfigPath); err == nil {
    proxyConfig, err = config.LoadProxyConfig(proxyConfigPath)
    // ...
}
```

**What it does:**
- Looks for `proxy.yaml` file
- If found, loads table definitions and permissions
- If not found, runs in "legacy mode" (no validation)

**Why:** Allows schema-driven validation (recommended) or open access (development).

### Step 4: Initialize User Database
```go
database, err := db.NewDatabase(cfg.DatabasePath)
if err != nil {
    log.Fatalf("[STARTUP ERROR] Failed to initialize database: %v", err)
}
defer database.Close()
```

**What it does:**
- Opens SQLite database file (`users.db`)
- Creates tables if they don't exist
- Stores user accounts (email, password, OAuth info)

**Why:** Need to store user credentials somewhere.

**defer database.Close():** Ensures database closes when program exits.

### Step 5: Initialize OAuth Providers
```go
initializeGothProviders(cfg)
```

**What it does:**
- Sets up Google OAuth (if configured)
- Sets up GitHub OAuth (if configured)

**Why:** Allows users to log in with Google/GitHub instead of passwords.

### Step 6: Setup Session Store
```go
store := sessions.NewCookieStore([]byte(cfg.SessionSecret))
store.MaxAge(86400 * 30) // 30 days
gothic.Store = store
```

**What it does:**
- Creates encrypted cookie storage
- Used for OAuth flow (temporary state)

**Why:** OAuth requires storing temporary data during login process.

### Step 7: Initialize MetaCache
```go
metaBaseURL := deriveMetaBaseURL(nocoDBURL)
metaCache = proxy.NewMetaCache(metaBaseURL, cfg.NocoDBBaseID, cfg.NocoDBToken)

if err := metaCache.LoadInitial(); err != nil {
    log.Fatalf("[STARTUP FATAL] MetaCache initial load failed: %v", err)
}

metaCache.StartAutoRefresh()
```

**What it does:**
- Creates MetaCache instance
- Fetches metadata from NocoDB (synchronous - blocks startup)
- Starts background refresh every 10 minutes

**Why:** Need the translation dictionary before accepting requests.

**Critical:** If this fails, the proxy can't translate names to IDs, so it exits.

### Step 8: Resolve Configuration
```go
if proxyConfig != nil {
    resolver := config.NewResolver(metaCache)
    resolvedConfig, err = resolver.Resolve(proxyConfig)
    // ...
}
```

**What it does:**
- Takes `proxy.yaml` (with human names)
- Uses MetaCache to convert names to IDs
- Creates `ResolvedConfig` (with IDs)

**Example:**
```yaml
# proxy.yaml (input)
tables:
  quotes:
    name: "Quotes"

# ResolvedConfig (output)
tables:
  quotes:
    name: "Quotes"
    table_id: "clkczb2ifl6l25g"
```

### Step 9: Create Proxy Handler
```go
proxyHandler := proxy.NewProxyHandler(nocoDBURL, cfg.NocoDBToken, metaCache)

if resolvedConfig != nil {
    proxyHandler.SetResolvedConfig(resolvedConfig)
}
```

**What it does:**
- Creates the main request handler
- Gives it NocoDB connection details
- Gives it MetaCache for translation
- Gives it ResolvedConfig for validation (if available)

**Why:** This is the core component that forwards requests to NocoDB.

### Step 10: Create Other Handlers
```go
authHandler := auth.NewHandler(database, cfg.JWTSecret, "http://localhost:4321")
introspectHandler := introspect.NewHandler(metaCache, resolvedConfig, proxyConfigPath)
```

**What it does:**
- `authHandler`: Handles login, signup, OAuth
- `introspectHandler`: Provides status and schema info

### Step 11: Setup Routes
```go
mux := http.NewServeMux()

// Public endpoints (no auth required)
mux.HandleFunc("/login", loginHandler(database, cfg.JWTSecret))
mux.HandleFunc("/signup", signupHandler(database, cfg.JWTSecret))
mux.HandleFunc("/health", healthHandler)

// OAuth endpoints
mux.HandleFunc("/auth/google", authHandler.BeginAuth)
mux.HandleFunc("/auth/google/callback", authHandler.CallbackAuth)

// Protected endpoints (auth required)
protectedHandler := middleware.AuthMiddleware(cfg.JWTSecret)(
    middleware.AuthorizeMiddleware(proxyHandler),
)
mux.Handle("/proxy/", protectedHandler)
```

**What it does:**
- Maps URLs to handler functions
- Public routes: anyone can access
- Protected routes: require JWT token

**Route structure:**
```
/login              → loginHandler (public)
/signup             → signupHandler (public)
/health             → healthHandler (public)
/auth/google        → OAuth flow (public)
/proxy/*            → proxyHandler (protected)
/__proxy/status     → introspectHandler (public)
```

### Step 12: Apply CORS Middleware
```go
handler := middleware.CORSMiddleware(mux)
```

**What it does:**
- Wraps all routes with CORS headers
- Allows frontend (on different port) to make requests

**Why:** Browsers block cross-origin requests by default.

### Step 13: Start Server
```go
addr := ":" + cfg.Port
log.Printf("[STARTUP] Server Address: %s", addr)

if err := http.ListenAndServe(addr, handler); err != nil {
    log.Fatal(err)
}
```

**What it does:**
- Starts HTTP server on specified port (default: 8080)
- Listens for incoming requests
- Blocks here forever (until program exits)

**Why:** This is the actual web server.

## The Complete Startup Sequence

```
1. Configure logging
2. Load .env configuration
3. Load proxy.yaml (optional)
4. Open user database
5. Setup OAuth providers
6. Create session store
7. Fetch NocoDB metadata (BLOCKS until complete)
8. Start metadata auto-refresh (background)
9. Resolve configuration (names → IDs)
10. Create proxy handler
11. Create auth handler
12. Setup routes
13. Apply CORS middleware
14. Start HTTP server (BLOCKS forever)
```

## Helper Functions in main.go

### loginHandler()
```go
func loginHandler(database *db.Database, jwtSecret string) http.HandlerFunc
```

**What it does:**
- Validates email/password
- Generates JWT token
- Returns token to frontend

**Flow:**
1. Parse request body (email, password)
2. Check database for user
3. Validate password (bcrypt)
4. Generate JWT token
5. Return token

### signupHandler()
```go
func signupHandler(database *db.Database, jwtSecret string) http.HandlerFunc
```

**What it does:**
- Creates new user account
- Hashes password
- Generates JWT token
- Returns token

**Flow:**
1. Parse request body (email, password, name)
2. Validate input (email format, password length)
3. Check if user already exists
4. Hash password (bcrypt)
5. Insert into database
6. Generate JWT token
7. Return token

### healthHandler()
```go
func healthHandler(w http.ResponseWriter, r *http.Request)
```

**What it does:**
- Returns `{"status": "ok"}`
- Used for health checks (monitoring, load balancers)

## Key Concepts

### Blocking vs Non-Blocking

**Blocking operations** (program waits):
- `metaCache.LoadInitial()` - Must complete before accepting requests
- `http.ListenAndServe()` - Runs forever

**Non-blocking operations** (runs in background):
- `metaCache.StartAutoRefresh()` - Goroutine refreshes periodically

### Error Handling Patterns

**Fatal errors** (exit program):
```go
if err != nil {
    log.Fatalf("[STARTUP FATAL] %v", err)
}
```
Used when the proxy can't function (e.g., can't load metadata).

**Non-fatal errors** (log and continue):
```go
if err != nil {
    log.Printf("[STARTUP WARN] %v", err)
    log.Printf("[STARTUP] Continuing in legacy mode")
}
```
Used when a feature is optional (e.g., proxy.yaml missing).

### Middleware Wrapping

Middleware wraps handlers like layers:
```
Request
  ↓
CORSMiddleware (adds CORS headers)
  ↓
AuthMiddleware (validates JWT)
  ↓
ProxyHandler (forwards to NocoDB)
  ↓
Response
```

Each layer can:
- Modify the request
- Block the request (return error)
- Modify the response
- Pass to next layer

## Key Takeaway

**main.go orchestrates the entire system:**
- Loads configuration
- Initializes components
- Connects them together
- Starts the server

It's the **glue** that makes all the pieces work as one system.

---

**Next:** [02-config-system.md](./02-config-system.md) - Understanding the configuration system.
