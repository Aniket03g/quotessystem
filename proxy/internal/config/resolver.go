package config

import (
	"fmt"
	"log"
)

// MetaCacheInterface defines the interface for resolving table/field names to IDs
type MetaCacheInterface interface {
	ResolveTable(name string) (string, bool)
	ResolveField(tableID, fieldName string) (string, bool)
}

// Resolver resolves human-readable names to NocoDB IDs using MetaCache
type Resolver struct {
	metaCache MetaCacheInterface
}

// NewResolver creates a new resolver with the given MetaCache
func NewResolver(metaCache MetaCacheInterface) *Resolver {
	return &Resolver{
		metaCache: metaCache,
	}
}

// Resolve takes a ProxyConfig and resolves all names to IDs
func (r *Resolver) Resolve(config *ProxyConfig) (*ResolvedConfig, error) {
	log.Printf("[RESOLVER] Starting resolution of proxy configuration...")

	resolved := &ResolvedConfig{
		BaseID: config.NocoDB.BaseID,
		Tables: make(map[string]ResolvedTable),
	}

	for tableKey, tableConfig := range config.Tables {
		log.Printf("[RESOLVER] Resolving table: %s (name: %s)", tableKey, tableConfig.Name)

		tableID, ok := r.metaCache.ResolveTable(tableConfig.Name)
		if !ok {
			return nil, fmt.Errorf("failed to resolve table '%s' to ID", tableConfig.Name)
		}

		log.Printf("[RESOLVER] Resolved table '%s' -> '%s'", tableConfig.Name, tableID)

		resolvedTable := ResolvedTable{
			Name:       tableConfig.Name,
			TableID:    tableID,
			Operations: tableConfig.Operations,
			Fields:     make(map[string]string),
			Links:      make(map[string]ResolvedLink),
		}

		// Resolve field names to IDs
		for fieldName, fieldAlias := range tableConfig.Fields {
			fieldID, ok := r.metaCache.ResolveField(tableID, fieldName)
			if !ok {
				log.Printf("[RESOLVER WARN] Failed to resolve field '%s' in table '%s', using as-is", fieldName, tableConfig.Name)
				fieldID = fieldName
			} else {
				log.Printf("[RESOLVER] Resolved field '%s' -> '%s'", fieldName, fieldID)
			}
			resolvedTable.Fields[fieldAlias] = fieldID
		}

		// Resolve link field names to IDs
		for linkName, link := range tableConfig.Links {
			fieldID, ok := r.metaCache.ResolveField(tableID, link.Field)
			if !ok {
				log.Printf("[RESOLVER WARN] Failed to resolve link field '%s' in table '%s', using as-is", link.Field, tableConfig.Name)
				fieldID = link.Field
			} else {
				log.Printf("[RESOLVER] Resolved link field '%s' -> '%s'", link.Field, fieldID)
			}

			resolvedTable.Links[linkName] = ResolvedLink{
				FieldID:     fieldID,
				TargetTable: link.TargetTable,
			}
		}

		resolved.Tables[tableKey] = resolvedTable
	}

	log.Printf("[RESOLVER] Successfully resolved %d tables", len(resolved.Tables))
	return resolved, nil
}
