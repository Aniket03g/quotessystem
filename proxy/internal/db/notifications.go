package db

import (
	"fmt"
	"log"
)

// Notifications themselves are not stored: the frontend derives them from live
// data (lead follow-up dates, warranty/AMC end dates), so they can never drift
// from the records they describe. Only the per-user "read" marks live here,
// keyed by a string the frontend builds, e.g. "lead:42:2026-09-30". The date in
// the key means rescheduling a follow-up produces a fresh, unread notification.

func (d *Database) initNotificationsSchema() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS notification_reads (
			user_email TEXT NOT NULL,
			key TEXT NOT NULL,
			read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (user_email, key)
		);
	`)
	if err != nil {
		log.Printf("[DB ERROR] Failed to create notification_reads table: %v", err)
		return err
	}
	return nil
}

// GetNotificationReads returns every key the user has marked read.
func (d *Database) GetNotificationReads(userEmail string) ([]string, error) {
	rows, err := d.db.Query(`SELECT key FROM notification_reads WHERE user_email = ?`, userEmail)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// SetNotificationsRead marks keys read (read=true) or unread (read=false) for
// one user, in a single transaction so "mark all read" is all-or-nothing.
func (d *Database) SetNotificationsRead(userEmail string, keys []string, read bool) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	query := `INSERT OR IGNORE INTO notification_reads (user_email, key) VALUES (?, ?)`
	if !read {
		query = `DELETE FROM notification_reads WHERE user_email = ? AND key = ?`
	}
	stmt, err := tx.Prepare(query)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, k := range keys {
		if _, err := stmt.Exec(userEmail, k); err != nil {
			tx.Rollback()
			return fmt.Errorf("mark %q: %w", k, err)
		}
	}
	return tx.Commit()
}
