package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/grove/generic-proxy/internal/utils"
)

type contextKey string

const (
	UserIDKey contextKey = "user_id"
	RoleKey   contextKey = "role"
)

// AuthMiddleware validates JWT tokens and extracts user claims
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log.Printf("[AUTH] Validating request: %s %s", r.Method, r.URL.Path)

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				log.Printf("[AUTH ERROR] Missing authorization header")
				respondWithError(w, http.StatusUnauthorized, "missing authorization header")
				return
			}
			log.Printf("[AUTH] Authorization header present")

			// Extract token from "Bearer <token>"
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				log.Printf("[AUTH ERROR] Invalid authorization header format")
				respondWithError(w, http.StatusUnauthorized, "invalid authorization header format")
				return
			}

			tokenString := parts[1]
			log.Printf("[AUTH] Validating JWT token...")

			// Validate JWT
			claims, err := utils.ValidateJWT(tokenString, jwtSecret)
			if err != nil {
				log.Printf("[AUTH ERROR] JWT validation failed: %v", err)
				respondWithError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}
			log.Printf("[AUTH] JWT validated successfully - User: %s, Role: %s", claims.UserID, claims.Role)

			// Add claims to request context
			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, RoleKey, claims.Role)
			log.Printf("[AUTH] Authentication successful, proceeding to next handler")

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func respondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
