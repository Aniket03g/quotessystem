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
