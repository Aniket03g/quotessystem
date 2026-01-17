package db

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"

	"golang.org/x/crypto/bcrypt"
)

// CreateUserByAdmin creates a new user with a temporary password (admin-only operation)
// Returns the created user and the plaintext temporary password
func (d *Database) CreateUserByAdmin(email, name, role string) (*User, string, error) {
	log.Printf("[DB] Admin creating user: email=%s, role=%s", email, role)

	// Validate role
	if role != "user" && role != "admin" {
		return nil, "", fmt.Errorf("invalid role: must be 'user' or 'admin'")
	}

	// Check if user already exists
	existingUser, err := d.GetUserByEmail(email)
	if err == nil && existingUser != nil {
		log.Printf("[DB ERROR] User already exists with email: %s", email)
		return nil, "", fmt.Errorf("user with email %s already exists", email)
	}

	// Generate secure temporary password
	tempPassword, err := GenerateSecurePassword(16)
	if err != nil {
		log.Printf("[DB ERROR] Failed to generate temporary password: %v", err)
		return nil, "", fmt.Errorf("failed to generate temporary password: %w", err)
	}

	// Hash the temporary password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("[DB ERROR] Failed to hash password: %v", err)
		return nil, "", fmt.Errorf("failed to hash password: %w", err)
	}

	// Insert new user with must_change_password = true
	result, err := d.db.Exec(
		"INSERT INTO users (email, provider, name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?)",
		email, "local", name, string(hashedPassword), role, true,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to insert user: %v", err)
		return nil, "", fmt.Errorf("failed to create user: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, "", err
	}

	log.Printf("[DB] User created successfully by admin: ID=%d, Email=%s, Role=%s", id, email, role)

	user, err := d.GetUserByID(id)
	if err != nil {
		return nil, "", err
	}

	// Return user and plaintext temporary password (only shown once)
	return user, tempPassword, nil
}

// UpdatePassword updates a user's password and clears the must_change_password flag
func (d *Database) UpdatePassword(userID int64, newPassword string) error {
	log.Printf("[DB] Updating password for user ID: %d", userID)

	// Hash the new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("[DB ERROR] Failed to hash new password: %v", err)
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Update password and clear must_change_password flag
	_, err = d.db.Exec(
		"UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
		string(hashedPassword), userID,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to update password: %v", err)
		return fmt.Errorf("failed to update password: %w", err)
	}

	log.Printf("[DB] Password updated successfully for user ID: %d", userID)
	return nil
}

// GenerateSecurePassword generates a cryptographically secure random password
// with mixed case letters, digits, and special characters
func GenerateSecurePassword(length int) (string, error) {
	if length < 8 {
		return "", fmt.Errorf("password length must be at least 8 characters")
	}

	// Character sets for password generation
	const (
		lowercase = "abcdefghijklmnopqrstuvwxyz"
		uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		digits    = "0123456789"
		symbols   = "!@#$%^&*()-_=+[]{}|;:,.<>?"
	)

	// Combine all character sets
	allChars := lowercase + uppercase + digits + symbols

	// Ensure at least one character from each set
	password := make([]byte, length)

	// Add one character from each required set
	charSets := []string{lowercase, uppercase, digits, symbols}
	for i, charset := range charSets {
		randomIndex, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", fmt.Errorf("failed to generate random number: %w", err)
		}
		password[i] = charset[randomIndex.Int64()]
	}

	// Fill remaining characters randomly from all sets
	for i := len(charSets); i < length; i++ {
		randomIndex, err := rand.Int(rand.Reader, big.NewInt(int64(len(allChars))))
		if err != nil {
			return "", fmt.Errorf("failed to generate random number: %w", err)
		}
		password[i] = allChars[randomIndex.Int64()]
	}

	// Shuffle the password to avoid predictable patterns
	// (first 4 chars are always lowercase, uppercase, digit, symbol)
	for i := length - 1; i > 0; i-- {
		randomIndex, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", fmt.Errorf("failed to generate random number: %w", err)
		}
		j := randomIndex.Int64()
		password[i], password[j] = password[j], password[i]
	}

	return string(password), nil
}
