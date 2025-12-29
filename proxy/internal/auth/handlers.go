package auth

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"

	"github.com/grove/generic-proxy/internal/db"
	"github.com/markbates/goth/gothic"
)

type Handler struct {
	database    *db.Database
	jwtSecret   string
	frontendURL string
}

type AuthResponse struct {
	Token    string `json:"token"`
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	Provider string `json:"provider"`
	Role     string `json:"role"`
}

func NewHandler(database *db.Database, jwtSecret, frontendURL string) *Handler {
	return &Handler{
		database:    database,
		jwtSecret:   jwtSecret,
		frontendURL: frontendURL,
	}
}

// BeginAuth initiates OAuth flow
func (h *Handler) BeginAuth(w http.ResponseWriter, r *http.Request) {
	log.Printf("[AUTH] Beginning OAuth flow for provider: %s", r.URL.Query().Get("provider"))

	// Goth's gothic package handles the OAuth redirect
	gothic.BeginAuthHandler(w, r)
}

// CallbackAuth handles OAuth callback
func (h *Handler) CallbackAuth(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	log.Printf("[AUTH] OAuth callback received for provider: %s", provider)

	// Complete OAuth flow and get user info from provider
	gothUser, err := gothic.CompleteUserAuth(w, r)
	if err != nil {
		log.Printf("[AUTH ERROR] Failed to complete OAuth: %v", err)
		http.Error(w, fmt.Sprintf("Authentication failed: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[AUTH] OAuth successful - Email: %s, Provider: %s, Name: %s",
		gothUser.Email, gothUser.Provider, gothUser.Name)

	// Save or update user in database
	user, err := h.database.CreateUser(
		gothUser.Email,
		gothUser.Provider,
		gothUser.Name,
		gothUser.AvatarURL,
	)
	if err != nil {
		log.Printf("[AUTH ERROR] Failed to save user to database: %v", err)
		http.Error(w, "Failed to save user", http.StatusInternalServerError)
		return
	}

	log.Printf("[AUTH] User saved/retrieved from database - ID: %d, Email: %s", user.ID, user.Email)

	// Determine user role (default to "user", can be customized based on email domain, etc.)
	role := "user"
	// Example: Make specific emails admin
	if user.Email == "admin@example.com" || user.Email == "admin@grove.com" {
		role = "admin"
	}

	// Generate JWT token
	token, err := GenerateJWT(user.ID, user.Email, user.Provider, role, h.jwtSecret)
	if err != nil {
		log.Printf("[AUTH ERROR] Failed to generate JWT: %v", err)
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	log.Printf("[AUTH] JWT generated successfully for user: %s", user.Email)
	log.Printf("[AUTH] Token preview: %s...%s (length: %d)", token[:20], token[len(token)-20:], len(token))

	// Redirect to frontend callback page with token in URL
	callbackURL := fmt.Sprintf("%s/auth/callback?token=%s&user_id=%d&email=%s&role=%s",
		h.frontendURL,
		url.QueryEscape(token),
		user.ID,
		url.QueryEscape(user.Email),
		url.QueryEscape(role),
	)

	log.Printf("[AUTH] Redirect URL: %s", callbackURL[:100]+"...")
	http.Redirect(w, r, callbackURL, http.StatusTemporaryRedirect)
	log.Printf("[AUTH] Authentication complete for user: %s (ID: %d), redirecting to frontend", user.Email, user.ID)
}

// Logout handles user logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	log.Printf("[AUTH] Logout request received")

	// Clear the gothic session
	if err := gothic.Logout(w, r); err != nil {
		log.Printf("[AUTH WARN] Failed to clear gothic session: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Logged out successfully",
	})

	log.Println("[AUTH] Logout successful")
}

// GetCurrentUser returns the current authenticated user info
func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	// Extract user info from context (set by AuthMiddleware)
	claims, ok := r.Context().Value("user").(*JWTClaims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id":  claims.UserID,
		"email":    claims.Email,
		"provider": claims.Provider,
		"role":     claims.Role,
	})
}
