# Admin-Only User Creation Implementation

## Overview
This implementation adds admin-only user creation with temporary passwords and forced password change on first login. No email sending or magic links - users receive temporary passwords directly from the admin interface.

## Database Changes

### Migration
The `must_change_password` column is automatically added via the existing migration system in `internal/db/sqlite.go`:

```sql
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT 0
```

This migration runs automatically on server startup if the column doesn't exist.

### User Table Schema
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    password_hash TEXT,
    role TEXT DEFAULT 'user',
    must_change_password BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### 1. Create User (Admin Only)
**Endpoint:** `POST /api/admin/users`

**Authentication:** Requires valid JWT with `role: "admin"`

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "role": "user"
}
```

**Fields:**
- `email` (required): User's email address (must be unique)
- `name` (optional): User's display name
- `role` (required): Either "user" or "admin" (defaults to "user" if not specified)

**Success Response (201 Created):**
```json
{
  "message": "User created successfully",
  "email": "user@example.com",
  "user_id": 123,
  "role": "user",
  "temporary_password": "Xy9$mK2@pL5#nQ8!"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid request body or validation failure
- `403 Forbidden`: Non-admin user attempted to create user
- `409 Conflict`: User with email already exists

**Security Notes:**
- Temporary password is only shown once in this response
- Password is 16+ characters with mixed case, digits, and symbols
- Generated using `crypto/rand` for cryptographic security
- Admin should securely communicate this password to the user

### 2. Change Password
**Endpoint:** `POST /api/auth/change-password`

**Authentication:** Requires valid JWT

**Request Body:**
```json
{
  "old_password": "Xy9$mK2@pL5#nQ8!",
  "new_password": "MyNewSecurePassword123!"
}
```

**Success Response (200 OK):**
```json
{
  "message": "Password changed successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response includes:**
- Success message
- New JWT token (without `must_change_password` flag)

**Error Responses:**
- `400 Bad Request`: Missing fields or password too short (< 6 chars)
- `401 Unauthorized`: Old password is incorrect

**Security Notes:**
- Old password is verified using bcrypt timing-safe comparison
- New password is hashed with bcrypt (DefaultCost = 10)
- `must_change_password` flag is automatically cleared
- New JWT token is issued to replace the old one

### 3. Login (Modified)
**Endpoint:** `POST /login`

**Behavior Change:**
When a user with `must_change_password=true` logs in, the JWT token includes:

```json
{
  "user_id": "123",
  "role": "user",
  "must_change_password": true,
  "exp": 1234567890,
  "iat": 1234567890
}
```

The frontend should check this claim and force the user to the password change screen.

## Code Structure

### New Files Created

#### `internal/db/admin.go`
Contains admin-specific database operations:
- `CreateUserByAdmin()`: Creates user with temporary password
- `UpdatePassword()`: Updates password and clears must_change_password flag
- `GenerateSecurePassword()`: Cryptographically secure password generator

#### `internal/handlers/admin.go`
Admin-only HTTP handlers:
- `CreateUser()`: Handles POST /api/admin/users

#### `internal/handlers/auth.go`
Authentication-related HTTP handlers:
- `ChangePassword()`: Handles POST /api/auth/change-password

### Modified Files

#### `internal/db/sqlite.go`
- Added `MustChangePassword bool` field to `User` struct
- Updated all query methods to include `must_change_password` column
- Added migration for new column

#### `internal/utils/jwt.go`
- Added `MustChangePassword bool` field to `Claims` struct
- Added `GenerateJWTWithPasswordFlag()` function

#### `main.go`
- Updated `loginHandler()` to check and include `must_change_password` in JWT
- Registered new routes for admin user creation and password change

## Security Features

### Password Generation
- **Length:** 16 characters minimum
- **Character sets:** Lowercase, uppercase, digits, symbols
- **Randomness:** Uses `crypto/rand` (cryptographically secure)
- **Guaranteed complexity:** At least one char from each set
- **Shuffled:** Characters are randomly shuffled to avoid patterns

### Password Storage
- **Algorithm:** bcrypt with DefaultCost (10 rounds)
- **Timing-safe comparison:** bcrypt.CompareHashAndPassword is constant-time
- **No plaintext storage:** Passwords never stored in plaintext

### Access Control
- **Admin check:** Role verification happens in handler before any operation
- **Context-based:** User role extracted from JWT claims in request context
- **Fail-secure:** Returns 403 Forbidden if role check fails

### Token Security
- **Fresh tokens:** New JWT issued after password change
- **Flag cleared:** `must_change_password` removed from new token
- **24-hour expiry:** Tokens expire after 24 hours

## Frontend Integration (Astro)

### 1. Check JWT Claims After Login
```typescript
// After successful login, decode JWT to check claims
import { jwtDecode } from 'jwt-decode';

interface JWTClaims {
  user_id: string;
  role: string;
  must_change_password?: boolean;
  exp: number;
  iat: number;
}

const token = loginResponse.token;
const claims = jwtDecode<JWTClaims>(token);

if (claims.must_change_password) {
  // Redirect to password change page
  window.location.href = '/change-password';
} else {
  // Normal login flow - redirect to dashboard
  window.location.href = '/dashboard';
}
```

### 2. Password Change Page
```typescript
// /change-password page
async function changePassword(oldPassword: string, newPassword: string) {
  const token = localStorage.getItem('auth_token');
  
  const response = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword
    })
  });

  if (response.ok) {
    const data = await response.json();
    // Store new token
    localStorage.setItem('auth_token', data.token);
    // Redirect to dashboard
    window.location.href = '/dashboard';
  } else {
    // Handle error
    const error = await response.json();
    alert(error.error);
  }
}
```

### 3. Admin User Creation Page
```typescript
// /admin/users/create page (admin only)
async function createUser(email: string, name: string, role: string) {
  const token = localStorage.getItem('auth_token');
  
  const response = await fetch('/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ email, name, role })
  });

  if (response.ok) {
    const data = await response.json();
    // Display temporary password to admin (ONLY SHOWN ONCE)
    alert(`User created! Temporary password: ${data.temporary_password}\n\nPlease save this password and communicate it securely to the user.`);
    // Or show in a modal with copy button
  } else {
    const error = await response.json();
    alert(error.error);
  }
}
```

### 4. Route Protection
```typescript
// Middleware to check must_change_password flag
export function checkPasswordChangeRequired() {
  const token = localStorage.getItem('auth_token');
  if (!token) return;

  const claims = jwtDecode<JWTClaims>(token);
  
  // If on any page except /change-password and must change password
  if (claims.must_change_password && window.location.pathname !== '/change-password') {
    window.location.href = '/change-password';
  }
}

