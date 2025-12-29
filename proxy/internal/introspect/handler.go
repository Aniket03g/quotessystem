package introspect

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/grove/generic-proxy/internal/config"
	"github.com/grove/generic-proxy/internal/proxy"
)

// Handler provides runtime introspection endpoints
type Handler struct {
	metaCache       *proxy.MetaCache
	resolvedConfig  *config.ResolvedConfig
	proxyConfigPath string
	mode            string
}

// NewHandler creates a new introspection handler
func NewHandler(metaCache *proxy.MetaCache, resolvedConfig *config.ResolvedConfig, proxyConfigPath string) *Handler {
	mode := "legacy"
	if resolvedConfig != nil {
		mode = "schema-driven"
	}

	return &Handler{
		metaCache:       metaCache,
		resolvedConfig:  resolvedConfig,
		proxyConfigPath: proxyConfigPath,
		mode:            mode,
	}
}

// SchemaResponse represents the schema introspection response
type SchemaResponse struct {
	Mode           string               `json:"mode"`
	ConfigPath     string               `json:"config_path,omitempty"`
	Tables         map[string]TableInfo `json:"tables"`
	MetaCacheReady bool                 `json:"metacache_ready"`
	LastRefresh    string               `json:"last_refresh,omitempty"`
}

// TableInfo contains resolved table information
type TableInfo struct {
	LogicalName string              `json:"logical_name"`
	TableID     string              `json:"table_id"`
	Operations  []string            `json:"operations,omitempty"`
	Fields      map[string]string   `json:"fields,omitempty"`
	Links       map[string]LinkInfo `json:"links,omitempty"`
}

// LinkInfo contains resolved link information
type LinkInfo struct {
	FieldID     string `json:"field_id"`
	TargetTable string `json:"target_table"`
}

// StatusResponse represents the status endpoint response
type StatusResponse struct {
	MetaCacheReady bool   `json:"metacache_ready"`
	SchemaResolved bool   `json:"schema_resolved"`
	TablesResolved int    `json:"tables_resolved"`
	LastRefresh    string `json:"last_refresh,omitempty"`
	Mode           string `json:"mode"`
}

// ServeSchema handles GET /__proxy/schema
func (h *Handler) ServeSchema(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	log.Printf("[INTROSPECT] Schema introspection request from %s", r.RemoteAddr)

	response := SchemaResponse{
		Mode:           h.mode,
		ConfigPath:     h.proxyConfigPath,
		Tables:         make(map[string]TableInfo),
		MetaCacheReady: h.metaCache != nil && h.metaCache.IsReady(),
	}

	if h.metaCache != nil && h.metaCache.IsReady() {
		lastRefresh := h.metaCache.GetLastRefreshTime()
		if !lastRefresh.IsZero() {
			response.LastRefresh = lastRefresh.Format(time.RFC3339)
		}
	}

	// If schema-driven mode, include resolved configuration
	if h.resolvedConfig != nil {
		for tableKey, table := range h.resolvedConfig.Tables {
			tableInfo := TableInfo{
				LogicalName: table.Name,
				TableID:     table.TableID,
				Operations:  table.Operations,
				Fields:      make(map[string]string),
				Links:       make(map[string]LinkInfo),
			}

			// Add field mappings
			for fieldAlias, fieldID := range table.Fields {
				tableInfo.Fields[fieldAlias] = fieldID
			}

			// Add link mappings
			for linkName, link := range table.Links {
				tableInfo.Links[linkName] = LinkInfo{
					FieldID:     link.FieldID,
					TargetTable: link.TargetTable,
				}
			}

			response.Tables[tableKey] = tableInfo
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("[INTROSPECT ERROR] Failed to encode schema response: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	log.Printf("[INTROSPECT] Schema introspection completed: mode=%s, tables=%d", h.mode, len(response.Tables))
}

// ServeStatus handles GET /__proxy/status
func (h *Handler) ServeStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := StatusResponse{
		MetaCacheReady: h.metaCache != nil && h.metaCache.IsReady(),
		SchemaResolved: h.resolvedConfig != nil,
		TablesResolved: 0,
		Mode:           h.mode,
	}

	if h.resolvedConfig != nil {
		response.TablesResolved = len(h.resolvedConfig.Tables)
	}

	if h.metaCache != nil && h.metaCache.IsReady() {
		lastRefresh := h.metaCache.GetLastRefreshTime()
		if !lastRefresh.IsZero() {
			response.LastRefresh = lastRefresh.Format(time.RFC3339)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("[INTROSPECT ERROR] Failed to encode status response: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
}
