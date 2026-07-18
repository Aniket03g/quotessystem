package middleware

import (
	"net/http/httptest"
	"testing"
)

func TestFieldsRestrictedTo(t *testing.T) {
	pub := []string{"Quote Number"}
	// Exempt: read restricted to the public field only.
	r := httptest.NewRequest("GET", "/proxy/quotes/records?where=(Quote%20Number,like,GR%25)&fields=Quote%20Number", nil)
	if !fieldsRestrictedTo(r, pub) {
		t.Error("expected exemption for fields=Quote Number")
	}
	// Not exempt: no fields param (would return all columns).
	r = httptest.NewRequest("GET", "/proxy/quotes/records", nil)
	if fieldsRestrictedTo(r, pub) {
		t.Error("expected no exemption when fields absent")
	}
	// Not exempt: requests a non-public field alongside.
	r = httptest.NewRequest("GET", "/proxy/quotes/records?fields=Quote%20Number,Total%20Amount", nil)
	if fieldsRestrictedTo(r, pub) {
		t.Error("expected no exemption when a non-public field is requested")
	}
}

func TestBuildOwnerClause(t *testing.T) {
	// Single field, single (self) email.
	if got := buildOwnerClause([]string{"Handled By"}, []string{"j@co.com"}); got != "(Handled By,eq,j@co.com)" {
		t.Errorf("single: got %q", got)
	}
	// Two owner fields (leads), single email.
	want := "((Lead Created By,eq,j@co.com)~or(Assigned to,eq,j@co.com))"
	if got := buildOwnerClause([]string{"Lead Created By", "Assigned to"}, []string{"j@co.com"}); got != want {
		t.Errorf("multi-field: got %q want %q", got, want)
	}
	// Manager: one owner field, a team of three emails.
	wantTeam := "((Handled By,eq,j@co.com)~or(Handled By,eq,x@co.com)~or(Handled By,eq,y@co.com))"
	if got := buildOwnerClause([]string{"Handled By"}, []string{"j@co.com", "x@co.com", "y@co.com"}); got != wantTeam {
		t.Errorf("team: got %q want %q", got, wantTeam)
	}
}

func TestEncodeURIComponent(t *testing.T) {
	// Matches JS encodeURIComponent: parens and ~ literal; space/comma/@ encoded.
	got := encodeURIComponent("(Handled By,eq,a@b.com)")
	want := "(Handled%20By%2Ceq%2Ca%40b.com)"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestInjectWhere_NoExisting(t *testing.T) {
	r := httptest.NewRequest("GET", "/proxy/accounts_duplicate/records?limit=50", nil)
	injectWhere(r, "(Handled By,eq,a@b.com)")
	// limit must be preserved; where added.
	if got := getRawParam(r.URL.RawQuery, "where"); got != "(Handled%20By%2Ceq%2Ca%40b.com)" {
		t.Errorf("where = %q", got)
	}
	if got := getRawParam(r.URL.RawQuery, "limit"); got != "50" {
		t.Errorf("limit not preserved: %q", got)
	}
}

func TestInjectWhere_ComposesWithExisting(t *testing.T) {
	// Mimics the create-quote account search: an existing name filter must be
	// AND-combined with the injected owner clause, other params untouched.
	r := httptest.NewRequest("GET", "/proxy/accounts_duplicate/records?where=(Company%20Name,like,acme)&limit=50", nil)
	injectWhere(r, "(Handled By,eq,a@b.com)")
	want := "(Handled%20By%2Ceq%2Ca%40b.com)~and((Company%20Name,like,acme))"
	if got := getRawParam(r.URL.RawQuery, "where"); got != want {
		t.Errorf("composed where:\n got %q\nwant %q", got, want)
	}
	if got := getRawParam(r.URL.RawQuery, "limit"); got != "50" {
		t.Errorf("limit not preserved: %q", got)
	}
}
