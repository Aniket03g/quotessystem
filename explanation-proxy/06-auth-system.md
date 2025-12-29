# Authentication System (internal/auth/)

The authentication system handles user login, signup, and OAuth integration.

## Files Overview

| File | Purpose |
|------|---------|
| `handler.go` | Login, signup, OAuth handlers |
| `middleware.go` | JWT token validation middleware |

## 1. handler.go - Authentication Handlers

### Handler Structure
```go
type Handler struct {
    db             *db.Database
    jwtSecret      string
    frontendURL    string
}
```

**Fields:**
- `db`: User database for storing accounts
- `jwtSecret`: Secret key for signing JWT tokens
- `frontendURL`: Where to redirect after OAuth (e.g., "http://localhost:4321")

### Constructor
```go
func NewHandler(database *db.Database, jwtSecret, frontendURL string) *Handler {
    return &Handler{
        db:          database,
        jwtSecret:   jwtSecret,
        frontendURL: frontendURL,
    }
}
```

### OAuth Flow Functions

#### BeginAuth() - Start OAuth
```go
func (h *Handler) BeginAuth(w http.ResponseWriter, r *http.Request) {
    provider := strings.TrimPrefix(r.URL.Path, "/auth/")
    provider = strings.Split(provider, "/")[0]
    
    r = r.WithContext(context.WithValue(r.Context(), "provider", provider))
    
    gothic.BeginAuthHandler(w, r)
}
```

**What it does:**
1. Extracts provider name from URL (google, github)
2. Redirects user to OAuth provider's login page

**Example flow:**
```
User clicks "Login with Google"
  ↓
GET /auth/google
  ↓
BeginAuth() redirects to Google login
  ↓
User logs in at Google
  ↓
Google redirects back to /auth/google/callback
```

#### CallbackAuth() - Handle OAuth Callback
```go
func (h *Handler) CallbackAuth(w http.ResponseWriter, r *http.Request) {
    provider := strings.TrimPrefix(r.URL.Path, "/auth/")
    provider = strings.Split(provider, "/")[0]
    
    r = r.WithContext(context.WithValue(r.Context(), "provider", provider))
    
    user, err := gothic.CompleteUserAuth(w, r)
    if err != nil {
        log.Printf("[AUTH ERROR] OAuth failed: %v", err)
        http.Redirect(w, r, h.frontendURL+"/login?error=oauth_failed", http.StatusTemporaryRedirect)
        return
    }

    // Create or update user in database
    dbUser, err := h.db.CreateOrUpdateOAuthUser(user.Email, user.Name, provider, user.UserID)
    if err != nil {
        log.Printf("[AUTH ERROR] Failed to create/update OAuth user: %v", err)
        http.Redirect(w, r, h.frontendURL+"/login?error=db_error", http.StatusTemporaryRedirect)
        return
    }

    // Generate JWT token
    token, err := utils.GenerateJWT(fmt.Sprintf("%d", dbUser.ID), dbUser.Role, h.jwtSecret)
    if err != nil {
        log.Printf("[AUTH ERROR] Failed to generate JWT: %v", err)
        http.Redirect(w, r, h.frontendURL+"/login?error=token_error", http.StatusTemporaryRedirect)
        return
    }

    // Redirect to frontend with token
    redirectURL := fmt.Sprintf("%s/auth/callback?token=%s", h.frontendURL, token)
    http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}
```

**What it does:**
1. Receives OAuth callback from Google/GitHub
2. Gets user info (email, name)
3. Creates or updates user in database
4. Generates JWT token
5. Redirects to frontend with token

**Example flow:**
```
Google redirects: /auth/google/callback?code=xyz123
  ↓
CallbackAuth() exchanges code for user info
  ↓
User info: {email: "user@gmail.com", name: "John Doe"}
  ↓
Create/update user in database
  ↓
Generate JWT token
  ↓
Redirect: http://localhost:4321/auth/callback?token=eyJhbGc...
  ↓
Frontend stores token and redirects to dashboard
```

