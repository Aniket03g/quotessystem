package db

import (
	"path/filepath"
	"sort"
	"testing"
)

func TestNotificationReadsRoundTrip(t *testing.T) {
	d, err := NewDatabase(filepath.Join(t.TempDir(), "n.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	if err := d.SetNotificationsRead("a@x.com", []string{"lead:1:2026-09-30", "cover:3:2026-11-01"}, true); err != nil {
		t.Fatal(err)
	}
	// Marking twice is harmless.
	if err := d.SetNotificationsRead("a@x.com", []string{"lead:1:2026-09-30"}, true); err != nil {
		t.Fatal(err)
	}
	if err := d.SetNotificationsRead("a@x.com", []string{"cover:3:2026-11-01"}, false); err != nil {
		t.Fatal(err)
	}

	keys, _ := d.GetNotificationReads("a@x.com")
	sort.Strings(keys)
	if len(keys) != 1 || keys[0] != "lead:1:2026-09-30" {
		t.Fatalf("a@x.com keys = %v", keys)
	}
	// Marks are per user.
	if keys, _ := d.GetNotificationReads("b@x.com"); len(keys) != 0 {
		t.Fatalf("b@x.com sees %v", keys)
	}
}
