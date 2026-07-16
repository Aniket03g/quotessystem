package config

// ProxyConfig represents the complete schema-driven configuration
type ProxyConfig struct {
	NocoDB NocoDBConfig           `yaml:"nocodb"`
	Tables map[string]TableConfig `yaml:"tables"`
}

// NocoDBConfig holds NocoDB connection details
type NocoDBConfig struct {
	BaseID string `yaml:"base_id"`
}

// TableConfig defines configuration for a single table
type TableConfig struct {
	Name       string            `yaml:"name"`
	Operations []string          `yaml:"operations"`
	Fields     map[string]string `yaml:"fields,omitempty"`
	Links      map[string]Link   `yaml:"links,omitempty"`
	// OwnerFields lists the column name(s) that identify the "owner" of a row.
	// When set, non-admin users are restricted (server-side) to rows where at
	// least one of these columns equals the caller's email. Multiple fields are
	// combined with OR (e.g. a lead is visible if you created it OR it's assigned
	// to you). Tables without owner_fields are unrestricted.
	OwnerFields []string `yaml:"owner_fields,omitempty"`
	// PublicReadFields lists non-sensitive column(s) that any authenticated user
	// may read across all rows (bypassing owner_fields) — but ONLY when the read
	// is restricted to these fields (via ?fields=). Used for system needs like
	// quote-number sequencing, which must count rows globally while exposing no
	// owner-sensitive data.
	PublicReadFields []string `yaml:"public_read_fields,omitempty"`
}

// Link defines a relationship between tables
type Link struct {
	Field       string `yaml:"field"`
	TargetTable string `yaml:"target_table"`
}

// ResolvedConfig contains runtime-resolved IDs from MetaCache
type ResolvedConfig struct {
	BaseID string
	Tables map[string]ResolvedTable
}

// ResolvedTable contains resolved IDs for a table
type ResolvedTable struct {
	Name       string
	TableID    string
	Operations []string
	Fields     map[string]string // field name -> field ID
	Links      map[string]ResolvedLink
}

// ResolvedLink contains resolved IDs for a link
type ResolvedLink struct {
	FieldID     string
	TargetTable string
}
