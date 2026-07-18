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
	Email        string `json:"email"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	ManagerEmail string `json:"manager_email"`
}

type CreateUserResponse struct {
	Message           string `json:"message"`
	Email             string `json:"email"`
	UserID            int64  `json:"user_id"`
	Role              string `json:"role"`
	TemporaryPassword string `json:"temporary_password"`
}

type UserListItem struct {
	ID                 int64  `json:"id"`
	Email              string `json:"email"`
	Name               string `json:"name"`
	Role               string `json:"role"`
	Provider           string `json:"provider"`
	MustChangePassword bool   `json:"must_change_password"`
	ManagerEmail       string `json:"manager_email"`
	CreatedAt          string `json:"created_at"`
}

type ListUsersResponse struct {
	Users []UserListItem `json:"users"`
	Total int            `json:"total"`
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

	if role != "admin" && role != "super_admin" {
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
	// Only super_admin can create another super_admin
	if req.Role == "super_admin" && role != "super_admin" {
		log.Printf("[ADMIN ERROR] Non-super-admin attempted to create super_admin: role=%s", role)
		respondWithError(w, http.StatusForbidden, "only super admin can create super admin accounts")
		return
	}
	if req.Role != "user" && req.Role != "manager" && req.Role != "admin" && req.Role != "super_admin" {
		log.Printf("[ADMIN ERROR] Invalid role: %s", req.Role)
		respondWithError(w, http.StatusBadRequest, "role must be 'user', 'manager', 'admin', or 'super_admin'")
		return
	}

	log.Printf("[ADMIN] Creating user: email=%s, name=%s, role=%s, manager=%q", req.Email, req.Name, req.Role, req.ManagerEmail)

	// Create user with temporary password
	user, tempPassword, err := h.database.CreateUserByAdmin(req.Email, req.Name, req.Role, req.ManagerEmail)
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

// ListUsers handles admin-only user listing
// GET /api/admin/users
func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ADMIN] List users request from %s", r.RemoteAddr)

	// Check if user is admin
	role, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok {
		log.Printf("[ADMIN ERROR] Role not found in context")
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if role != "admin" && role != "super_admin" {
		log.Printf("[ADMIN ERROR] Non-admin user attempted to list users: role=%s", role)
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Get all users from database
	users, err := h.database.GetAllUsers()
	if err != nil {
		log.Printf("[ADMIN ERROR] Failed to get users: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to retrieve users")
		return
	}

	// Convert to response format (exclude password hashes)
	userList := make([]UserListItem, 0, len(users))
	for _, user := range users {
		userList = append(userList, UserListItem{
			ID:                 user.ID,
			Email:              user.Email,
			Name:               user.Name,
			Role:               user.Role,
			Provider:           user.Provider,
			MustChangePassword: user.MustChangePassword,
			ManagerEmail:       user.ManagerEmail,
			CreatedAt:          user.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}

	log.Printf("[ADMIN] Successfully retrieved %d users", len(userList))

	// Return users list
	w.Header().Set("Content-Type", "application/json")
	response := ListUsersResponse{
		Users: userList,
		Total: len(userList),
	}
	json.NewEncoder(w).Encode(response)
}

type ResetPasswordRequest struct {
	UserID int64 `json:"user_id"`
}

type ResetPasswordResponse struct {
	Message           string `json:"message"`
	Email             string `json:"email"`
	UserID            int64  `json:"user_id"`
	TemporaryPassword string `json:"temporary_password"`
}

// ResetPassword handles admin-only password reset
// POST /api/admin/users/reset-password
func (h *AdminHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ADMIN] Reset password request from %s", r.RemoteAddr)

	// Check if user is admin
	role, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok {
		log.Printf("[ADMIN ERROR] Role not found in context")
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if role != "admin" && role != "super_admin" {
		log.Printf("[ADMIN ERROR] Non-admin user attempted to reset password: role=%s", role)
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Parse request body
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ADMIN ERROR] Failed to decode request body: %v", err)
		respondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate user ID
	if req.UserID <= 0 {
		log.Printf("[ADMIN ERROR] Invalid user ID: %d", req.UserID)
		respondWithError(w, http.StatusBadRequest, "valid user_id is required")
		return
	}

	log.Printf("[ADMIN] Resetting password for user ID: %d", req.UserID)

	// Reset password
	tempPassword, err := h.database.ResetUserPassword(req.UserID)
	if err != nil {
		if err.Error() == "user not found" {
			log.Printf("[ADMIN ERROR] User not found: ID=%d", req.UserID)
			respondWithError(w, http.StatusNotFound, "user not found")
			return
		}
		log.Printf("[ADMIN ERROR] Failed to reset password: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	// Get user details for response
	user, err := h.database.GetUserByID(req.UserID)
	if err != nil {
		log.Printf("[ADMIN ERROR] Failed to get user details: %v", err)
		respondWithError(w, http.StatusInternalServerError, "failed to get user details")
		return
	}

	log.Printf("[ADMIN] Password reset successfully for user ID: %d, Email: %s", req.UserID, user.Email)
	// SECURITY NOTE: Temporary password is only returned once in this response

	// Return success response with temporary password
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	response := ResetPasswordResponse{
		Message:           "Password reset successfully",
		Email:             user.Email,
		UserID:            user.ID,
		TemporaryPassword: tempPassword,
	}
	json.NewEncoder(w).Encode(response)
}

// DeleteUser handles admin-only user deletion
// DELETE /api/admin/users/{id}
func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ADMIN] Delete user request from %s", r.RemoteAddr)

	role, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok || (role != "admin" && role != "super_admin") {
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == 0 {
		respondWithError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	if err := h.database.DeleteUser(req.UserID); err != nil {
		log.Printf("[ADMIN ERROR] Failed to delete user %d: %v", req.UserID, err)
		respondWithError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}

	log.Printf("[ADMIN] User %d deleted successfully", req.UserID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "user deleted successfully"})
}

// UpdateUserRole handles role changes (admin → user, user → admin, etc.)
// PATCH /api/admin/users/role
func (h *AdminHandler) UpdateUserRole(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ADMIN] Update role request from %s", r.RemoteAddr)

	callerRole, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok || (callerRole != "admin" && callerRole != "super_admin") {
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req struct {
		UserID  int64  `json:"user_id"`
		NewRole string `json:"new_role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == 0 {
		respondWithError(w, http.StatusBadRequest, "user_id and new_role are required")
		return
	}

	if req.NewRole != "user" && req.NewRole != "manager" && req.NewRole != "admin" && req.NewRole != "super_admin" {
		respondWithError(w, http.StatusBadRequest, "new_role must be 'user', 'manager', 'admin', or 'super_admin'")
		return
	}
	// Only super_admin can assign super_admin role
	if req.NewRole == "super_admin" && callerRole != "super_admin" {
		respondWithError(w, http.StatusForbidden, "only super admin can assign super admin role")
		return
	}

	if err := h.database.UpdateUserRole(req.UserID, req.NewRole); err != nil {
		log.Printf("[ADMIN ERROR] Failed to update role for user %d: %v", req.UserID, err)
		respondWithError(w, http.StatusInternalServerError, "failed to update role")
		return
	}

	log.Printf("[ADMIN] Role updated for user %d to %s", req.UserID, req.NewRole)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("role updated to %s", req.NewRole)})
}

// UpdateUserManager sets or clears which manager a user reports to.
// PATCH /api/admin/users/manager  { "user_id": 12, "manager_email": "j@co.com" }
// An empty manager_email clears the linkage.
func (h *AdminHandler) UpdateUserManager(w http.ResponseWriter, r *http.Request) {
	callerRole, ok := r.Context().Value(middleware.RoleKey).(string)
	if !ok || (callerRole != "admin" && callerRole != "super_admin") {
		respondWithError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req struct {
		UserID       int64  `json:"user_id"`
		ManagerEmail string `json:"manager_email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == 0 {
		respondWithError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	if err := h.database.SetUserManager(req.UserID, req.ManagerEmail); err != nil {
		log.Printf("[ADMIN ERROR] Failed to set manager for user %d: %v", req.UserID, err)
		respondWithError(w, http.StatusInternalServerError, "failed to set manager")
		return
	}

	log.Printf("[ADMIN] Manager for user %d set to %q", req.UserID, req.ManagerEmail)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "manager updated"})
}

func respondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
