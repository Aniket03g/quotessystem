package middleware

import (
	"log"
	"net/http"
)

// CORSMiddleware ensures consistent and secure CORS headers.
// This middleware should be applied ONCE at the outermost layer to prevent duplicate headers.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Allow only approved origins (frontend localhost for development)
		// In production, whitelist only your real domain
		allowedOrigins := map[string]bool{
			"http://localhost:4321": true, // Astro frontend
			"http://localhost:3000": true, // Alternative frontend port
			"http://127.0.0.1:4321": true,
			"http://127.0.0.1:3000": true,
		}

		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			log.Printf("[CORS] Allowed Origin: %s", origin)
		} else if origin == "" {
			// No origin header (e.g., same-origin or non-browser request)
			w.Header().Set("Access-Control-Allow-Origin", "*")
			log.Printf("[CORS] No origin header - allowing all")
		} else {
			// Unknown origin - allow all for now (tighten in production)
			w.Header().Set("Access-Control-Allow-Origin", "*")
			log.Printf("[CORS] Unknown origin '%s' - allowing all", origin)
		}

		// Set other CORS headers
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, xc-token")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "3600") // Cache preflight for 1 hour

		// Handle preflight (OPTIONS) requests directly
		if r.Method == http.MethodOptions {
			log.Printf("[CORS] Handling preflight request for: %s", r.URL.Path)
			w.WriteHeader(http.StatusOK)
			return
		}

		// Continue to next handler
		next.ServeHTTP(w, r)
	})
}
