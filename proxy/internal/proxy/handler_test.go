package proxy

import "testing"

func TestIsRecordsListPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/proxy/accounts_duplicate/records", true},
		{"/proxy/contacts/records", true},
		{"/proxy/quotes/records/", true},
		// By-id reads carry a third segment and must keep NocoDB's own behaviour.
		{"/proxy/quotes/records/42", false},
		// Link endpoints page differently and are left alone.
		{"/proxy/quotes/links/products/42", false},
		{"/proxy/quotes", false},
		{"/proxy/", false},
	}
	for _, c := range cases {
		if got := isRecordsListPath(c.path); got != c.want {
			t.Errorf("isRecordsListPath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

func TestGetRawQueryParam(t *testing.T) {
	cases := []struct {
		raw, key, want string
	}{
		{"limit=50", "limit", "50"},
		{"where=(a,eq,b)&limit=50", "limit", "50"},
		{"where=(a,eq,b)", "limit", ""},
		{"", "limit", ""},
		// Must not match a param that merely ends with the key's name.
		{"pageLimit=50", "limit", ""},
		// Encoded values are returned untouched, not decoded.
		{"where=%28Handled%20By%2Ceq%2Ca%40b.com%29", "where", "%28Handled%20By%2Ceq%2Ca%40b.com%29"},
	}
	for _, c := range cases {
		if got := getRawQueryParam(c.raw, c.key); got != c.want {
			t.Errorf("getRawQueryParam(%q, %q) = %q, want %q", c.raw, c.key, got, c.want)
		}
	}
}
