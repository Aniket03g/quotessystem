# Database (internal/db/database.go)

The database stores user accounts locally using SQLite.

## What is SQLite?

**SQLite** is a lightweight database that stores data in a single file (`users.db`).

**Benefits:**
- No separate database server needed
- Just a file on disk
- Fast for small-to-medium datasets
- Perfect for user accounts

## Database Structure

### Database
```go
type Database struct {
    db *sql.DB
}
```

**Fields:**
- `db`: Connection to SQLite database

### User
```go
type User struct {
    ID             int
    Email          string
    Name           string
    PasswordHash   string
    Role           string
    OAuthProvider  string
    OAuthID        string
    CreatedAt      time.Time
}
```

**Fields explained:**
- `ID`: Unique user identifier (auto-increment)
- `Email`: User's email address (unique)
- `Name`: User's display name
- `PasswordHash`: Hashed password (bcrypt)
- `Role`: User role ("user" or "admin")
- `OAuthProvider`: OAuth provider ("google", "github", or empty)
- `OAuthID`: OAuth user ID (from provider)
- `CreatedAt`: When account was created

## Constructor

### NewDatabase()
```go
func NewDatabase(dbPath string) (*Database, error) {
    db, err := sql.Open("sqlite3", dbPath)
    if err != nil {
        return nil, fmt.Errorf("failed to open database: %w", err)
    }

    // Create users table if it doesn't exist
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT,
            role TEXT DEFAULT 'user',
            oauth_provider TEXT,
            oauth_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `)
    if err != nil {
        return nil, fmt.Errorf("failed to create users table: %w", err)
    }

    log.Printf("[DB] Database initialized at %s", dbPath)
    return &Database{db: db}, nil
}
```

**What it does:**
1. Opens SQLite database file
2. Creates `users` table if it doesn't exist
3. Returns Database instance

**Table schema:**
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Auto-incrementing ID
    email TEXT UNIQUE NOT NULL,            -- Email (must be unique)
    name TEXT NOT NULL,                    -- Display name
    password_hash TEXT,                    -- Hashed password (nullable for OAuth)
    role TEXT DEFAULT 'user',              -- User role
    oauth_provider TEXT,                   -- OAuth provider (nullable)
    oauth_id TEXT,                         -- OAuth user ID (nullable)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## User Management Functions

### 1. CreateLocalUser() - Create Account with Password
```go
func (d *Database) CreateLocalUser(email, password, name string) (*User, error) {
    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    if err != nil {
        return nil, fmt.Errorf("failed to hash password: %w", err)
    }

    // Insert user
    result, err := d.db.Exec(
        `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
        email, name, string(hashedPassword), "user",
    )
    if err != nil {
        return nil, fmt.Errorf("failed to create user: %w", err)
    }

    // Get inserted ID
    id, err := result.LastInsertId()
    if err != nil {
        return nil, fmt.Errorf("failed to get user ID: %w", err)
    }

    return &User{
        ID:           int(id),
        Email:        email,
        Name:         name,
        PasswordHash: string(hashedPassword),
        Role:         "user",
        CreatedAt:    time.Now(),
    }, nil
}
```

**What it does:**
1. Hashes password with bcrypt
2. Inserts user into database
3. Returns User object

**Example:**
```go
user, err := db.CreateLocalUser("user@example.com", "password123", "John Doe")
// user.ID = 1
// user.Email = "user@example.com"
// user.PasswordHash = "$2a$10$..." (hashed)
```

**bcrypt hashing:**
```go
password := "password123"
hash := "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
// Hash is one-way - can't reverse to get original password
```

### 2. CreateOrUpdateOAuthUser() - OAuth Account
```go
func (d *Database) CreateOrUpdateOAuthUser(email, name, provider, oauthID string) (*User, error) {
    // Check if user exists
    existingUser, err := d.GetUserByEmail(email)
    if err == nil && existingUser != nil {
        // User exists - update OAuth info
        _, err = d.db.Exec(
            `UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?`,
            provider, oauthID, existingUser.ID,
        )
        if err != nil {
            return nil, fmt.Errorf("failed to update OAuth user: %w", err)
        }
        existingUser.OAuthProvider = provider
        existingUser.OAuthID = oauthID
        return existingUser, nil
    }

    // User doesn't exist - create new
    result, err := d.db.Exec(
        `INSERT INTO users (email, name, oauth_provider, oauth_id, role) VALUES (?, ?, ?, ?, ?)`,
        email, name, provider, oauthID, "user",
    )
    if err != nil {
        return nil, fmt.Errorf("failed to create OAuth user: %w", err)
    }

    id, err := result.LastInsertId()
    if err != nil {
        return nil, fmt.Errorf("failed to get user ID: %w", err)
    }

    return &User{
        ID:            int(id),
        Email:         email,
        Name:          name,
        Role:          "user",
        OAuthProvider: provider,
        OAuthID:       oauthID,
        CreatedAt:     time.Now(),
    }, nil
}
```

**What it does:**
1. Checks if user with email already exists
2. If exists: Update OAuth info
3. If not: Create new user with OAuth info

**Example:**
```go
user, err := db.CreateOrUpdateOAuthUser(
    "user@gmail.com",
    "John Doe",
    "google",
    "google-user-id-123"
)
```

**Why update if exists:**
User might have created account with password first, then later logged in with OAuth.

### 3. GetUserByEmail() - Find User by Email
```go
func (d *Database) GetUserByEmail(email string) (*User, error) {
    var user User
    err := d.db.QueryRow(
        `SELECT id, email, name, password_hash, role, oauth_provider, oauth_id, created_at 
         FROM users WHERE email = ?`,
        email,
    ).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role, 
           &user.OAuthProvider, &user.OAuthID, &user.CreatedAt)

    if err == sql.ErrNoRows {
        return nil, nil // User not found
    }
    if err != nil {
        return nil, fmt.Errorf("failed to get user: %w", err)
    }

    return &user, nil
}
```

**What it does:**
Queries database for user with given email.

**Returns:**
- User object if found
- `nil` if not found
- Error if database error

### 4. GetUserByID() - Find User by ID
```go
func (d *Database) GetUserByID(id int) (*User, error) {
    var user User
    err := d.db.QueryRow(
        `SELECT id, email, name, password_hash, role, oauth_provider, oauth_id, created_at 
         FROM users WHERE id = ?`,
        id,
    ).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role, 
           &user.OAuthProvider, &user.OAuthID, &user.CreatedAt)

    if err == sql.ErrNoRows {
        return nil, fmt.Errorf("user not found")
    }
    if err != nil {
        return nil, fmt.Errorf("failed to get user: %w", err)
    }

    return &user, nil
}
```

**What it does:**
Queries database for user with given ID.

**Usage:**
```go
user, err := db.GetUserByID(123)
```

### 5. ValidatePassword() - Check Password
```go
func (d *Database) ValidatePassword(email, password string) (*User, error) {
    user, err := d.GetUserByEmail(email)
    if err != nil {
        return nil, err
    }
    if user == nil {
        return nil, fmt.Errorf("user not found")
    }

    // Check if user has a password (OAuth users might not)
    if user.PasswordHash == "" {
        return nil, fmt.Errorf("user has no password (OAuth account)")
    }

    // Compare password with hash
    err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
    if err != nil {
        return nil, fmt.Errorf("invalid password")
    }

    return user, nil
}
```

**What it does:**
1. Finds user by email
2. Checks if user has a password (OAuth users don't)
3. Compares provided password with stored hash
4. Returns user if password matches

**bcrypt comparison:**
```go
hash := "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
password := "password123"

err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
if err == nil {
    // Password matches!
} else {
    // Password doesn't match
}
```

### 6. Close() - Close Database Connection
```go
func (d *Database) Close() error {
    return d.db.Close()
}
```

**What it does:**
Closes database connection.

**Usage:**
```go
defer database.Close()
```

## SQL Patterns

### Pattern 1: Insert and Get ID
```go
result, err := d.db.Exec(`INSERT INTO users (...) VALUES (?, ?, ?)`, val1, val2, val3)
id, err := result.LastInsertId()
```

**What it does:**
Inserts row and gets the auto-generated ID.

### Pattern 2: Query Single Row
```go
var user User
err := d.db.QueryRow(`SELECT * FROM users WHERE id = ?`, id).Scan(&user.ID, &user.Email, ...)
```

**What it does:**
Queries for one row and scans into variables.

### Pattern 3: Query Multiple Rows
```go
rows, err := d.db.Query(`SELECT * FROM users`)
defer rows.Close()

for rows.Next() {
    var user User
    rows.Scan(&user.ID, &user.Email, ...)
    users = append(users, user)
}
```

**What it does:**
Queries for multiple rows and iterates through them.

### Pattern 4: Update
```go
_, err := d.db.Exec(`UPDATE users SET name = ? WHERE id = ?`, newName, id)
```

**What it does:**
Updates existing row.

### Pattern 5: Delete
```go
_, err := d.db.Exec(`DELETE FROM users WHERE id = ?`, id)
```

**What it does:**
Deletes row.

## Security Features

### 1. Password Hashing with bcrypt
```go
hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
```

**Why bcrypt:**
- Slow by design (prevents brute force)
- Includes salt (prevents rainbow table attacks)
- One-way (can't reverse to get original password)

**Cost factor:**
```go
bcrypt.DefaultCost = 10
// Higher cost = slower but more secure
// 10 is a good balance
```

### 2. SQL Injection Prevention
```go
// ✓ Safe (parameterized query)
d.db.Exec(`SELECT * FROM users WHERE email = ?`, email)

// ✗ Unsafe (string concatenation)
d.db.Exec(`SELECT * FROM users WHERE email = '` + email + `'`)
```

**Parameterized queries** prevent SQL injection attacks.

### 3. Unique Email Constraint
```sql
email TEXT UNIQUE NOT NULL
```

**What it does:**
Database enforces that no two users can have the same email.

## Database File

### Location
```
./users.db
```

### Contents
```
users table:
┌────┬─────────────────────┬──────────┬──────────────┬──────┬────────────────┬──────────┬─────────────────────┐
│ id │ email               │ name     │ password_hash│ role │ oauth_provider │ oauth_id │ created_at          │
├────┼─────────────────────┼──────────┼──────────────┼──────┼────────────────┼──────────┼─────────────────────┤
│ 1  │ user@example.com    │ John Doe │ $2a$10$...  │ user │                │          │ 2024-12-23 08:00:00 │
│ 2  │ admin@example.com   │ Admin    │ $2a$10$...  │ admin│                │          │ 2024-12-23 08:05:00 │
│ 3  │ oauth@gmail.com     │ Jane     │              │ user │ google         │ g123     │ 2024-12-23 08:10:00 │
└────┴─────────────────────┴──────────┴──────────────┴──────┴────────────────┴──────────┴─────────────────────┘
```

### Viewing the Database
```bash
# Install SQLite CLI
# Then:
sqlite3 users.db

# View all users
SELECT * FROM users;

# Count users
SELECT COUNT(*) FROM users;

# Find user by email
SELECT * FROM users WHERE email = 'user@example.com';
```

## Usage Examples

### Example 1: User Signup
```go
user, err := database.CreateLocalUser("newuser@example.com", "securepass123", "New User")
if err != nil {
    log.Printf("Signup failed: %v", err)
    return
}
log.Printf("User created with ID: %d", user.ID)
```

### Example 2: User Login
```go
user, err := database.ValidatePassword("user@example.com", "password123")
if err != nil {
    log.Printf("Login failed: %v", err)
    return
}
log.Printf("Login successful: %s", user.Email)
```

### Example 3: OAuth Login
```go
user, err := database.CreateOrUpdateOAuthUser(
    "oauth@gmail.com",
    "OAuth User",
    "google",
    "google-id-123"
)
if err != nil {
    log.Printf("OAuth failed: %v", err)
    return
}
log.Printf("OAuth user: %s", user.Email)
```

## Key Takeaway

**The database provides:**
- Local user account storage
- Password hashing with bcrypt
- OAuth user support
- SQL injection protection
- Simple SQLite file-based storage

It's a lightweight solution perfect for user authentication without needing a separate database server!

---

**Next:** [09-putting-it-together.md](./09-putting-it-together.md) - How all components work together.
