// Package reminders emails admins once, two months before a warranty expires,
// so a renewal can be quoted while the customer is still covered.
//
// Cover runs per product, not per invoice: one invoice can mix 1/3/5-year terms,
// so the products on it expire on different days and each expiry earns its own
// reminder. Products sharing an expiry date are reminded TOGETHER in one email —
// ten serials that lapse the same day are one renewal conversation, not ten.
//
// One reminder per product, not a series: the product row's "Last Reminded"
// stamp is what stops it being sent again. Products already inside the two-month
// window when the scheduler first runs are caught up rather than skipped —
// otherwise the most urgent warranties would be the only ones that never
// produced an email.
//
// An invoice with no product rows falls back to reminding on the invoice's own
// "Expiry Date". That keeps installs whose Warranty Assets table does not exist
// yet working exactly as they did before.
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
	"strconv"
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
	// AssetTableName holds the per-serial rows. When it cannot be resolved the
	// scheduler reminds on the invoice rows alone, as it did before assets
	// existed — a missing table must not stop reminders going out.
	AssetTableName string
	LeadDays       int // how far ahead to warn — 60, i.e. two months
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
	if cfg.AssetTableName == "" {
		cfg.AssetTableName = "Warranty Assets"
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

// dueGroup is one reminder email: the products of a single invoice that all
// expire on the same day. assets is empty for an invoice that has no product
// rows, in which case the invoice's own Expiry Date is what came due.
type dueGroup struct {
	parent record
	assets []record
	expiry time.Time
}

func (g dueGroup) expiryStr() string { return g.expiry.Format("2006-01-02") }

// num reads a field that holds a row id. JSON numbers arrive as float64 and a
// hand-edited row can hold the same value as a string, so both are accepted.
func (r record) num(key string) (int64, bool) {
	v, ok := r.Fields[key]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case int64:
		return t, true
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
		if err != nil {
			return 0, false
		}
		return n, true
	}
	return 0, false
}

