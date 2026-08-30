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