// Call this on page load or in a layout component
checkPasswordChangeRequired();
```

## Testing

### 1. Create Admin User (Manual)
First, you need at least one admin user. You can:
- Use the existing hardcoded admin check in OAuth callback
- Manually update the database:
  ```sql
  UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
  ```

### 2. Test Admin User Creation
```bash
# Login as admin
curl -X POST http://localhost:8080/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Save the token from response
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Create new user
curl -X POST http://localhost:8080/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"email":"newuser@example.com","name":"New User","role":"user"}'

# Response will include temporary password
```

### 3. Test Password Change Flow
```bash
# Login with temporary password
curl -X POST http://localhost:8080/login \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"TEMP_PASSWORD_FROM_ABOVE"}'

# JWT will include "must_change_password": true

# Change password
curl -X POST http://localhost:8080/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"old_password":"TEMP_PASSWORD","new_password":"MyNewPassword123!"}'

# New token will NOT have must_change_password flag
```

## Rollback Instructions

If you need to rollback this feature:

1. **Remove routes from main.go:**
   - Delete `/api/admin/users` route registration
   - Delete `/api/auth/change-password` route registration
   - Remove handler imports

2. **Revert login handler:**
   - Change `GenerateJWTWithPasswordFlag` back to `GenerateJWT`
   - Remove `must_change_password` check

3. **Database:**
   - The `must_change_password` column can remain (won't cause issues)
   - Or manually drop it: `ALTER TABLE users DROP COLUMN must_change_password;`

4. **Delete new files:**
   - `internal/db/admin.go`
   - `internal/handlers/admin.go`
   - `internal/handlers/auth.go`

## Future Enhancements

Potential improvements (not implemented yet):
- Email sending for temporary passwords
- Password complexity requirements (uppercase, numbers, symbols)
- Password expiry (force change after N days)
- Account lockout after failed attempts
- Password history (prevent reuse)
- Audit logging for admin actions
- Bulk user import
- User deactivation/suspension
