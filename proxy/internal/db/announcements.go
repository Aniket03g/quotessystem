package db

import (
	"fmt"
	"log"
	"time"
)

// Announcement is one broadcast email sent to all CRM users, kept as an audit
// record. Super-admin only; created after the frontend actually sends via Resend.
type Announcement struct {
	ID             int64     `json:"id"`
	SenderEmail    string    `json:"sender_email"`
	Subject        string    `json:"subject"`
	Message        string    `json:"message"`
	RecipientCount int       `json:"recipient_count"`
	SentCount      int       `json:"sent_count"`
	FailedCount    int       `json:"failed_count"`
	CreatedAt      time.Time `json:"created_at"`
}

// initAnnouncementsSchema creates the announcements table if it is missing.
// Called from initSchema so it runs on every startup.
func (d *Database) initAnnouncementsSchema() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS announcements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sender_email TEXT NOT NULL,
			subject TEXT NOT NULL,
			message TEXT NOT NULL,
			recipient_count INTEGER DEFAULT 0,
			sent_count INTEGER DEFAULT 0,
			failed_count INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		log.Printf("[DB ERROR] Failed to create announcements table: %v", err)
		return err
	}
	return nil
}

// LogAnnouncement records a sent announcement and returns the stored row.
func (d *Database) LogAnnouncement(senderEmail, subject, message string, recipientCount, sentCount, failedCount int) (*Announcement, error) {
	result, err := d.db.Exec(
		`INSERT INTO announcements (sender_email, subject, message, recipient_count, sent_count, failed_count)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		senderEmail, subject, message, recipientCount, sentCount, failedCount,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to log announcement: %v", err)
		return nil, fmt.Errorf("failed to log announcement: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	log.Printf("[DB] Announcement logged: ID=%d, sender=%s, sent=%d/%d", id, senderEmail, sentCount, recipientCount)

	a := &Announcement{}
	err = d.db.QueryRow(
		`SELECT id, sender_email, subject, message, recipient_count, sent_count, failed_count, created_at
		 FROM announcements WHERE id = ?`, id,
	).Scan(&a.ID, &a.SenderEmail, &a.Subject, &a.Message, &a.RecipientCount, &a.SentCount, &a.FailedCount, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// GetAnnouncements returns the most recent announcements, newest first.
func (d *Database) GetAnnouncements(limit int) ([]*Announcement, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := d.db.Query(
		`SELECT id, sender_email, subject, message, recipient_count, sent_count, failed_count, created_at
		 FROM announcements ORDER BY created_at DESC, id DESC LIMIT ?`, limit,
	)
	if err != nil {
		log.Printf("[DB ERROR] Failed to get announcements: %v", err)
		return nil, err
	}
	defer rows.Close()

	var announcements []*Announcement
	for rows.Next() {
		a := &Announcement{}
		if err := rows.Scan(&a.ID, &a.SenderEmail, &a.Subject, &a.Message, &a.RecipientCount, &a.SentCount, &a.FailedCount, &a.CreatedAt); err != nil {
			return nil, err
		}
		announcements = append(announcements, a)
	}
	return announcements, rows.Err()
}
