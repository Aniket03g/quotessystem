// Package reminders emails admins once, two months before a warranty expires,
// so a renewal can be quoted while the customer is still covered.
//
// One reminder per warranty, not a series: the row's "Last Reminded" stamp is
// what stops it being sent again. Rows already inside the two-month window when
// the scheduler first runs are caught up rather than skipped — otherwise the
// most urgent warranties would be the only ones that never produced an email.
package reminders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/grove/generic-proxy/internal/db"
	"github.com/grove/generic-proxy/internal/proxy"
)

// Mode controls how far a run is allowed to go. The default is ModeDry so that
// enabling the scheduler cannot silently mail customers-facing staff about 18
// backfilled rows before anyone has read them.
type Mode string

const (
	ModeOff Mode = "off" // scheduler does not run at all
	ModeDry Mode = "dry" // scan and log what would be sent; no email, no writes
	ModeOn  Mode = "on"  // send and stamp
)

// ParseMode maps the WARRANTY_REMINDERS env value onto a Mode, defaulting to
// ModeDry for anything unrecognised.
func ParseMode(s string) Mode {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "on", "true", "1", "enabled":
		return ModeOn
	case "off", "false", "0", "disabled":
		return ModeOff
	default:
		return ModeDry
	}
}

type Config struct {
	NocoDBURL string // same base URL the proxy uses, e.g. http://host:8090/api/v3/data/
	BaseID    string
	Token     string
	TableName string // friendly table title, resolved through MetaCache
	LeadDays  int    // how far ahead to warn — 60, i.e. two months
	Interval  time.Duration
	Mode      Mode
	ResendKey string
	From      string
	AppURL    string // used to link back into the CRM from the email
}

type Scheduler struct {
	cfg  Config
	meta *proxy.MetaCache
	db   *db.Database
	http *http.Client
}

