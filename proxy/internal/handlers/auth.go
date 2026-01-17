package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/grove/generic-proxy/internal/db"
	"github.com/grove/generic-proxy/internal/middleware"
	"github.com/grove/generic-proxy/internal/utils"
)

type AuthHandler struct {
	database  *db.Database
	jwtSecret string
}

func NewAuthHandler(database *db.Database, jwtSecret string) *AuthHandler {
	return &AuthHandler{
		database:  database,
		jwtSecret: jwtSecret,
	}
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type ChangePasswordResponse struct {
	Message string `json:"message"`
	Token   string `json:"token,omitempty"`
}

// ChangePassword handles password changes for authenticated users
// POST /api/auth/change-password
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	log.Printf("[AUTH] Change password request from %s", r.RemoteAddr)

	// Extract user ID from context (set by AuthMiddleware)
	userIDStr, ok := r.Context().Value(middleware.UserIDKey).(string)
	if !ok {
		log.Printf("[AUTH ERROR] User ID not found in context")
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	userID, err := strconv.ParseInt(userIDStr, 10, 64)
	if err != nil {
		log.Printf("[AUTH ERROR] Invalid user ID format: %s", userIDStr)
		respondWithError(w, http.StatusBadRequest, "invalid user ID")
		return
	}

	// Parse request body
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[AUTH ERROR] Failed to decode request body: %v", err)
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if req.OldPassword == "" || req.NewPassword == "" {
		log.Printf("[AUTH ERROR] Old password and new password are required")
		respondWithError(w, http.StatusBadRequest, "old_password and new_password are required")
		return
	}

	// Validate new password strength (minimum 6 characters)
	if len(req.NewPassword) < 6 {
		log.Printf("[AUTH ERROR] New password too short")
		respondWithError(w, http.StatusBadRequest, "new password must be at least 6 characters")
		return
	}

	log.Printf("[AUTH] Changing password for user ID: %d", userID)

	// Get user from database
	user, err := h.database.GetUserByID(userID)
	if err != nil || user == nil {
		log.Printf("[AUTH ERROR] Failed to get user: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to retrieve user")
		return
	}

	// Verify old password
	_, err = h.database.ValidatePassword(user.Email, req.OldPassword)
	if err != nil {
		log.Printf("[AUTH ERROR] Old password verification failed for user ID: %d", userID)
		respondWithError(w, http.StatusUnauthorized, "old password is incorrect")
		return
	}

	// Update password (this also clears must_change_password flag)
	err = h.database.UpdatePassword(userID, req.NewPassword)
	if err != nil {
		log.Printf("[AUTH ERROR] Failed to update password: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to update password")
		return
	}

	log.Printf("[AUTH] Password changed successfully for user ID: %d", userID)

	// Generate new JWT token without must_change_password flag
	// SECURITY NOTE: Issue a fresh token after password change to ensure old tokens
	// with must_change_password=true are effectively invalidated
	token, err := utils.GenerateJWTWithPasswordFlag(
		fmt.Sprintf("%d", userID),
		user.Role,
		false, // must_change_password is now false
		h.jwtSecret,
	)
	if err != nil {
		log.Printf("[AUTH ERROR] Failed to generate new JWT: %v", err)
		// Still return success since password was changed
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ChangePasswordResponse{
			Message: "Password changed successfully",
		})
		return
	}

	// Return success response with new token
	w.Header().Set("Content-Type", "application/json")
	response := ChangePasswordResponse{
		Message: "Password changed successfully",
		Token:   token,
	}
	json.NewEncoder(w).Encode(response)
}
