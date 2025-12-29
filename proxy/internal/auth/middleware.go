package auth

import (
	"context"
	"log"
	"net/http"
	"strings"
)

// AuthMiddleware validates JWT tokens on protected routes
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				log.Printf("[AUTH MIDDLEWARE] No Authorization header found")
				http.Error(w, "Unauthorized: No token provided", http.StatusUnauthorized)
				return
			}

			// Check for Bearer token format
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				log.Printf("[AUTH MIDDLEWARE] Invalid Authorization header format")
				http.Error(w, "Unauthorized: Invalid token format", http.StatusUnauthorized)
				return
			}

			tokenString := parts[1]

			// Validate JWT
			claims, err := ValidateJWT(tokenString, jwtSecret)
			if err != nil {
				log.Printf("[AUTH MIDDLEWARE] Token validation failed: %v", err)
				http.Error(w, "Unauthorized: Invalid token", http.StatusUnauthorized)
				return
			}

			log.Printf("[AUTH MIDDLEWARE] Token validated for user: %s (ID: %s)", claims.Email, claims.UserID)

			// Add claims to request context
			ctx := context.WithValue(r.Context(), "user", claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
