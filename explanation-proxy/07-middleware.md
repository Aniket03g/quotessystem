# Middleware (internal/middleware/)

Middleware are functions that wrap HTTP handlers to add functionality.

## What is Middleware?

Think of middleware as **layers of an onion**:

```
Request
  ↓
[CORS Middleware] ← Adds CORS headers
  ↓
[Auth Middleware] ← Validates JWT token
  ↓
[Handler] ← Your actual logic
  ↓
Response
```

Each layer can:
- Inspect the request
- Modify the request
- Block the request (return error)
- Modify the response
- Pass to next layer

## Files Overview

| File | Purpose |
|------|---------|
| `cors.go` | CORS headers for cross-origin requests |
| `auth.go` | JWT token validation (already covered) |
| `authorize.go` | Authorization logic |

## 1. cors.go - CORS Middleware

### What is CORS?

**CORS** = Cross-Origin Resource Sharing

**The problem:**
```
Frontend: http://localhost:4321
Proxy:    http://localhost:8080

Browser blocks requests from 4321 to 8080 (different origins)
```

**The solution:**
Proxy adds special headers telling browser "it's okay, I allow this origin".

### CORSMiddleware()
```go
func CORSMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("[CORS] Handling request: %s %s from origin: %s", r.Method, r.URL.Path, r.Header.Get("Origin"))

        // Allowed origins
        allowedOrigins := []string{
            "http://localhost:4321",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:8000",
        }

        origin := r.Header.Get("Origin")
        allowed := false
        for _, allowedOrigin := range allowedOrigins {
            if origin == allowedOrigin {
                allowed = true
                break
            }
        }

        if allowed {
            w.Header().Set("Access-Control-Allow-Origin", origin)
            log.Printf("[CORS] ✓ Allowed origin: %s", origin)
        } else {
            log.Printf("[CORS] ⚠ Origin not in allowed list: %s", origin)
        }

        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, xc-token")
        w.Header().Set("Access-Control-Allow-Credentials", "true")
        w.Header().Set("Access-Control-Max-Age", "3600")

        // Handle preflight requests
        if r.Method == "OPTIONS" {
            log.Printf("[CORS] Preflight request handled")
            w.WriteHeader(http.StatusOK)
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

### Breaking Down CORSMiddleware()

#### Step 1: Check Origin
```go
origin := r.Header.Get("Origin")
// "http://localhost:4321"
```

**What is Origin:**
The domain/port where the request came from.

#### Step 2: Validate Origin
```go
allowedOrigins := []string{
    "http://localhost:4321",
    "http://localhost:3000",
    // ...
}

for _, allowedOrigin := range allowedOrigins {
    if origin == allowedOrigin {
        allowed = true
        break
    }
}
```

**What it does:**
Checks if the origin is in the whitelist.

#### Step 3: Add CORS Headers
```go
if allowed {
    w.Header().Set("Access-Control-Allow-Origin", origin)
}
w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, xc-token")
w.Header().Set("Access-Control-Allow-Credentials", "true")
```

**Headers explained:**

- **Access-Control-Allow-Origin**: Which origin is allowed
- **Access-Control-Allow-Methods**: Which HTTP methods are allowed
- **Access-Control-Allow-Headers**: Which headers are allowed
- **Access-Control-Allow-Credentials**: Allow cookies/auth headers

#### Step 4: Handle Preflight Requests
```go
if r.Method == "OPTIONS" {
    w.WriteHeader(http.StatusOK)
    return
}
```

**What is a preflight request:**
Before making a real request, browsers send an OPTIONS request to check if CORS is allowed.

**Example flow:**
```
1. Frontend: "I want to POST to /proxy/quotes/records"
2. Browser: "Let me check first..."
   OPTIONS /proxy/quotes/records
3. Proxy: "200 OK, CORS headers say it's allowed"
4. Browser: "Okay, now I'll send the real request"
   POST /proxy/quotes/records
```

#### Step 5: Pass to Next Handler
```go
next.ServeHTTP(w, r)
```

If not a preflight request, continue to the next middleware/handler.

## 2. authorize.go - Authorization Middleware

### AuthorizeMiddleware()
```go
func AuthorizeMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("[AUTHORIZE] Request: %s %s", r.Method, r.URL.Path)

        // Get user info from context (set by AuthMiddleware)
        userID := r.Context().Value("user_id")
        role := r.Context().Value("role")

        if userID == nil {
            log.Printf("[AUTHORIZE ERROR] No user_id in context")
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }

        log.Printf("[AUTHORIZE] ✓ User %s (role: %s) authorized", userID, role)

        // Future: Add role-based access control here
        // if role != "admin" && r.Method == "DELETE" {
        //     http.Error(w, "forbidden", http.StatusForbidden)
        //     return
        // }

        next.ServeHTTP(w, r)
    })
}
```

**What it does:**
- Checks if user info exists in context
- Currently just logs (placeholder for future RBAC)
- Could add role-based permissions

**Future enhancement example:**
```go
// Only admins can delete
if role != "admin" && r.Method == "DELETE" {
    http.Error(w, "forbidden: only admins can delete", http.StatusForbidden)
    return
}

