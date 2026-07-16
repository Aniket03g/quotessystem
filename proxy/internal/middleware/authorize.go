package middleware

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/grove/generic-proxy/internal/db"
)

// OwnerRule describes the row-ownership policy for a single table.
type OwnerRule struct {
	// Fields are the owner column(s); a non-admin sees a row if any equals their email.
	Fields []string
	// PublicReadFields may be read across all rows, but only when a list read is
	// restricted to these fields (bypasses ownership for non-sensitive columns).
	PublicReadFields []string
}

// AuthorizeMiddleware applies server-side row-level ownership filtering for
// non-admin users. It is the SOLE authority for "you can only see your own
// records" — the frontend no longer sends owner filters.
//
// For a table declared with owner_fields in proxy.yaml, a list read
// (GET /proxy/<table>/records) by a non-admin user has a `where` clause
// injected constraining rows to those the caller owns (owner column == caller
// email, OR-combined across multiple owner fields). Admins and super admins
// bypass filtering entirely. A list read restricted to a table's
// public_read_fields is allowed unscoped (e.g. quote-number sequencing).
//
// NOTE: this covers list reads on /records only. By-id reads/writes and NocoDB
// link endpoints are not filtered here (they carry no `where`); those are a
// separate, follow-up enforcement step.
func AuthorizeMiddleware(rules map[string]OwnerRule, database *db.Database, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, _ := r.Context().Value(RoleKey).(string)

		// Admins and super admins see everything — no row-level filtering.
		if role == "admin" || role == "super_admin" {
			next.ServeHTTP(w, r)
			return
		}

		// Identify the table from the first path segment after /proxy/.
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/proxy/"), "/")
		segments := strings.Split(path, "/")
		if len(segments) == 0 || segments[0] == "" {
			next.ServeHTTP(w, r)
			return
		}
		tableKey := segments[0]

		rule, ok := rules[tableKey]
		if !ok || len(rule.Fields) == 0 {
			// Table has no ownership rule — unrestricted.
			next.ServeHTTP(w, r)
			return
		}

		// Only list reads (GET /<table>/records) can be constrained with a
		// `where` clause. Everything else passes through untouched here.
		isListRead := r.Method == http.MethodGet && len(segments) == 2 && segments[1] == "records"
		if !isListRead {
			next.ServeHTTP(w, r)
			return
		}

		// Public-field exemption: a read restricted to non-sensitive columns is
		// allowed across all rows (needed for global operations like numbering).
		if fieldsRestrictedTo(r, rule.PublicReadFields) {
			log.Printf("[AUTHORIZE] Allowing unscoped public-field read on %s (fields=%s)", tableKey, r.URL.Query().Get("fields"))
			next.ServeHTTP(w, r)
			return
		}

		fields := rule.Fields

		// Resolve the caller's email. Prefer the JWT claim; fall back to a DB
		// lookup by user id so sessions issued before email was added to the
		// token keep working without a forced re-login.
		email, _ := r.Context().Value(EmailKey).(string)
		if email == "" {
			if userID, ok := r.Context().Value(UserIDKey).(string); ok && database != nil {
				if id, err := strconv.ParseInt(userID, 10, 64); err == nil {
					if u, err := database.GetUserByID(id); err == nil && u != nil {
						email = u.Email
					}
				}
			}
		}
		if email == "" {
			// Fail closed: without an identity we cannot scope the query, so we
			// must not return the full table to the caller.
			log.Printf("[AUTHORIZE] Denying %s %s: no email identity for non-admin user", r.Method, r.URL.Path)
			respondWithError(w, http.StatusForbidden, "unable to determine user identity for row-level access; please log in again")
			return
		}

		ownerClause := buildOwnerClause(fields, email)
		injectWhere(r, ownerClause)
		log.Printf("[AUTHORIZE] Scoped %s %s to owner=%s (fields=%v)", r.Method, tableKey, email, fields)

		next.ServeHTTP(w, r)
	})
}

// fieldsRestrictedTo reports whether the request's `fields` param is present and
// every field it names is in allowed. Absent/empty fields (which would return
// all columns) returns false, as does any field outside the allowed set.
func fieldsRestrictedTo(r *http.Request, allowed []string) bool {
	if len(allowed) == 0 {
		return false
	}
	raw := strings.TrimSpace(r.URL.Query().Get("fields"))
	if raw == "" {
		return false
	}
	allowedSet := make(map[string]bool, len(allowed))
	for _, a := range allowed {
		allowedSet[strings.TrimSpace(a)] = true
	}
	for _, f := range strings.Split(raw, ",") {
		if !allowedSet[strings.TrimSpace(f)] {
			return false
		}
	}
	return true
}

// buildOwnerClause builds a NocoDB `where` expression (unencoded) restricting
// rows to those owned by email. A single field yields (Field,eq,email); multiple
// fields are OR-combined and wrapped for safe grouping.
func buildOwnerClause(fields []string, email string) string {
	if len(fields) == 1 {
		return fmt.Sprintf("(%s,eq,%s)", fields[0], email)
	}
	subs := make([]string, len(fields))
	for i, f := range fields {
		subs[i] = fmt.Sprintf("(%s,eq,%s)", f, email)
	}
	return "(" + strings.Join(subs, "~or") + ")"
}

// injectWhere sets/merges the `where` query param on the request, preserving the
// exact encoding style used elsewhere (literal parens/operators, percent-encoded
// spaces/commas/@) so it composes identically to the frontend-issued clauses that
// NocoDB already accepts. Any pre-existing `where` is AND-combined.
func injectWhere(r *http.Request, ownerClause string) {
	ownerEncoded := encodeURIComponent(ownerClause)

	existing := getRawParam(r.URL.RawQuery, "where")
	var whereEncoded string
	if existing != "" {
		whereEncoded = ownerEncoded + "~and(" + existing + ")"
	} else {
		whereEncoded = ownerEncoded
	}
	r.URL.RawQuery = setRawParam(r.URL.RawQuery, "where", whereEncoded)
}

// getRawParam returns the raw (still-encoded) value of key from a raw query
// string, or "" if absent.
func getRawParam(rawQuery, key string) string {
	prefix := key + "="
	for _, p := range strings.Split(rawQuery, "&") {
		if strings.HasPrefix(p, prefix) {
			return strings.TrimPrefix(p, prefix)
		}
	}
	return ""
}

// setRawParam replaces key's value in a raw query string, or appends it, leaving
// all other params byte-for-byte untouched.
func setRawParam(rawQuery, key, encodedValue string) string {
	prefix := key + "="
	replacement := prefix + encodedValue
	var parts []string
	found := false
	if rawQuery != "" {
		for _, p := range strings.Split(rawQuery, "&") {
			if strings.HasPrefix(p, prefix) {
				parts = append(parts, replacement)
				found = true
			} else {
				parts = append(parts, p)
			}
		}
	}
	if !found {
		parts = append(parts, replacement)
	}
	return strings.Join(parts, "&")
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent: it leaves
// A-Za-z0-9 and -_.!~*'() unescaped and percent-encodes everything else
// (including spaces, commas and @). This matches how the frontend encodes its
// NocoDB where clauses, which NocoDB accepts.
func encodeURIComponent(s string) string {
	const safe = "-_.!~*'()"
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || strings.IndexByte(safe, c) >= 0 {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}