func New(cfg Config, meta *proxy.MetaCache, database *db.Database) *Scheduler {
	if cfg.LeadDays <= 0 {
		cfg.LeadDays = 60
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	if cfg.TableName == "" {
		cfg.TableName = "Warranty Reminders"
	}
	return &Scheduler{
		cfg:  cfg,
		meta: meta,
		db:   database,
		http: &http.Client{Timeout: 20 * time.Second},
	}
}

// Start runs the scan shortly after boot and then daily. Nothing here is fatal:
// a failed scan is logged and retried on the next tick.
func (s *Scheduler) Start() {
	if s.cfg.Mode == ModeOff {
		log.Printf("[REMINDERS] Disabled (WARRANTY_REMINDERS=off)")
		return
	}
	go func() {
		log.Printf("[REMINDERS] Starting: mode=%s lead=%dd interval=%v",
			s.cfg.Mode, s.cfg.LeadDays, s.cfg.Interval)

		// Give MetaCache time to finish its first load before the opening scan.
		time.Sleep(30 * time.Second)
		if err := s.RunOnce(); err != nil {
			log.Printf("[REMINDERS ERROR] Initial scan failed: %v", err)
		}

		ticker := time.NewTicker(s.cfg.Interval)
		defer ticker.Stop()
		for range ticker.C {
			if err := s.RunOnce(); err != nil {
				log.Printf("[REMINDERS ERROR] Scan failed: %v", err)
			}
		}
	}()
}

type record struct {
	ID     int64                  `json:"id"`
	Fields map[string]interface{} `json:"fields"`
}

func (r record) str(key string) string {
	if v, ok := r.Fields[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	return ""
}

// RunOnce scans the table and reminds on everything that is due and unreminded.
func (s *Scheduler) RunOnce() error {
	tableID, ok := s.meta.ResolveTable(s.cfg.TableName)
	if !ok {
		return fmt.Errorf("table %q not found in MetaCache", s.cfg.TableName)
	}

	records, err := s.fetch(tableID)
	if err != nil {
		return fmt.Errorf("fetch records: %w", err)
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	due := selectDue(records, today, s.cfg.LeadDays)

	if len(due) == 0 {
		log.Printf("[REMINDERS] %d row(s) scanned, none due", len(records))
		return nil
	}

	recipients, err := s.admins()
	if err != nil {
		return fmt.Errorf("resolve recipients: %w", err)
	}
	if len(recipients) == 0 {
		return fmt.Errorf("no admin or super_admin users to notify")
	}

	log.Printf("[REMINDERS] %d row(s) scanned, %d due, %d recipient(s), mode=%s",
		len(records), len(due), len(recipients), s.cfg.Mode)

	for _, rec := range due {
		expiry, _ := time.Parse("2006-01-02", rec.str("Expiry Date"))
		days := daysBetween(today, expiry)

		if s.cfg.Mode == ModeDry {
			log.Printf("[REMINDERS DRY] would email %v about %q (expires %s, %s)",
				recipients, rec.str("Title"), rec.str("Expiry Date"), describeDays(days))
			continue
		}

		if err := s.send(recipients, rec, days); err != nil {
			log.Printf("[REMINDERS ERROR] Row %d (%s): %v", rec.ID, rec.str("Title"), err)
			continue
		}
		// Stamped only after a successful send, so a failure retries tomorrow
		// rather than going silently unreported.
		stage := fmt.Sprintf("%d", s.cfg.LeadDays)
		if days < 0 {
			stage = "overdue"
		}
		if err := s.stamp(tableID, rec.ID, today.Format("2006-01-02"), stage); err != nil {
			log.Printf("[REMINDERS ERROR] Sent row %d but could not stamp it: %v", rec.ID, err)
		}
		log.Printf("[REMINDERS] Reminded %d admin(s) about %q (%s)",
			len(recipients), rec.str("Title"), describeDays(days))
	}
	return nil
}

// selectDue picks the rows that should produce a reminder today: unreminded,
// not already renewed, and within leadDays of expiry. Rows that expired before
// the scheduler existed are included rather than skipped, so the most urgent
// warranties are not the only ones that never generate an email.
func selectDue(records []record, today time.Time, leadDays int) []record {
	due := make([]record, 0, len(records))
	for _, rec := range records {
		if rec.str("Last Reminded") != "" {
			continue
		}
		if rec.str("Status") == "Renewed" {
			continue
		}
		expiry, err := time.Parse("2006-01-02", rec.str("Expiry Date"))
		if err != nil {
			log.Printf("[REMINDERS WARN] Row %d has an unreadable expiry date %q — skipping",
				rec.ID, rec.str("Expiry Date"))
			continue
		}
		if daysBetween(today, expiry) <= leadDays {
			due = append(due, rec)
		}
	}
	return due
}

func daysBetween(from, to time.Time) int {
	return int(to.Sub(from).Hours() / 24)
}

func describeDays(days int) string {
	if days < 0 {
		return fmt.Sprintf("expired %d days ago", -days)
	}
	return fmt.Sprintf("expires in %d days", days)
}

func (s *Scheduler) recordsURL(tableID string) string {
	base := strings.TrimRight(s.cfg.NocoDBURL, "/")
	return fmt.Sprintf("%s/%s/%s/records", base, s.cfg.BaseID, tableID)
}

func (s *Scheduler) fetch(tableID string) ([]record, error) {
	req, err := http.NewRequest("GET", s.recordsURL(tableID)+"?limit=1000", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("xc-token", s.cfg.Token)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nocodb %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	var payload struct {
		Records []record `json:"records"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	return payload.Records, nil
}

// stamp marks a row as reminded. NocoDB v3 wants a bare array here — the
// {"records": [...]} envelope used elsewhere fails with RECORD_NOT_FOUND.
func (s *Scheduler) stamp(tableID string, id int64, when, stage string) error {
	body, _ := json.Marshal([]map[string]interface{}{{
		"id": id,
		"fields": map[string]interface{}{
			"Last Reminded":  when,
			"Reminder Stage": stage,
		},
	}})
	req, err := http.NewRequest("PATCH", s.recordsURL(tableID), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("xc-token", s.cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("nocodb %d: %s", resp.StatusCode, truncate(string(msg), 200))
	}
	return nil
}

// admins returns the addresses that receive every reminder. Row-level ownership
// is not consulted: the backfilled rows have no owner, and admins bypass
// ownership filtering anyway.
func (s *Scheduler) admins() ([]string, error) {
	users, err := s.db.GetAllUsers()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []string
	for _, u := range users {
		if u.Role != "admin" && u.Role != "super_admin" {
			continue
		}
		email := strings.ToLower(strings.TrimSpace(u.Email))
		if email == "" || !strings.Contains(email, "@") || seen[email] {
			continue
		}
		seen[email] = true
		out = append(out, email)
	}
	return out, nil
}

func (s *Scheduler) send(to []string, rec record, days int) error {
	if s.cfg.ResendKey == "" || s.cfg.From == "" {
		return fmt.Errorf("email not configured (RESEND_API_KEY / EMAIL_FROM)")
	}
	payload := map[string]interface{}{
		"from":    s.cfg.From,
		"to":      to,
		"subject": fmt.Sprintf("Warranty %s — %s", describeDays(days), rec.str("Customer Name")),
		"html":    s.body(rec, days),
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.ResendKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend %d: %s", resp.StatusCode, truncate(string(msg), 200))
	}
	return nil
}

func (s *Scheduler) body(rec record, days int) string {
	esc := func(key string) string { return html.EscapeString(rec.str(key)) }

	// A computed date is the invoice plus the standard warranty term; the real
	// cover can run months longer. Saying so stops a rep phoning too early and
	// being told the customer is still covered.
	sourceNote := ""
	if rec.str("Expiry Source") == "computed" {
		sourceNote = `<p style="color:#8a6d3b;background:#fcf8e3;padding:10px;border-radius:4px">
			This date is calculated from the invoice, not confirmed with the manufacturer.
			Actual cover may run several months longer — check the portal before quoting.</p>`
	}

	link := ""
	if s.cfg.AppURL != "" {
		link = fmt.Sprintf(`<p><a href="%s/warranty">Open the warranty list</a></p>`,
			html.EscapeString(strings.TrimRight(s.cfg.AppURL, "/")))
	}

	return fmt.Sprintf(`<div style="font-family:system-ui,sans-serif;max-width:600px">
		<h2 style="margin-bottom:4px">%s</h2>
		<p style="color:#666;margin-top:0">%s</p>
		<table cellpadding="6" style="border-collapse:collapse">
			<tr><td><b>Expires</b></td><td>%s (%s)</td></tr>
			<tr><td><b>Customer</b></td><td>%s</td></tr>
			<tr><td><b>Location</b></td><td>%s</td></tr>
			<tr><td><b>Invoice</b></td><td>%s, dated %s</td></tr>
			<tr><td><b>Equipment</b></td><td>%s item(s)</td></tr>
		</table>
		<p style="color:#666;font-size:13px">%s</p>
		%s%s</div>`,
		esc("Title"), describeDays(days),
		esc("Expiry Date"), describeDays(days),
		esc("Customer Name"), esc("Location"),
		esc("Invoice No"), esc("Invoice Date"),
		esc("Asset Count"), esc("Assets"),
		sourceNote, link)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// SendTestTo renders the real reminder for one row and mails it to a single
// address. It deliberately does NOT stamp "Last Reminded", so using it cannot
// consume a row's one real reminder, and it ignores Mode so a dry-run install
// can still be tested.
//
// TEMPORARY: wired to a test button so the email can be checked before the
// scheduler is switched on. Delete alongside reminder_test_endpoint.go.
func (s *Scheduler) SendTestTo(to string, recordID int64) (string, error) {
	tableID, ok := s.meta.ResolveTable(s.cfg.TableName)
	if !ok {
		return "", fmt.Errorf("table %q not found in MetaCache", s.cfg.TableName)
	}
	records, err := s.fetch(tableID)
	if err != nil {
		return "", fmt.Errorf("fetch records: %w", err)
	}
	if len(records) == 0 {
		return "", fmt.Errorf("no warranty rows to preview")
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)

	// An explicit id wins; otherwise show what the scheduler would actually
	// send next, falling back to the first row so the button always works.
	var chosen *record
	if recordID > 0 {
		for i := range records {
			if records[i].ID == recordID {
				chosen = &records[i]
				break
			}
		}
		if chosen == nil {
			return "", fmt.Errorf("row %d not found", recordID)
		}
	} else if due := selectDue(records, today, s.cfg.LeadDays); len(due) > 0 {
		// Soonest expiry first, so the preview does not depend on the order
		// NocoDB happens to return rows in.
		sort.Slice(due, func(i, j int) bool {
			return due[i].str("Expiry Date") < due[j].str("Expiry Date")
		})
		chosen = &due[0]
	} else {
		chosen = &records[0]
	}

	expiry, err := time.Parse("2006-01-02", chosen.str("Expiry Date"))
	if err != nil {
		return "", fmt.Errorf("row %d has an unreadable expiry date %q", chosen.ID, chosen.str("Expiry Date"))
	}
	if err := s.send([]string{to}, *chosen, daysBetween(today, expiry)); err != nil {
		return "", err
	}
	return chosen.str("Title"), nil
}