// Only admins can access certain tables
if strings.Contains(r.URL.Path, "/admin_data/") && role != "admin" {
    http.Error(w, "forbidden: admin only", http.StatusForbidden)
    return
}
```

## Middleware Chaining

### How Middleware Stack Together

In `main.go`:
```go
// Apply middleware in order
protectedHandler := middleware.AuthMiddleware(cfg.JWTSecret)(
    middleware.AuthorizeMiddleware(proxyHandler),
)
mux.Handle("/proxy/", protectedHandler)

handler := middleware.CORSMiddleware(mux)
```

**Execution order:**
```
Request
  ↓
CORSMiddleware (outermost)
  ↓
AuthMiddleware
  ↓
AuthorizeMiddleware
  ↓
ProxyHandler (innermost)
  ↓
Response flows back through all layers
```

### Visual Representation

```
┌─────────────────────────────────────┐
│ CORSMiddleware                      │
│ ┌─────────────────────────────────┐ │
│ │ AuthMiddleware                  │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ AuthorizeMiddleware         │ │ │
│ │ │ ┌─────────────────────────┐ │ │ │
│ │ │ │ ProxyHandler            │ │ │ │
│ │ │ │                         │ │ │ │
│ │ │ └─────────────────────────┘ │ │ │
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Request Flow Example

### Request:
```
POST /proxy/quotes/records
Origin: http://localhost:4321
Authorization: Bearer eyJhbGc...
Body: {"fields": {"Subject": "Q-001"}}
```

### Flow Through Middleware:

#### 1. CORSMiddleware
```
[CORS] Handling request: POST /proxy/quotes/records from origin: http://localhost:4321
[CORS] ✓ Allowed origin: http://localhost:4321
Add headers:
  Access-Control-Allow-Origin: http://localhost:4321
  Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, xc-token
Pass to next →
```

#### 2. AuthMiddleware
```
[AUTH] Checking authorization header for POST /proxy/quotes/records
[AUTH] Token found: eyJhbGciOiJIUzI1NiIs...
[AUTH] ✓ Token valid for user: 123 (role: user)
Add to context:
  user_id: "123"
  role: "user"
Pass to next →
```

#### 3. AuthorizeMiddleware
```
[AUTHORIZE] Request: POST /proxy/quotes/records
[AUTHORIZE] ✓ User 123 (role: user) authorized
Pass to next →
```

#### 4. ProxyHandler
```
[PROXY] Incoming request: POST /proxy/quotes/records
[PROXY] Extracted path: quotes/records
[VALIDATOR] ✓ Table 'quotes' found in config
[VALIDATOR] ✓ Operation 'create' is allowed
[META] Resolved table 'quotes' -> 'clkczb2ifl6l25g'
[PROXY] Target URL: http://localhost:8090/api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/records
[PROXY] Request completed successfully
```

### Response:
```
200 OK
Access-Control-Allow-Origin: http://localhost:4321
Content-Type: application/json

{"id": 123, "fields": {"Subject": "Q-001"}}
```

## Middleware Patterns

### Pattern 1: Wrapper Function
```go
func SomeMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Before logic
        log.Println("Before handler")
        
        // Call next handler
        next.ServeHTTP(w, r)
        
        // After logic
        log.Println("After handler")
    })
}
```

### Pattern 2: Middleware with Configuration
```go
func ConfigurableMiddleware(config string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Use config
            log.Printf("Config: %s", config)
            next.ServeHTTP(w, r)
        })
    }
}

// Usage:
handler := ConfigurableMiddleware("some-value")(myHandler)
```

### Pattern 3: Early Return (Block Request)
```go
func ValidationMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !isValid(r) {
            http.Error(w, "invalid request", http.StatusBadRequest)
            return  // Don't call next.ServeHTTP
        }
        next.ServeHTTP(w, r)
    })
}
```

## Common Middleware Use Cases

### 1. Logging
```go
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        log.Printf("Started %s %s", r.Method, r.URL.Path)
        
        next.ServeHTTP(w, r)
        
        log.Printf("Completed in %v", time.Since(start))
    })
}
```

### 2. Rate Limiting
```go
func RateLimitMiddleware(next http.Handler) http.Handler {
    limiter := rate.NewLimiter(10, 20) // 10 req/sec, burst 20
    
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !limiter.Allow() {
            http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

### 3. Request ID
```go
func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestID := uuid.New().String()
        ctx := context.WithValue(r.Context(), "request_id", requestID)
        
        w.Header().Set("X-Request-ID", requestID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

## Key Takeaway

**Middleware provides cross-cutting concerns:**
- CORS: Allows cross-origin requests
- Auth: Validates JWT tokens
- Authorize: Checks permissions (future RBAC)
- Logging: Tracks requests
- Rate limiting: Prevents abuse

They're **composable** - you can stack them in any order to build the exact functionality you need!

---

**Next:** [08-database.md](./08-database.md) - User storage with SQLite.
