package main

// Read marks for the notifications page.
//
//   GET  /api/notifications/read                      -> {"keys": ["lead:42:2026-09-30", ...]}
//   POST /api/notifications/read  {"keys": [...], "read": true|false}
//
// The notifications themselves are built in the browser from live lead and
// warranty data; only which ones a user has dismissed is kept here, per user,
// so the state follows them across devices. Any signed-in user, own marks only.

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/grove/generic-proxy/internal/db"
	"github.com/grove/generic-proxy/internal/middleware"
)

const maxNotificationKeys = 500

func notificationReadsHandler(database *db.Database) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email, _ := r.Context().Value(middleware.EmailKey).(string)
		email = strings.ToLower(strings.TrimSpace(email))
		if email == "" {
			respondWithError(w, http.StatusUnauthorized, "no email in token")
			return
		}

		switch r.Method {
		case http.MethodGet:
			keys, err := database.GetNotificationReads(email)
			if err != nil {
				respondWithError(w, http.StatusInternalServerError, "failed to load read marks")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"keys": keys})

		case http.MethodPost:
			var req struct {
				Keys []string `json:"keys"`
				Read *bool    `json:"read"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
				respondWithError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			if len(req.Keys) == 0 || len(req.Keys) > maxNotificationKeys {
				respondWithError(w, http.StatusBadRequest, "keys must hold 1-500 entries")
				return
			}
			for _, k := range req.Keys {
				if k == "" || len(k) > 200 {
					respondWithError(w, http.StatusBadRequest, "invalid key")
					return
				}
			}
			read := req.Read == nil || *req.Read
			if err := database.SetNotificationsRead(email, req.Keys, read); err != nil {
				respondWithError(w, http.StatusInternalServerError, "failed to save read marks")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "count": len(req.Keys)})

		default:
			respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
}
