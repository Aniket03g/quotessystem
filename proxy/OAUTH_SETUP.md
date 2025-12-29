# OAuth Authentication Setup Guide

This guide explains how to set up and use OAuth authentication with the Generic Proxy server.

## Overview

The Generic Proxy now supports OAuth authentication using:
- **Google OAuth 2.0**
- **GitHub OAuth**
- **JWT-based session management**
- **SQLite database for user storage**

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Frontend  │─────▶│  Go Proxy    │─────▶│   NocoDB    │
│   (Astro)   │      │  + OAuth     │      │             │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   SQLite     │
                     │  (users.db)  │
                     └──────────────┘
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
go mod tidy
```

This will download:
- `github.com/markbates/goth` - OAuth provider library
- `github.com/mattn/go-sqlite3` - SQLite driver
- `github.com/gorilla/sessions` - Session management
- `github.com/golang-jwt/jwt/v5` - JWT tokens

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure OAuth consent screen
6. Add authorized redirect URI: `http://localhost:8080/auth/google/callback`
7. Copy **Client ID** and **Client Secret**

### 3. Configure GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - Application name: `Generic Proxy`
   - Homepage URL: `http://localhost:8080`
   - Authorization callback URL: `http://localhost:8080/auth/github/callback`
4. Copy **Client ID** and **Client Secret**

### 4. Update Environment Variables

Copy `.env.example` to `.env` and fill in your OAuth credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server
PORT=8080

# NocoDB
NOCODB_URL=http://localhost:8090/api/v3/data/project/
NOCODB_BASE_ID=your_base_id_here
NOCODB_TOKEN=your_nocodb_token_here

# JWT
JWT_SECRET=your_strong_jwt_secret_here

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:8080/auth/github/callback

# Database
DATABASE_PATH=./users.db

# Session
SESSION_SECRET=your_session_secret_key
```

### 5. Run the Server

```bash
go run .
```

You should see:

```
[STARTUP] Initializing Generic Proxy Server with OAuth...
[DB] Database initialized successfully
[OAUTH] Initializing Google OAuth provider
[OAUTH] Initializing GitHub OAuth provider
[OAUTH] 2 OAuth provider(s) initialized

[STARTUP] OAuth Providers:
  ✓ Google OAuth enabled
    Callback: http://localhost:8080/auth/google/callback
  ✓ GitHub OAuth enabled
    Callback: http://localhost:8080/auth/github/callback

[STARTUP] Server ready!
```

## API Endpoints

### Public Endpoints

#### Legacy Login (Email/Password)
```http
POST /login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "admin123"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "admin-001",
  "role": "admin"
}
```

#### OAuth Login - Google
```http
GET /auth/google
```
Redirects to Google OAuth consent screen.

#### OAuth Login - GitHub
```http
GET /auth/github
```
Redirects to GitHub OAuth authorization page.

#### OAuth Callback (handled automatically)
```http
GET /auth/google/callback?code=...
GET /auth/github/callback?code=...
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "123",
  "email": "user@example.com",
  "provider": "google",
  "role": "user"
}
```

#### Logout
```http
POST /auth/logout
```

### Protected Endpoints

All protected endpoints require JWT token in Authorization header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Get Current User
```http
GET /auth/me
Authorization: Bearer <token>
```

Response:
```json
{
  "user_id": "123",
  "email": "user@example.com",
  "provider": "google",
  "role": "user"
}
```

#### Secure Ping (Example Protected Endpoint)
```http
GET /api/secure/ping
Authorization: Bearer <token>
```

Response:
```json
{
  "message": "Secure endpoint accessed successfully",
  "user_id": 123,
  "email": "user@example.com",
  "provider": "google",
  "name": "John Doe",
  "avatar_url": "https://...",
  "created_at": "2025-12-13T10:30:00Z",
  "jwt_claims": {
    "user_id": "123",
    "email": "user@example.com",
    "provider": "google",
    "role": "user"
  }
}
```

#### Existing Protected Endpoints
All existing endpoints continue to work:
- `POST /api/quotes` - Create quote
- `GET /proxy/accounts/records` - Get accounts
- `GET /proxy/products/records` - Get products
- `GET /proxy/quotes/records` - Get quotes
- etc.

## Frontend Integration

### Example: Login with Google

```typescript
// Redirect to OAuth provider
window.location.href = 'http://localhost:8080/auth/google';

// After callback, the backend returns JWT token
// Store it in localStorage
localStorage.setItem('jwt_token', response.token);

// Use token in API requests
fetch('http://localhost:8080/api/secure/ping', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
  }
});
```

### Example: Login Flow

```typescript
// 1. User clicks "Login with Google"
const handleGoogleLogin = () => {
  window.location.href = 'http://localhost:8080/auth/google';
};

// 2. After OAuth callback, extract token from URL or response
// (You may need to adjust based on your frontend routing)

// 3. Store token
const storeToken = (token: string) => {
  localStorage.setItem('jwt_token', token);
};

// 4. Make authenticated requests
const fetchUserData = async () => {
  const token = localStorage.getItem('jwt_token');
  const response = await fetch('http://localhost:8080/auth/me', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

## Database Schema

The SQLite database (`users.db`) stores user information:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Notes

1. **HTTPS in Production**: Set `store.Options.Secure = true` in production
2. **Strong Secrets**: Use strong, random values for `JWT_SECRET` and `SESSION_SECRET`
3. **CORS Configuration**: Update CORS settings in `middleware/cors.go` for production
4. **Token Expiration**: JWT tokens expire after 24 hours (configurable in `auth/jwt.go`)
5. **Database Backups**: Regularly backup `users.db` in production

## Troubleshooting

### OAuth Provider Not Working

Check that:
1. Client ID and Secret are correct
2. Callback URL matches exactly (including protocol and port)
3. OAuth app is not in development mode (for Google)
4. Authorized domains are configured (for Google)

### Database Errors

```bash
# Check if database file exists
ls -la users.db

# View database contents
sqlite3 users.db "SELECT * FROM users;"
```

### JWT Token Issues

```bash
# Check token expiration
# Tokens expire after 24 hours by default
# User needs to re-authenticate
```

## Development vs Production

### Development
- Use `http://localhost:8080` for callback URLs
- `Secure` cookie option set to `false`
- Detailed logging enabled

### Production
- Use `https://yourdomain.com` for callback URLs
- Set `Secure` cookie option to `true`
- Update OAuth app settings with production URLs
- Use environment-specific `.env` files
- Enable rate limiting and additional security measures

## File Structure

```
backend/
├── auth/
│   ├── handlers.go      # OAuth handlers
│   ├── jwt.go          # JWT generation/validation
│   └── middleware.go   # Auth middleware
├── config/
│   └── config.go       # Configuration management
├── db/
│   └── sqlite.go       # SQLite database operations
├── main.go             # Main application
├── main_helpers.go     # Helper functions
└── .env                # Environment variables
```

## Next Steps

1. ✅ OAuth authentication is now integrated
2. ✅ User data is stored in SQLite
3. ✅ JWT tokens are issued after successful OAuth
4. ⏭️ Optionally sync users to NocoDB
5. ⏭️ Add role-based access control (RBAC)
6. ⏭️ Implement refresh tokens
7. ⏭️ Add email verification

## Support

For issues or questions, check the main README.md or create an issue in the repository.
