package db

import (
	"database/sql"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           int64
	Email        string
	Provider     string
	Name         string
	AvatarURL    string
	PasswordHash string
	Role         string
	CreatedAt    time.Time
}

type Database struct {
	db *sql.DB
}

func NewDatabase(dbPath string) (*Database, error) {
	log.Printf("[DB] Opening SQLite database at: %s", dbPath)

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, err
	}

	database := &Database{db: db}

	// Initialize schema
	if err := database.initSchema(); err != nil {
		return nil, err
	}

	log.Println("[DB] Database initialized successfully")
	return database, nil
}

func (d *Database) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		provider TEXT NOT NULL,
		name TEXT,
		avatar_url TEXT,
		password_hash TEXT,
		role TEXT DEFAULT 'user',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
	CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider);
	`

	_, err := d.db.Exec(schema)
	if err != nil {
		log.Printf("[DB ERROR] Failed to initialize schema: %v", err)
		return err
	}

	log.Println("[DB] Schema initialized")

	// Run migrations to add missing columns to existing tables
	if err := d.runMigrations(); err != nil {
		log.Printf("[DB ERROR] Failed to run migrations: %v", err)
		return err
	}

	return nil
}

func (d *Database) runMigrations() error {
	log.Println("[DB] Running migrations...")

	// Check if password_hash column exists
	var columnExists int
	err := d.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='password_hash'
	`).Scan(&columnExists)

	if err != nil {
		log.Printf("[DB ERROR] Failed to check for password_hash column: %v", err)
		return err
	}

	if columnExists == 0 {
		log.Println("[DB] Adding password_hash column to users table...")
		_, err = d.db.Exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`)
		if err != nil {
			log.Printf("[DB ERROR] Failed to add password_hash column: %v", err)
			return err
		}
		log.Println("[DB] password_hash column added successfully")
	}

	// Check if role column exists
	err = d.db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='role'
	`).Scan(&columnExists)

	if err != nil {
		log.Printf("[DB ERROR] Failed to check for role column: %v", err)
		return err
	}

	if columnExists == 0 {
		log.Println("[DB] Adding role column to users table...")
		_, err = d.db.Exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`)
		if err != nil {
			log.Printf("[DB ERROR] Failed to add role column: %v", err)
			return err
		}
		log.Println("[DB] role column added successfully")

		// Update existing users to have 'user' role
		_, err = d.db.Exec(`UPDATE users SET role = 'user' WHERE role IS NULL`)
		if err != nil {
			log.Printf("[DB ERROR] Failed to update existing users with default role: %v", err)
			return err
		}
		log.Println("[DB] Updated existing users with default role")
	}

	log.Println("[DB] Migrations completed successfully")
	return nil
}

func (d *Database) Close() error {
	log.Println("[DB] Closing database connection")
	return d.db.Close()
}

// CreateUser creates a new user or returns existing user if email already exists
func (d *Database) CreateUser(email, provider, name, avatarURL string) (*User, error) {
	log.Printf("[DB] Creating/fetching user: email=%s, provider=%s", email, provider)

	// Check if user already exists
	existingUser, err := d.GetUserByEmail(email)
	if err == nil && existingUser != nil {
		log.Printf("[DB] User already exists with ID: %d", existingUser.ID)
		return existingUser, nil
	}

	// Insert new user
	result, err := d.db.Exec(
		"INSERT INTO users (email, provider, name, avatar_url) VALUES (?, ?, ?, ?)",
		email, provider, name, avatarURL,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to insert user: %v", err)
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	log.Printf("[DB] User created successfully with ID: %d", id)
	return d.GetUserByID(id)
}

// GetUserByID retrieves a user by their ID
func (d *Database) GetUserByID(id int64) (*User, error) {
	user := &User{}
	var name, avatarURL, passwordHash, role sql.NullString

	err := d.db.QueryRow(
		"SELECT id, email, provider, name, avatar_url, password_hash, role, created_at FROM users WHERE id = ?",
		id,
	).Scan(&user.ID, &user.Email, &user.Provider, &name, &avatarURL, &passwordHash, &role, &user.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		log.Printf("[DB ERROR] Failed to get user by ID: %v", err)
		return nil, err
	}

	// Handle NULL values
	user.Name = name.String
	user.AvatarURL = avatarURL.String
	user.PasswordHash = passwordHash.String
	user.Role = role.String
	if user.Role == "" {
		user.Role = "user"
	}

	return user, nil
}

// GetUserByEmail retrieves a user by their email
func (d *Database) GetUserByEmail(email string) (*User, error) {
	user := &User{}
	var name, avatarURL, passwordHash, role sql.NullString

	err := d.db.QueryRow(
		"SELECT id, email, provider, name, avatar_url, password_hash, role, created_at FROM users WHERE email = ?",
		email,
	).Scan(&user.ID, &user.Email, &user.Provider, &name, &avatarURL, &passwordHash, &role, &user.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		log.Printf("[DB ERROR] Failed to get user by email: %v", err)
		return nil, err
	}

	// Handle NULL values
	user.Name = name.String
	user.AvatarURL = avatarURL.String
	user.PasswordHash = passwordHash.String
	user.Role = role.String
	if user.Role == "" {
		user.Role = "user"
	}

	return user, nil
}

// GetAllUsers retrieves all users
func (d *Database) GetAllUsers() ([]*User, error) {
	rows, err := d.db.Query(
		"SELECT id, email, provider, name, avatar_url, password_hash, role, created_at FROM users ORDER BY created_at DESC",
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to get all users: %v", err)
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		user := &User{}
		var name, avatarURL, passwordHash, role sql.NullString

		if err := rows.Scan(&user.ID, &user.Email, &user.Provider, &name, &avatarURL, &passwordHash, &role, &user.CreatedAt); err != nil {
			return nil, err
		}

		// Handle NULL values
		user.Name = name.String
		user.AvatarURL = avatarURL.String
		user.PasswordHash = passwordHash.String
		user.Role = role.String
		if user.Role == "" {
			user.Role = "user"
		}

		users = append(users, user)
	}

	return users, nil
}

// UpdateUser updates user information
func (d *Database) UpdateUser(id int64, name, avatarURL string) error {
	_, err := d.db.Exec(
		"UPDATE users SET name = ?, avatar_url = ? WHERE id = ?",
		name, avatarURL, id,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to update user: %v", err)
		return err
	}

	log.Printf("[DB] User updated successfully: ID=%d", id)
	return nil
}

// DeleteUser deletes a user by ID
func (d *Database) DeleteUser(id int64) error {
	_, err := d.db.Exec("DELETE FROM users WHERE id = ?", id)
	if err != nil {
		log.Printf("[DB ERROR] Failed to delete user: %v", err)
		return err
	}

	log.Printf("[DB] User deleted successfully: ID=%d", id)
	return nil
}

// CreateLocalUser creates a new user with email/password authentication
func (d *Database) CreateLocalUser(email, password, name string) (*User, error) {
	log.Printf("[DB] Creating local user: email=%s", email)

	// Check if user already exists
	existingUser, err := d.GetUserByEmail(email)
	if err == nil && existingUser != nil {
		log.Printf("[DB ERROR] User already exists with email: %s", email)
		return nil, sql.ErrNoRows
	}

	// Hash the password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("[DB ERROR] Failed to hash password: %v", err)
		return nil, err
	}

	// Insert new user with "local" provider
	result, err := d.db.Exec(
		"INSERT INTO users (email, provider, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
		email, "local", name, string(hashedPassword), "user",
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to insert local user: %v", err)
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	log.Printf("[DB] Local user created successfully with ID: %d", id)
	return d.GetUserByID(id)
}

// ValidatePassword checks if the provided password matches the stored hash
func (d *Database) ValidatePassword(email, password string) (*User, error) {
	user, err := d.GetUserByEmail(email)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, sql.ErrNoRows
	}

	// Check if this is a local user (has password hash)
	if user.PasswordHash == "" {
		log.Printf("[DB ERROR] User %s does not have a password (OAuth user)", email)
		return nil, sql.ErrNoRows
	}

	// Compare password with hash
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		log.Printf("[DB ERROR] Invalid password for user: %s", email)
		return nil, err
	}

	log.Printf("[DB] Password validated successfully for user: %s", email)
	return user, nil
}
