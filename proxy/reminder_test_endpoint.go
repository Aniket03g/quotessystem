package main

// TEMPORARY — test-only endpoint for checking the warranty reminder email
// before the scheduler is switched on. Delete this whole file, the one
// mux.Handle line in main.go that registers it, and Scheduler.SendTestTo when
// testing is done.
//
// Deliberately narrow so it cannot cause damage:
//   - admin / super_admin only
//   - always mails the caller's own address, never the admin list
//   - never stamps "Last Reminded", so a row's real reminder is not consumed
//   - sends even when WARRANTY_REMINDERS=dry, which is the point

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/grove/generic-proxy/internal/middleware"
	"github.com/grove/generic-proxy/internal/reminders"
)

func warrantyReminderTestHandler(sched *reminders.Scheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "POST only"})
			return
		}

		role, _ := r.Context().Value(middleware.RoleKey).(string)
		if role != "admin" && role != "super_admin" {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "admin or super_admin only"})
			return
		}

		email, _ := r.Context().Value(middleware.EmailKey).(string)
		if email == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "no email on your token; log out and back in",
			})
			return
		}

		if sched == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "reminder scheduler is not running (MetaCache disabled?)",
			})
			return
		}

		var recordID int64
		if v := r.URL.Query().Get("id"); v != "" {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				recordID = n
			}
		}

		title, err := sched.SendTestTo(email, recordID)
		if err != nil {
			log.Printf("[REMINDERS TEST] %s requested a test email: %v", email, err)
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		log.Printf("[REMINDERS TEST] Sent %q to %s", title, email)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"sent": true, "to": email, "row": title,
		})
	}
}
