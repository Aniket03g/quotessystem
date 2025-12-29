package middleware

import (
	"log"
	"net/http"
)

// AuthorizeMiddleware applies row-level filtering for non-admin users
func AuthorizeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[AUTHORIZE] Processing authorization for: %s %s", r.Method, r.URL.Path)

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			log.Printf("[AUTHORIZE ERROR] user_id not found in context")
			respondWithError(w, http.StatusUnauthorized, "user_id not found in context")
			return
		}
		log.Printf("[AUTHORIZE] User ID: %s", userID)

		role, ok := r.Context().Value(RoleKey).(string)
		if !ok {
			log.Printf("[AUTHORIZE ERROR] role not found in context")
			respondWithError(w, http.StatusUnauthorized, "role not found in context")
			return
		}
		log.Printf("[AUTHORIZE] User Role: %s", role)

		// Admin users bypass row-level filtering
		if role == "admin" {
			log.Printf("[AUTHORIZE] Admin user detected - bypassing row-level filtering")
			next.ServeHTTP(w, r)
			return
		}

		// TEMPORARY: Row-level filtering disabled until created_by column is added to NocoDB tables
		// TODO: Add created_by column to all tables in NocoDB, then uncomment the code below
		log.Printf("[AUTHORIZE] Row-level filtering temporarily disabled - all users can see all records")

		// For non-admin users, inject row-level filter
		// Check if this is a table that should have created_by filtering
		// We'll apply filtering to all GET requests to /records endpoints
		/*
			if r.Method == "GET" && strings.Contains(r.URL.Path, "/records") {
				log.Printf("[AUTHORIZE] Non-admin user accessing records - applying row-level filter")
				// Inject where clause: where=(created_by,eq,<user_id>)
				query := r.URL.Query()

				// Check if where clause already exists
				existingWhere := query.Get("where")
				if existingWhere != "" {
					// Append to existing where clause with AND logic
					// Format: where=(created_by,eq,user_id)~and(existing_clause)
					newWhere := fmt.Sprintf("(created_by,eq,%s)~and(%s)", userID, existingWhere)
					log.Printf("[AUTHORIZE] Appending to existing where clause: %s", newWhere)
					query.Set("where", newWhere)
				} else {
					// Create new where clause
					newWhere := fmt.Sprintf("(created_by,eq,%s)", userID)
					log.Printf("[AUTHORIZE] Creating new where clause: %s", newWhere)
					query.Set("where", newWhere)
				}

				r.URL.RawQuery = query.Encode()
				log.Printf("[AUTHORIZE] Modified query string: %s", r.URL.RawQuery)
			} else {
				log.Printf("[AUTHORIZE] Not a GET /records request - no filtering applied")
			}
		*/

		log.Printf("[AUTHORIZE] Authorization complete, proceeding to proxy")
		next.ServeHTTP(w, r)
	})
}
