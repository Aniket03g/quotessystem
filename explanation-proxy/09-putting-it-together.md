# Putting It All Together

Now that we've explored each component, let's see how they all work together in a complete system.

## The Complete Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│                    (Browser / Mobile App)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Request
                             │ Authorization: Bearer <JWT>
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                      PROXY SERVER (Go)                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ main.go - Entry Point                                       │ │
│  │ • Initializes all components                                │ │
│  │ • Sets up routes                                            │ │
│  │ • Starts HTTP server                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                             │                                     │
│  ┌─────────────────────────┴──────────────────────────────────┐ │
│  │ Middleware Stack                                            │ │
│  │ ┌────────────────────────────────────────────────────────┐ │ │
│  │ │ CORSMiddleware - Add CORS headers                      │ │ │
│  │ └────────────────────────────────────────────────────────┘ │ │
│  │ ┌────────────────────────────────────────────────────────┐ │ │
│  │ │ AuthMiddleware - Validate JWT token                    │ │ │
│  │ └────────────────────────────────────────────────────────┘ │ │
│  │ ┌────────────────────────────────────────────────────────┐ │ │
│  │ │ AuthorizeMiddleware - Check permissions                │ │ │
│  │ └────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────┬──────────────────────────────────┘ │
│                             │                                     │
│  ┌─────────────────────────┴──────────────────────────────────┐ │
│  │ ProxyHandler                                                │ │
│  │ • Validates request (Validator)                             │ │
│  │ • Translates names to IDs (MetaCache)                       │ │
│  │ • Forwards to NocoDB                                        │ │
│  └─────────────────────────┬──────────────────────────────────┘ │
│                             │                                     │
│  ┌──────────────┬──────────┴────────┬──────────────┐            │
│  │              │                   │              │            │
│  │ MetaCache    │ Validator         │ Config       │ Database   │
│  │ • Table IDs  │ • Check ops       │ • proxy.yaml │ • Users    │
│  │ • Field IDs  │ • Resolve paths   │ • .env       │ • SQLite   │
│  │ • Auto-      │                   │              │            │
│  │   refresh    │                   │              │            │
│  └──────────────┴───────────────────┴──────────────┘            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Request (with NocoDB token)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                         NOCODB                                   │
│                    (Database Backend)                            │
└─────────────────────────────────────────────────────────────────┘
```

## Component Interactions

### 1. Startup Sequence

```
main.go starts
  ↓
Load .env configuration
  ↓
Load proxy.yaml (optional)
  ↓
Initialize Database (SQLite)
  ↓
Initialize MetaCache
  ├─ Fetch metadata from NocoDB (BLOCKS)
  ├─ Build translation dictionaries
  └─ Start auto-refresh (background)
  ↓
Resolve Configuration
  ├─ Use MetaCache to convert names to IDs
  └─ Create ResolvedConfig
  ↓
Create ProxyHandler
  ├─ Give it MetaCache
  └─ Give it ResolvedConfig
  ↓
