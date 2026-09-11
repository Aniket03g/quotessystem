package reminders

import (
	"encoding/json"
	"testing"
	"time"
)

func mk(id int64, expiry, lastReminded, status string) record {
	return record{ID: id, Fields: map[string]interface{}{
		"Expiry Date":   expiry,
		"Last Reminded": lastReminded,
		"Status":        status,
	}}
}

func TestSelectDue(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		rec  record
		want bool
	}{
		{"inside the window", mk(1, "2026-09-18", "", "Active"), true},
		{"exactly at the lead day", mk(2, "2026-10-26", "", "Active"), true},
		{"one day beyond the window", mk(3, "2026-10-27", "", "Active"), false},
		{"far in the future", mk(4, "2028-07-21", "", "Active"), false},
		// A warranty that lapsed before the scheduler existed still deserves
		// one chase, so negative days must not be filtered out.
		{"already lapsed", mk(5, "2026-02-12", "", "Active"), true},
		{"already reminded", mk(6, "2026-09-18", "2026-08-01", "Active"), false},
		{"renewal already landed", mk(7, "2026-09-18", "", "Renewed"), false},
		{"unreadable date", mk(8, "not-a-date", "", "Active"), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := len(selectDue([]record{tc.rec}, today, 60)) == 1
			if got != tc.want {
				t.Fatalf("selectDue picked=%v, want %v (expiry %q)",
					got, tc.want, tc.rec.str("Expiry Date"))
			}
		})
	}
}

// The backfilled sheet data, as the v3 API returns it. Guards the two rows that
// matter most: Uchiyama and Honda are inside the window on the go-live date and
// must not be missed, while the rest of the book must stay quiet.
func TestSelectDueAgainstBackfill(t *testing.T) {
	const payload = `{"records":[
	{"id":1,"fields":{"Title":"UBE Machinery","Expiry Date":"2026-02-12","Status":"Active"}},
	{"id":2,"fields":{"Title":"Uchiyama","Expiry Date":"2026-09-12","Status":"Active"}},
	{"id":3,"fields":{"Title":"Honda India Power","Expiry Date":"2026-09-18","Status":"Active"}},
	{"id":4,"fields":{"Title":"UBE Machinery","Expiry Date":"2026-12-29","Status":"Active"}},
	{"id":5,"fields":{"Title":"FMI Automotive","Expiry Date":"2027-01-31","Status":"Active"}},
	{"id":6,"fields":{"Title":"Sojitz","Expiry Date":"2027-02-13","Status":"Active"}},
	{"id":7,"fields":{"Title":"Marubeni","Expiry Date":"2027-10-16","Status":"Active"}},
	{"id":8,"fields":{"Title":"Itochu","Expiry Date":"2028-07-21","Status":"Active"}}]}`

	var parsed struct {
		Records []record `json:"records"`
	}
	if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(parsed.Records) != 8 {
		t.Fatalf("decoded %d records, want 8", len(parsed.Records))
	}

	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	due := selectDue(parsed.Records, today, 60)

	want := map[int64]bool{1: true, 2: true, 3: true}
	if len(due) != len(want) {
		for _, d := range due {
			t.Logf("due: id=%d %s %s", d.ID, d.str("Title"), d.str("Expiry Date"))
		}
		t.Fatalf("got %d due rows, want %d", len(due), len(want))
	}
	for _, d := range due {
		if !want[d.ID] {
			t.Errorf("row %d (%s, %s) should not be due", d.ID, d.str("Title"), d.str("Expiry Date"))
		}
	}
}

// asset builds a product row on invoice `parent`.
func asset(id, parent int64, model, serial, end, lastReminded, status string) record {
	return record{ID: id, Fields: map[string]interface{}{
		"Warranty Id":   float64(parent), // JSON numbers arrive as float64
		"Model":         model,
		"Serial Number": serial,
		"End Date":      end,
		"Last Reminded": lastReminded,
		"Status":        status,
	}}
}

// The point of the whole per-product model: one invoice, three warranty terms,
// three separate reminders — and serials sharing a date reminded together.
func TestSelectDueGroupsSplitsByExpiryDate(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	parent := mk(1, "2026-09-18", "", "Active")

	assets := []record{
		asset(10, 1, "UVC86", "SN1", "2026-09-18", "", "Active"),
		asset(11, 1, "UVC86", "SN2", "2026-09-18", "", "Active"),
		asset(12, 1, "WPP30", "SN3", "2026-10-20", "", "Active"),
		// Five years out — nowhere near the 60-day window.
		asset(13, 1, "A30-010", "SN4", "2030-09-18", "", "Active"),
	}

	got := selectDueGroups([]record{parent}, assets, today, 60)
	if len(got) != 2 {
		t.Fatalf("got %d group(s), want 2", len(got))
	}
	if len(got[0].assets) != 2 || got[0].expiryStr() != "2026-09-18" {
		t.Fatalf("first group = %d asset(s) expiring %s, want 2 expiring 2026-09-18",
			len(got[0].assets), got[0].expiryStr())
	}
	if len(got[1].assets) != 1 || got[1].expiryStr() != "2026-10-20" {
		t.Fatalf("second group = %d asset(s) expiring %s, want 1 expiring 2026-10-20",
			len(got[1].assets), got[1].expiryStr())
	}
}