// RunOnce scans the tables and reminds on everything that is due and unreminded.
func (s *Scheduler) RunOnce() error {
	tableID, ok := s.meta.ResolveTable(s.cfg.TableName)
	if !ok {
		return fmt.Errorf("table %q not found in MetaCache", s.cfg.TableName)
	}

	records, err := s.fetch(tableID)
	if err != nil {
		return fmt.Errorf("fetch records: %w", err)
	}

	// A missing or unreadable asset table is not an error: every invoice then
	// falls back to its own Expiry Date, which is what installs did before
	// products owned their dates.
	var assets []record
	assetTableID, hasAssets := s.meta.ResolveTable(s.cfg.AssetTableName)
	if hasAssets {
		assets, err = s.fetch(assetTableID)
		if err != nil {
			log.Printf("[REMINDERS WARN] Could not read %q (%v) - reminding on invoice dates only",
				s.cfg.AssetTableName, err)
			assets, hasAssets = nil, false
		}
	} else {
		log.Printf("[REMINDERS] %q not found - reminding on invoice dates only", s.cfg.AssetTableName)
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	due := selectDueGroups(records, assets, today, s.cfg.LeadDays)

	if len(due) == 0 {
		log.Printf("[REMINDERS] %d invoice(s) and %d product(s) scanned, none due",
			len(records), len(assets))
		return nil
	}

	recipients, err := s.admins()
	if err != nil {
		return fmt.Errorf("resolve recipients: %w", err)
	}
	if len(recipients) == 0 {
		return fmt.Errorf("no admin or super_admin users to notify")
	}

	log.Printf("[REMINDERS] %d invoice(s) and %d product(s) scanned, %d email(s) due, %d recipient(s), mode=%s",
		len(records), len(assets), len(due), len(recipients), s.cfg.Mode)

	for _, g := range due {
		days := daysBetween(today, g.expiry)

		if s.cfg.Mode == ModeDry {
			log.Printf("[REMINDERS DRY] would email %v about %q - %d product(s) expiring %s (%s)",
				recipients, g.parent.str("Title"), len(g.assets), g.expiryStr(), describeDays(days))
			continue
		}

		if err := s.send(recipients, g, days); err != nil {
			log.Printf("[REMINDERS ERROR] Invoice %d (%s): %v", g.parent.ID, g.parent.str("Title"), err)
			continue
		}
		// Stamped only after a successful send, so a failure retries tomorrow
		// rather than going silently unreported.
		stage := fmt.Sprintf("%d", s.cfg.LeadDays)
		if days < 0 {
			stage = "overdue"
		}
		when := today.Format("2006-01-02")

		if len(g.assets) > 0 {
			// The stamp lives on the products: they are what came due, and the
			// same invoice comes due again when its next term ends.
			ids := make([]int64, 0, len(g.assets))
			for _, a := range g.assets {
				ids = append(ids, a.ID)
			}
			if err := s.stampMany(assetTableID, ids, when, stage); err != nil {
				log.Printf("[REMINDERS ERROR] Sent for invoice %d but could not stamp its products: %v",
					g.parent.ID, err)
			}
		}
		// The invoice's own stamp records that it was mentioned at all, which is
		// what the detail page shows. It never gates a send.
		if err := s.stampMany(tableID, []int64{g.parent.ID}, when, stage); err != nil {
			log.Printf("[REMINDERS ERROR] Sent for invoice %d but could not stamp it: %v", g.parent.ID, err)
		}

		log.Printf("[REMINDERS] Reminded %d admin(s) about %d product(s) on %q (%s)",
			len(recipients), len(g.assets), g.parent.str("Title"), describeDays(days))
	}
	return nil
}

// selectDueGroups turns invoices and their products into the emails to send.
//
// Products are grouped by expiry date within their invoice, so one date is one
// email however many serials share it. A product already reminded, renewed or
// replaced drops out, and a group left with no products produces nothing. An
// invoice with no products at all falls back to selectDue's row-level rule.
func selectDueGroups(parents, assets []record, today time.Time, leadDays int) []dueGroup {
	byParent := map[int64][]record{}
	for _, a := range assets {
		if pid, ok := a.num("Warranty Id"); ok {
			byParent[pid] = append(byParent[pid], a)
		}
	}

	var out []dueGroup
	for _, p := range parents {
		mine := byParent[p.ID]
		if len(mine) == 0 {
			// No products on file - remind on the invoice, as before.
			if len(selectDue([]record{p}, today, leadDays)) == 1 {
				expiry, _ := time.Parse("2006-01-02", p.str("Expiry Date"))
				out = append(out, dueGroup{parent: p, expiry: expiry})
			}
			continue
		}

		byDate := map[string][]record{}
		for _, a := range mine {
			if a.str("Last Reminded") != "" {
				continue
			}
			if st := a.str("Status"); st == "Renewed" || st == "Replaced" {
				continue
			}
			end := a.str("End Date")
			expiry, err := time.Parse("2006-01-02", end)
			if err != nil {
				log.Printf("[REMINDERS WARN] Product %d has an unreadable end date %q - skipping",
					a.ID, end)
				continue
			}
			if daysBetween(today, expiry) > leadDays {
				continue
			}
			byDate[end] = append(byDate[end], a)
		}

		// Sorted so one invoice's emails go out soonest-expiry first, and so a
		// run is reproducible rather than following Go's map order.
		dates := make([]string, 0, len(byDate))
		for d := range byDate {
			dates = append(dates, d)
		}
		sort.Strings(dates)

		for _, d := range dates {
			expiry, _ := time.Parse("2006-01-02", d)
			out = append(out, dueGroup{parent: p, assets: byDate[d], expiry: expiry})
		}
	}
	return out
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

// stampMany marks rows as reminded. NocoDB v3 wants a bare array here — the
// {"records": [...]} envelope used elsewhere fails with RECORD_NOT_FOUND — and
// that array takes every row in the group in one request, so a part-stamped
// group cannot survive a mid-loop failure and re-send tomorrow.
func (s *Scheduler) stampMany(tableID string, ids []int64, when, stage string) error {
	if len(ids) == 0 {
		return nil
	}
	rows := make([]map[string]interface{}, 0, len(ids))
	for _, id := range ids {
		rows = append(rows, map[string]interface{}{
			"id": id,
			"fields": map[string]interface{}{
				"Last Reminded":  when,
				"Reminder Stage": stage,
			},
		})
	}
	body, _ := json.Marshal(rows)
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

func (s *Scheduler) send(to []string, g dueGroup, days int) error {
	if s.cfg.ResendKey == "" || s.cfg.From == "" {
		return fmt.Errorf("email not configured (RESEND_API_KEY / EMAIL_FROM)")
	}
	subject := fmt.Sprintf("Warranty %s — %s", describeDays(days), g.parent.str("Customer Name"))
	if n := len(g.assets); n > 0 {
		subject = fmt.Sprintf("%s (%d %s)", subject, n, plural(n, "product", "products"))
	}
	payload := map[string]interface{}{
		"from":    s.cfg.From,
		"to":      to,
		"subject": subject,
		"html":    s.body(g, days),
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

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func (s *Scheduler) body(g dueGroup, days int) string {
	rec := g.parent
	esc := func(key string) string { return html.EscapeString(rec.str(key)) }

	// Only the products in this group are listed. The rest of the invoice may
	// have years left on it, and naming those here would read as if the whole
	// invoice were lapsing.
	equipment := fmt.Sprintf("%s item(s)", esc("Asset Count"))
	detail := fmt.Sprintf(`<p style="color:#666;font-size:13px">%s</p>`, esc("Assets"))

	if n := len(g.assets); n > 0 {
		equipment = fmt.Sprintf("%d %s expiring on this date", n, plural(n, "product", "products"))

		var rows strings.Builder
		for _, a := range g.assets {
			serial := a.str("Serial Number")
			if serial == "" {
				serial = "<i>no serial recorded</i>"
			} else {
				serial = html.EscapeString(serial)
			}
			rows.WriteString(fmt.Sprintf(
				`<tr><td style="padding:4px 10px 4px 0">%s</td><td style="font-family:monospace">%s</td></tr>`,
				html.EscapeString(a.str("Model")), serial))
		}
		detail = fmt.Sprintf(
			`<h3 style="margin:18px 0 6px;font-size:14px">Products expiring on %s</h3>`+
				`<table cellpadding="0" style="border-collapse:collapse;font-size:13px">%s</table>`,
			html.EscapeString(g.expiryStr()), rows.String())

		// The invoice usually covers more than the group being reminded about.
		if total := rec.str("Asset Count"); total != "" && total != fmt.Sprint(n) {
			detail += fmt.Sprintf(
				`<p style="color:#888;font-size:12px">The other products on invoice %s are covered `+
					`for longer and are not part of this reminder.</p>`, esc("Invoice No"))
		}
	}

	// A computed date is the start date plus the recorded term; the real cover
	// can run months longer. Saying so stops a rep phoning too early and being
	// told the customer is still covered.
	computed := rec.str("Expiry Source") == "computed"
	if len(g.assets) > 0 {
		computed = false
		for _, a := range g.assets {
			if a.str("Expiry Source") == "computed" {
				computed = true
				break
			}
		}
	}
	sourceNote := ""
	if computed {
		sourceNote = `<p style="color:#8a6d3b;background:#fcf8e3;padding:10px;border-radius:4px">
			This date is calculated, not confirmed with the manufacturer. Actual cover may
			run several months longer — check the portal before quoting.</p>`
	}

	link := ""
	if s.cfg.AppURL != "" {
		link = fmt.Sprintf(
			`<p><a href="%s/warranty-detail?id=%d">Open this cover record</a> `+
				`to raise a renewal quote for these serials.</p>`,
			html.EscapeString(strings.TrimRight(s.cfg.AppURL, "/")), rec.ID)
	}

	return fmt.Sprintf(`<div style="font-family:system-ui,sans-serif;max-width:600px">
		<h2 style="margin-bottom:4px">%s</h2>
		<p style="color:#666;margin-top:0">%s</p>
		<table cellpadding="6" style="border-collapse:collapse">
			<tr><td><b>Expires</b></td><td>%s (%s)</td></tr>
			<tr><td><b>Customer</b></td><td>%s</td></tr>
			<tr><td><b>Location</b></td><td>%s</td></tr>
			<tr><td><b>Invoice</b></td><td>%s, dated %s</td></tr>
			<tr><td><b>Equipment</b></td><td>%s</td></tr>
		</table>
		%s
		%s%s</div>`,
		esc("Title"), describeDays(days),
		html.EscapeString(g.expiryStr()), describeDays(days),
		esc("Customer Name"), esc("Location"),
		esc("Invoice No"), esc("Invoice Date"),
		equipment,
		detail,
		sourceNote, link)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// SendTestTo renders the real reminder for one invoice and mails it to a single
// address. It deliberately does NOT stamp "Last Reminded", so using it cannot
// consume a product's one real reminder, and it ignores Mode so a dry-run
// install can still be tested.
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

	var assets []record
	if assetTableID, ok := s.meta.ResolveTable(s.cfg.AssetTableName); ok {
		if assets, err = s.fetch(assetTableID); err != nil {
			assets = nil
		}
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	groups := selectDueGroups(records, assets, today, s.cfg.LeadDays)

	// Soonest expiry first, so the preview does not depend on the order NocoDB
	// happens to return rows in.
	sort.Slice(groups, func(i, j int) bool { return groups[i].expiry.Before(groups[j].expiry) })

	var chosen *dueGroup
	if recordID > 0 {
		for i := range groups {
			if groups[i].parent.ID == recordID {
				chosen = &groups[i]
				break
			}
		}
		if chosen == nil {
			// Nothing on that invoice is due, so build the group by hand from its
			// soonest products — a preview must work on any row, not only due ones.
			g, err := previewGroup(records, assets, recordID)
			if err != nil {
				return "", err
			}
			chosen = &g
		}
	} else if len(groups) > 0 {
		chosen = &groups[0]
	} else {
		g, err := previewGroup(records, assets, records[0].ID)
		if err != nil {
			return "", err
		}
		chosen = &g
	}

	if err := s.send([]string{to}, *chosen, daysBetween(today, chosen.expiry)); err != nil {
		return "", err
	}
	return chosen.parent.str("Title"), nil
}

// previewGroup builds the email an invoice would produce next, ignoring whether
// it is actually due. Used only by the test button.
func previewGroup(records, assets []record, recordID int64) (dueGroup, error) {
	var parent *record
	for i := range records {
		if records[i].ID == recordID {
			parent = &records[i]
			break
		}
	}
	if parent == nil {
		return dueGroup{}, fmt.Errorf("row %d not found", recordID)
	}

	// The soonest end date still in force is what the invoice expires on next.
	soonest := ""
	var mine []record
	for _, a := range assets {
		if pid, ok := a.num("Warranty Id"); !ok || pid != recordID {
			continue
		}
		if st := a.str("Status"); st == "Renewed" || st == "Replaced" {
			continue
		}
		end := a.str("End Date")
		if end == "" {
			continue
		}
		if soonest == "" || end < soonest {
			soonest = end
		}
		mine = append(mine, a)
	}

	if soonest != "" {
		var group []record
		for _, a := range mine {
			if a.str("End Date") == soonest {
				group = append(group, a)
			}
		}
		expiry, err := time.Parse("2006-01-02", soonest)
		if err != nil {
			return dueGroup{}, fmt.Errorf("row %d has an unreadable end date %q", recordID, soonest)
		}
		return dueGroup{parent: *parent, assets: group, expiry: expiry}, nil
	}

	expiry, err := time.Parse("2006-01-02", parent.str("Expiry Date"))
	if err != nil {
		return dueGroup{}, fmt.Errorf("row %d has an unreadable expiry date %q",
			recordID, parent.str("Expiry Date"))
	}
	return dueGroup{parent: *parent, expiry: expiry}, nil
}