Setup Routes
  ├─ /login, /signup (public)
  ├─ /auth/* (OAuth)
  └─ /proxy/* (protected)
  ↓
Apply Middleware
  ├─ CORS (outermost)
  ├─ Auth (validates JWT)
  └─ Authorize (checks permissions)
  ↓
Start HTTP Server (BLOCKS forever)
```

### 2. Request Processing Flow

#### Example: GET /proxy/quotes/records

```
1. Frontend
   GET /proxy/quotes/records
   Authorization: Bearer eyJhbGc...
   
2. CORSMiddleware
   • Check origin: http://localhost:4321
   • Add CORS headers
   • Pass to next →
   
3. AuthMiddleware
   • Extract JWT token
   • Validate signature
   • Check expiration
   • Extract user_id and role
   • Add to context
   • Pass to next →
   
4. AuthorizeMiddleware
   • Check user_id exists in context
   • Log authorization
   • Pass to next →
   
5. ProxyHandler
   • Extract path: "quotes/records"
   • Call Validator
   
6. Validator
   • Parse: tableKey = "quotes"
   • Lookup in config: ✓ Found
   • Determine operation: "read" (from GET)
   • Check allowed: ✓ "read" in operations list
   • Return ValidationResult
   
7. ProxyHandler (continued)
   • Get resolved path from ValidationResult
   • Call MetaCache
   
8. MetaCache
   • Lookup: "quotes" → "clkczb2ifl6l25g"
   • Return table ID
   
9. ProxyHandler (continued)
   • Build URL: http://nocodb.../clkczb2ifl6l25g/records
   • Create HTTP request
   • Add xc-token header (NocoDB auth)
   • Forward to NocoDB
   
10. NocoDB
    • Validate token
    • Query database
    • Return records
    
11. ProxyHandler (continued)
    • Receive response from NocoDB
    • Copy headers (skip CORS)
    • Return response to frontend
    
12. Frontend
    • Receive JSON response
    • Parse and display data
```

## Data Flow Diagrams

### Login Flow

```
User enters email/password
  ↓
Frontend: POST /login
  ↓
loginHandler (main.go)
  ↓
Database.ValidatePassword()
  ├─ Find user by email
  ├─ Compare password hash (bcrypt)
  └─ Return user if valid
  ↓
utils.GenerateJWT()
  ├─ Create claims (user_id, role, exp)
  ├─ Sign with secret
  └─ Return JWT token
  ↓
Return to frontend: {token, user_id, role}
  ↓
Frontend stores token in localStorage
  ↓
Frontend redirects to dashboard
```

### OAuth Flow

```
User clicks "Login with Google"
  ↓
Frontend: GET /auth/google
  ↓
BeginAuth() redirects to Google
  ↓
User logs in at Google
  ↓
Google redirects: /auth/google/callback?code=xyz
  ↓
CallbackAuth()
  ├─ Exchange code for user info
  ├─ Get email, name from Google
  └─ Call Database.CreateOrUpdateOAuthUser()
      ├─ Check if user exists
      ├─ Create new or update existing
      └─ Return user
  ↓
utils.GenerateJWT()
  └─ Generate token
  ↓
Redirect to frontend: /auth/callback?token=eyJhbGc...
  ↓
Frontend extracts token from URL
  ↓
Frontend stores token
  ↓
Frontend redirects to dashboard
```

### Data Request Flow

```
Frontend needs quotes
  ↓
GET /proxy/quotes/records
Authorization: Bearer <token>
  ↓
Middleware Stack
  ├─ CORS: Add headers
  ├─ Auth: Validate token, extract user_id
  └─ Authorize: Check user_id exists
  ↓
ProxyHandler
  ├─ Validator: Check operation allowed
  └─ MetaCache: Translate "quotes" → ID
  ↓
Forward to NocoDB
  ├─ URL: /api/v3/.../clkczb2ifl6l25g/records
  └─ Header: xc-token
  ↓
NocoDB returns data
  ↓
ProxyHandler forwards response
  ↓
Frontend receives and displays data
```

## Configuration Dependencies

### Environment Variables (.env)
```
PORT=8080
NOCODB_URL=http://localhost:8090/api/v3/data/project/
NOCODB_TOKEN=your_token
NOCODB_BASE_ID=pbf7tt48gxdl50h
JWT_SECRET=your_secret
DATABASE_PATH=./users.db
```

**Used by:**
- `config.Load()` - Loads all variables
- `main.go` - Uses for initialization

### Proxy Configuration (proxy.yaml)
```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"

tables:
  quotes:
    name: "Quotes"
    operations: [read, create, update, delete, link]
```

**Used by:**
- `config.LoadProxyConfig()` - Loads YAML
- `config.Resolver` - Resolves names to IDs
- `Validator` - Validates operations

### NocoDB Metadata (fetched at runtime)
```json
{
  "list": [
    {"id": "clkczb2ifl6l25g", "title": "Quotes"},
    {"id": "tbl_abc123", "title": "Products"}
  ]
}
```

**Used by:**
- `MetaCache.Refresh()` - Fetches and caches
- `Resolver` - Converts config names to IDs
- `ProxyHandler` - Translates request paths

## Error Handling Chain

### Example: Invalid Token

```
Frontend: GET /proxy/quotes/records
Authorization: Bearer invalid_token
  ↓
CORSMiddleware: ✓ Pass
  ↓
AuthMiddleware: ✗ Token invalid
  ├─ jwt.Parse() returns error
  ├─ Log: "[AUTH ERROR] Token validation failed"
  └─ Return: 401 Unauthorized
  ↓
Frontend receives 401
  ├─ Detect unauthorized
  ├─ Clear stored token
  └─ Redirect to login
```

### Example: Operation Not Allowed

```
Frontend: DELETE /proxy/quotes/records/123
Authorization: Bearer valid_token
  ↓
CORSMiddleware: ✓ Pass
  ↓
AuthMiddleware: ✓ Pass (token valid)
  ↓
AuthorizeMiddleware: ✓ Pass
  ↓
ProxyHandler → Validator
  ├─ Table: "quotes" ✓ Found
  ├─ Operation: "delete" (from DELETE)
  ├─ Check: "delete" NOT in [read, create, update]
  └─ Return error: "operation 'delete' not allowed"
  ↓
ProxyHandler: Return 403 Forbidden
  ↓
Frontend receives 403
  └─ Show error: "You don't have permission"
```

### Example: Table Not Found

```
Frontend: GET /proxy/unicorns/records
Authorization: Bearer valid_token
  ↓
Middleware Stack: ✓ All pass
  ↓
ProxyHandler → Validator
  ├─ Table: "unicorns"
  ├─ Lookup in config: ✗ Not found
  └─ Return error: "table 'unicorns' not found"
  ↓
ProxyHandler: Return 403 Forbidden
  ↓
Frontend receives 403
  └─ Show error: "Invalid request"
```

## State Management

### MetaCache State
```
Initial: Empty maps
  ↓
LoadInitial(): Fetch from NocoDB
  ├─ tableByName: {"quotes": "clkczb2ifl6l25g", ...}
  ├─ linkFieldsByTable: {...}
  └─ lastLoadedAt: 2024-12-23 08:00:00
  ↓
Every 10 minutes: Auto-refresh
  ├─ Fetch latest metadata
  ├─ Update maps atomically
  └─ Update lastLoadedAt
```

### Database State
```
Initial: Empty users table
  ↓
User signs up
  ├─ INSERT INTO users (...)
  └─ users table: [user1]
  ↓
User logs in with OAuth
  ├─ INSERT or UPDATE users
  └─ users table: [user1, user2]
  ↓
Persistent: Stored in users.db file
```

### Request Context State
```
Request arrives
  ↓
AuthMiddleware adds to context:
  ├─ user_id: "123"
  └─ role: "user"
  ↓
Available in all subsequent handlers:
  ├─ ProxyHandler
  ├─ AuthorizeMiddleware
  └─ Custom handlers
  ↓
Request completes, context discarded
```

## Performance Characteristics

### Startup Time
```
MetaCache.LoadInitial(): ~500ms - 2s
  ├─ Depends on: Number of tables, network latency
  └─ Blocks startup until complete

Total startup: ~1-3 seconds
```

### Request Latency
```
Middleware overhead: ~1-5ms
  ├─ CORS: <1ms
  ├─ Auth (JWT validation): ~1-3ms
  └─ Authorize: <1ms

MetaCache lookup: <1ms (in-memory)

Validator: <1ms (map lookup)

NocoDB request: ~50-500ms
  └─ Depends on: Query complexity, network

Total: ~55-510ms per request
```

### Memory Usage
```
MetaCache: ~10-50 KB
  └─ Depends on: Number of tables/fields

Database connections: ~1-2 MB

Go runtime: ~10-20 MB

Total: ~15-30 MB (very lightweight!)
```

## Scalability Considerations

### Current Design
- Single-threaded MetaCache refresh (fine for most use cases)
- SQLite database (good for <100k users)
- No connection pooling (Go handles this automatically)
- No caching of NocoDB responses (every request hits NocoDB)

### Scaling Up
If you need to handle more load:

1. **Add Redis caching**
   ```go
   // Cache NocoDB responses
   cachedData := redis.Get("quotes:records")
   if cachedData != nil {
       return cachedData
   }
   ```

2. **Use PostgreSQL instead of SQLite**
   ```go
   // For >100k users
   db, err := sql.Open("postgres", connectionString)
   ```

3. **Add rate limiting**
   ```go
   // Prevent abuse
   if !rateLimiter.Allow(userID) {
       return 429 // Too Many Requests
   }
   ```

4. **Horizontal scaling**
   ```
   Load Balancer
     ├─ Proxy Instance 1
     ├─ Proxy Instance 2
     └─ Proxy Instance 3
   ```

## Key Takeaway

**The proxy is a well-architected system where:**

- **main.go** orchestrates initialization
- **Middleware** provides cross-cutting concerns (CORS, auth)
- **MetaCache** translates names to IDs
- **Validator** enforces permissions
- **ProxyHandler** forwards requests
- **Database** stores user accounts
- **Config** drives behavior

Each component has a single responsibility, making the system:
- Easy to understand
- Easy to test
- Easy to extend
- Easy to maintain

All components work together seamlessly to provide a secure, flexible, and maintainable proxy layer between your frontend and NocoDB!