#### GetCurrentUser() - Get User Info
```go
func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
    userID := r.Context().Value("user_id").(string)
    
    id, err := strconv.Atoi(userID)
    if err != nil {
        http.Error(w, "invalid user id", http.StatusBadRequest)
        return
    }

    user, err := h.db.GetUserByID(id)
    if err != nil {
        http.Error(w, "user not found", http.StatusNotFound)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "id":    user.ID,
        "email": user.Email,
        "name":  user.Name,
        "role":  user.Role,
    })
}
```

**What it does:**
Returns current user's information based on JWT token.

**Usage:**
```javascript
// Frontend
const response = await fetch('/auth/me', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
const user = await response.json();
// { id: 1, email: "user@example.com", name: "John", role: "user" }
```

#### Logout() - Clear Session
```go
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
    gothic.Logout(w, r)
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"message": "logged out"})
}
```

**What it does:**
Clears OAuth session data.

**Note:** JWT tokens are stateless, so logout is client-side (delete token from localStorage).

## 2. middleware.go - JWT Validation

### AuthMiddleware() - Validate JWT Token
```go
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            log.Printf("[AUTH] Checking authorization header for %s %s", r.Method, r.URL.Path)

            // Extract token from Authorization header
            authHeader := r.Header.Get("Authorization")
            if authHeader == "" {
                log.Printf("[AUTH ERROR] Missing authorization header")
                http.Error(w, "unauthorized: missing token", http.StatusUnauthorized)
                return
            }

            // Check Bearer prefix
            parts := strings.Split(authHeader, " ")
            if len(parts) != 2 || parts[0] != "Bearer" {
                log.Printf("[AUTH ERROR] Invalid authorization header format")
                http.Error(w, "unauthorized: invalid token format", http.StatusUnauthorized)
                return
            }

            tokenString := parts[1]
            log.Printf("[AUTH] Token found: %s...", tokenString[:min(20, len(tokenString))])

            // Parse and validate token
            token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
                if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                    return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
                }
                return []byte(jwtSecret), nil
            })

            if err != nil {
                log.Printf("[AUTH ERROR] Token validation failed: %v", err)
                http.Error(w, "unauthorized: invalid token", http.StatusUnauthorized)
                return
            }

            if !token.Valid {
                log.Printf("[AUTH ERROR] Token is not valid")
                http.Error(w, "unauthorized: token expired or invalid", http.StatusUnauthorized)
                return
            }

            // Extract claims
            claims, ok := token.Claims.(jwt.MapClaims)
            if !ok {
                log.Printf("[AUTH ERROR] Failed to extract claims")
                http.Error(w, "unauthorized: invalid token claims", http.StatusUnauthorized)
                return
            }

            userID, ok := claims["user_id"].(string)
            if !ok {
                log.Printf("[AUTH ERROR] Missing user_id in claims")
                http.Error(w, "unauthorized: invalid token claims", http.StatusUnauthorized)
                return
            }

            role, ok := claims["role"].(string)
            if !ok {
                role = "user"
            }

            log.Printf("[AUTH] ✓ Token valid for user: %s (role: %s)", userID, role)

            // Add user info to request context
            ctx := context.WithValue(r.Context(), "user_id", userID)
            ctx = context.WithValue(ctx, "role", role)

            // Call next handler
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

### Breaking Down AuthMiddleware()

#### Step 1: Extract Token
```go
authHeader := r.Header.Get("Authorization")
// "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

parts := strings.Split(authHeader, " ")
tokenString := parts[1]
// "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### Step 2: Parse Token
```go
token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
    return []byte(jwtSecret), nil
})
```

**What it does:**
- Decodes the JWT
- Verifies signature using secret key
- Checks expiration

#### Step 3: Validate Token
```go
if !token.Valid {
    http.Error(w, "unauthorized: token expired or invalid", http.StatusUnauthorized)
    return
}
```

**Validation checks:**
- Signature matches (not tampered)
- Not expired
- Proper format

#### Step 4: Extract Claims
```go
claims, ok := token.Claims.(jwt.MapClaims)
userID := claims["user_id"].(string)
role := claims["role"].(string)
```

**Claims are the data inside the token:**
```json
{
  "user_id": "123",
  "role": "user",
  "exp": 1703347200
}
```

#### Step 5: Add to Context
```go
ctx := context.WithValue(r.Context(), "user_id", userID)
ctx = context.WithValue(ctx, "role", role)
next.ServeHTTP(w, r.WithContext(ctx))
```

