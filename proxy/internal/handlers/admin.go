package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/grove/generic-proxy/internal/db"
	"github.com/grove/generic-proxy/internal/middleware"
)

type AdminHandler struct {
	database *db.Database
}

func NewAdminHandler(database *db.Database) *AdminHandler {
	return &AdminHandler{
		database: database,
	}
}

type CreateUserRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type CreateUserResponse struct {
	Message           string `json:"message"`
	Email             string `json:"email"`
	UserID            int64  `json:"user_id"`
	Role              string `json:"role"`
	TemporaryPassword string `json:"temporary_password"`
}

// CreateUser handles admin-only user creation with temporary password
// POST /api/admin/users
func (h *AdminHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ADMIN] Create user request from %s", r.RemoteAddr)

	// Check if user is admin (role is set by AuthMiddleware in context)
	role, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok {
		log.Printf("[ADMIN ERROR] Role not found in context")
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if role != "admin" {
		log.Printf("[ADMIN ERROR] Non-admin user attempted to create user: role=%s", role)
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Parse request body
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ADMIN ERROR] Failed to decode request body: %v", err)
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if req.Email == "" {
		log.Printf("[ADMIN ERROR] Email is required")
		respondWithError(w, http.StatusBadRequest, "email is required")
		return
	}

	// Validate role (default to "user" if not specified)
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "user" && req.Role != "admin" {
		log.Printf("[ADMIN ERROR] Invalid role: %s", req.Role)
		respondWithError(w, http.StatusBadRequest, "role must be 'user' or 'admin'")
		return
	}

	log.Printf("[ADMIN] Creating user: email=%s, name=%s, role=%s", req.Email, req.Name, req.Role)

	// Create user with temporary password
	user, tempPassword, err := h.database.CreateUserByAdmin(req.Email, req.Name, req.Role)
	if err != nil {
		// Check if user already exists
		if err.Error() == fmt.Sprintf("user with email %s already exists", req.Email) {
			log.Printf("[ADMIN ERROR] User already exists: %s", req.Email)
			respondWithError(w, http.StatusConflict, "user with this email already exists")
			return
		}
		log.Printf("[ADMIN ERROR] Failed to create user: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	log.Printf("[ADMIN] User created successfully: ID=%d, Email=%s, Role=%s", user.ID, user.Email, user.Role)
	// SECURITY NOTE: Temporary password is only returned once in this response
	// It should be securely communicated to the user and never logged

	// Return success response with temporary password
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	response := CreateUserResponse{
		Message:           "User created successfully",
		Email:             user.Email,
		UserID:            user.ID,
		Role:              user.Role,
		TemporaryPassword: tempPassword,
	}
	json.NewEncoder(w).Encode(response)
}

func respondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