func TestSelectDueGroupsSkipsSettledProducts(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	parent := mk(1, "2026-09-18", "", "Active")

	cases := []struct {
		name  string
		asset record
		want  int
	}{
		{"due and untouched", asset(10, 1, "UVC86", "SN1", "2026-09-18", "", "Active"), 1},
		{"already reminded", asset(10, 1, "UVC86", "SN1", "2026-09-18", "2026-08-01", "Active"), 0},
		{"renewed", asset(10, 1, "UVC86", "SN1", "2026-09-18", "", "Renewed"), 0},
		// A replaced unit's old end date must not hold the invoice in the window.
		{"replaced", asset(10, 1, "UVC86", "SN1", "2026-09-18", "", "Replaced"), 0},
		{"unreadable end date", asset(10, 1, "UVC86", "SN1", "soon", "", "Active"), 0},
		{"beyond the window", asset(10, 1, "UVC86", "SN1", "2027-09-18", "", "Active"), 0},
		// Lapsed before the scheduler existed — still worth one chase.
		{"already lapsed", asset(10, 1, "UVC86", "SN1", "2026-02-12", "", "Active"), 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := selectDueGroups([]record{parent}, []record{tc.asset}, today, 60)
			if len(got) != tc.want {
				t.Fatalf("got %d group(s), want %d", len(got), tc.want)
			}
		})
	}
}

// An invoice whose parent row is due but which has no product rows must still
// produce its reminder — that is every install where Warranty Assets does not
// exist yet, and going silent there would lose real renewals.
func TestSelectDueGroupsFallsBackToTheInvoice(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	parent := mk(1, "2026-09-18", "", "Active")

	got := selectDueGroups([]record{parent}, nil, today, 60)
	if len(got) != 1 {
		t.Fatalf("got %d group(s), want 1", len(got))
	}
	if len(got[0].assets) != 0 {
		t.Fatalf("fallback group carried %d asset(s), want 0", len(got[0].assets))
	}
	if got[0].expiryStr() != "2026-09-18" {
		t.Fatalf("fallback expiry = %s, want 2026-09-18", got[0].expiryStr())
	}
}

// Products belong to the invoice named by "Warranty Id" and to no other, so a
// second invoice's rows can never be pulled into the wrong email.
func TestSelectDueGroupsKeepsInvoicesApart(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	parents := []record{mk(1, "2026-09-18", "", "Active"), mk(2, "2026-09-18", "", "Active")}
	assets := []record{
		asset(10, 1, "UVC86", "SN1", "2026-09-18", "", "Active"),
		asset(11, 2, "WPP30", "SN2", "2026-09-18", "", "Active"),
	}

	got := selectDueGroups(parents, assets, today, 60)
	if len(got) != 2 {
		t.Fatalf("got %d group(s), want 2", len(got))
	}
	for _, g := range got {
		if len(g.assets) != 1 {
			t.Fatalf("invoice %d got %d asset(s), want 1", g.parent.ID, len(g.assets))
		}
		if pid, _ := g.assets[0].num("Warranty Id"); pid != g.parent.ID {
			t.Fatalf("invoice %d was given a product belonging to %d", g.parent.ID, pid)
		}
	}
}

// A parent row that has already been stamped must not silence its products: the
// stamp records the last email about the invoice, and the invoice's next term
// still has to be chased.
func TestSelectDueGroupsIgnoresTheParentStamp(t *testing.T) {
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	parent := mk(1, "2026-09-18", "2026-08-01", "Active")
	assets := []record{asset(10, 1, "WPP30", "SN1", "2026-09-18", "", "Active")}

	if got := selectDueGroups([]record{parent}, assets, today, 60); len(got) != 1 {
		t.Fatalf("got %d group(s), want 1", len(got))
	}
}

func TestParseMode(t *testing.T) {
	for input, want := range map[string]Mode{
		"on": ModeOn, "ON": ModeOn, "true": ModeOn, "1": ModeOn,
		"off": ModeOff, "disabled": ModeOff,
		"": ModeDry, "dry": ModeDry, "nonsense": ModeDry,
	} {
		if got := ParseMode(input); got != want {
			t.Errorf("ParseMode(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDescribeDays(t *testing.T) {
	if got := describeDays(22); got != "expires in 22 days" {
		t.Errorf("got %q", got)
	}
	if got := describeDays(-196); got != "expired 196 days ago" {
		t.Errorf("got %q", got)
	}
}

func TestRecordsURL(t *testing.T) {
	s := New(Config{
		NocoDBURL: "http://host:8090/api/v3/data/",
		BaseID:    "pd0tf8xobxcryk6",
	}, nil, nil)
	want := "http://host:8090/api/v3/data/pd0tf8xobxcryk6/tbl123/records"
	if got := s.recordsURL("tbl123"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