**What it does:**
Passes user info to the next handler without re-parsing token.

**Usage in handlers:**
```go
func someHandler(w http.ResponseWriter, r *http.Request) {
    userID := r.Context().Value("user_id").(string)
    role := r.Context().Value("role").(string)
    // Use userID and role
}
```

## JWT Token Structure

### Token Creation (utils/jwt.go)
```go
func GenerateJWT(userID, role, secret string) (string, error) {
    claims := jwt.MapClaims{
        "user_id": userID,
        "role":    role,
        "exp":     time.Now().Add(24 * time.Hour).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(secret))
}
```

**What it creates:**
```
Header:
{
  "alg": "HS256",
  "typ": "JWT"
}

Payload:
{
  "user_id": "123",
  "role": "user",
  "exp": 1703347200
}

Signature:
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  secret
)
```

**Result:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMTIzIiwicm9sZSI6InVzZXIiLCJleHAiOjE3MDMzNDcyMDB9.signature_here
```

## Authentication Flow Examples

### Example 1: Local Login
```
1. User submits email/password
   POST /login
   Body: {"email": "user@example.com", "password": "pass123"}

2. Proxy validates credentials
   - Check database
   - Verify password (bcrypt)

3. Generate JWT token
   token = GenerateJWT(userID, role, secret)

4. Return token
   Response: {"token": "eyJhbGc...", "user_id": "123", "role": "user"}

5. Frontend stores token
   localStorage.setItem('token', token)

6. Frontend makes authenticated request
   GET /proxy/quotes/records
   Authorization: Bearer eyJhbGc...

7. AuthMiddleware validates token
   - Parse token
   - Verify signature
   - Check expiration
   - Extract user_id and role

8. Request proceeds to ProxyHandler
```

### Example 2: OAuth Login (Google)
```
1. User clicks "Login with Google"
   GET /auth/google

2. BeginAuth() redirects to Google
   https://accounts.google.com/o/oauth2/auth?...

3. User logs in at Google

4. Google redirects back
   GET /auth/google/callback?code=xyz123

5. CallbackAuth() exchanges code for user info
   - Get email, name from Google
   - Create/update user in database
   - Generate JWT token

6. Redirect to frontend with token
   http://localhost:4321/auth/callback?token=eyJhbGc...

7. Frontend extracts and stores token
   const params = new URLSearchParams(window.location.search)
   const token = params.get('token')
   localStorage.setItem('token', token)

8. Frontend makes authenticated request
   (same as local login from step 6 onwards)
```

## Security Features

### 1. Password Hashing
Passwords are hashed with bcrypt (in database.go):
```go
hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
```

**Never stored in plain text!**

### 2. JWT Expiration
Tokens expire after 24 hours:
```go
"exp": time.Now().Add(24 * time.Hour).Unix()
```

**Users must re-login after expiration.**

### 3. Signature Verification
Tokens are signed with secret key:
```go
token.SignedString([]byte(secret))
```

**Tampering invalidates the signature.**

### 4. HTTPS Recommended
In production, use HTTPS to encrypt tokens in transit.

## Error Handling

### Missing Token
```
Request: GET /proxy/quotes/records
(no Authorization header)

Response: 401 Unauthorized
"unauthorized: missing token"
```

### Invalid Token Format
```
Request: GET /proxy/quotes/records
Authorization: eyJhbGc... (missing "Bearer")

Response: 401 Unauthorized
"unauthorized: invalid token format"
```

### Expired Token
```
Request: GET /proxy/quotes/records
Authorization: Bearer eyJhbGc... (expired)

Response: 401 Unauthorized
"unauthorized: token expired or invalid"
```

### Invalid Signature
```
Request: GET /proxy/quotes/records
Authorization: Bearer eyJhbGc... (tampered)

Response: 401 Unauthorized
"unauthorized: invalid token"
```

## Key Takeaway

**The authentication system provides:**
- Local login (email/password)
- OAuth login (Google, GitHub)
- JWT token generation
- Token validation middleware
- User context for handlers

It ensures only authenticated users can access protected endpoints!

---

**Next:** [07-middleware.md](./07-middleware.md) - CORS and other middleware.
