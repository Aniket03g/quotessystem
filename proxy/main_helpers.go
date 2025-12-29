package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/grove/generic-proxy/internal/auth"
	"github.com/grove/generic-proxy/internal/config"
	"github.com/grove/generic-proxy/internal/db"
	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/github"
	"github.com/markbates/goth/providers/google"
)

// initializeGothProviders sets up OAuth providers
func initializeGothProviders(cfg *config.Config) {
	var providers []goth.Provider

	// Google OAuth
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		log.Println("[OAUTH] Initializing Google OAuth provider")
		providers = append(providers, google.New(
			cfg.GoogleClientID,
			cfg.GoogleClientSecret,
			cfg.GoogleCallbackURL,
			"email", "profile",
		))
	}

	// GitHub OAuth
	if cfg.GitHubClientID != "" && cfg.GitHubClientSecret != "" {
		log.Println("[OAUTH] Initializing GitHub OAuth provider")
		providers = append(providers, github.New(
			cfg.GitHubClientID,
			cfg.GitHubClientSecret,
			cfg.GitHubCallbackURL,
			"user:email",
		))
	}

	if len(providers) == 0 {
		log.Println("[OAUTH WARN] No OAuth providers configured")
	} else {
		goth.UseProviders(providers...)
		log.Printf("[OAUTH] %d OAuth provider(s) initialized", len(providers))
	}
}

// securePingHandler is a protected endpoint that queries user info from SQLite
func securePingHandler(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract user claims from context (set by AuthMiddleware)
		claims, ok := r.Context().Value("user").(*auth.JWTClaims)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		log.Printf("[SECURE PING] Request from user: %s (ID: %s)", claims.Email, claims.UserID)

		// Parse user ID
		userID, err := strconv.ParseInt(claims.UserID, 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		// Query user from database
		user, err := database.GetUserByID(userID)
		if err != nil {
			log.Printf("[SECURE PING ERROR] Failed to query user: %v", err)
			http.Error(w, "Failed to fetch user info", http.StatusInternalServerError)
			return
		}

		if user == nil {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		// Return user info
		response := map[string]interface{}{
			"message":    "Secure endpoint accessed successfully",
			"user_id":    user.ID,
			"email":      user.Email,
			"provider":   user.Provider,
			"name":       user.Name,
			"avatar_url": user.AvatarURL,
			"created_at": user.CreatedAt,
			"jwt_claims": map[string]string{
				"user_id":  claims.UserID,
				"email":    claims.Email,
				"provider": claims.Provider,
				"role":     claims.Role,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("[SECURE PING ERROR] Failed to encode response: %v", err)
			return
		}

		log.Printf("[SECURE PING] Response sent successfully for user: %s", user.Email)
	}
}

func getEnv(key, defaultValue string) string {
	return defaultValue
}

func maskSecret(secret string) string {
	if len(secret) <= 8 {
		return "****"
	}
	return secret[:4] + "****" + secret[len(secret)-4:]
}

func respondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// deriveMetaBaseURL extracts the base URL and constructs the metadata API URL
// Example: "http://host:8090/api/v3/data/pbf7tt48gxdl50h/" -> "http://host:8090/api/v2/"
func deriveMetaBaseURL(nocoDBURL string) string {
	// Find the position of "/api/"
	apiIndex := -1
	for i := 0; i < len(nocoDBURL); i++ {
		if i+5 <= len(nocoDBURL) && nocoDBURL[i:i+5] == "/api/" {
			apiIndex = i
			break
		}
	}

	if apiIndex == -1 {
		// Fallback: just return the URL up to the first path segment
		parts := []string{}
		slashCount := 0
		currentPart := ""
		for i := 0; i < len(nocoDBURL); i++ {
			if nocoDBURL[i] == '/' {
				slashCount++
				if slashCount <= 3 {
					parts = append(parts, currentPart)
					currentPart = ""
				} else {
					break
				}
			} else {
				currentPart += string(nocoDBURL[i])
			}
		}
		if len(parts) >= 3 {
			return parts[0] + "//" + parts[2] + "/api/v2/"
		}
		return nocoDBURL
	}

	// Extract everything before "/api/" and append "/api/v2/"
	baseURL := nocoDBURL[:apiIndex]
	return baseURL + "/api/v2/"
}
