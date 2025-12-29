package proxy

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/grove/generic-proxy/internal/config"
)

// Validator validates requests against the resolved configuration
type Validator struct {
	config    *config.ResolvedConfig
	metaCache *MetaCache
}

// NewValidator creates a new validator with the given resolved configuration
func NewValidator(config *config.ResolvedConfig, metaCache *MetaCache) *Validator {
	return &Validator{
		config:    config,
		metaCache: metaCache,
	}
}

// ValidateRequest validates an incoming proxy request
func (v *Validator) ValidateRequest(method, path string) (*ValidationResult, error) {
	log.Printf("[VALIDATOR] Validating request: %s %s", method, path)

	// Parse the path to extract table identifier and operation
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 {
		return nil, fmt.Errorf("invalid path: empty")
	}

	tableKey := parts[0]
	log.Printf("[VALIDATOR] Table key: %s", tableKey)

	// Find the table in resolved config
	table, ok := v.config.Tables[tableKey]
	if !ok {
		return nil, fmt.Errorf("table '%s' not found in configuration", tableKey)
	}

	// Determine the operation from HTTP method and path
	operation := v.determineOperation(method, parts)
	log.Printf("[VALIDATOR] Operation: %s", operation)

	// Check if operation is allowed
	if !v.isOperationAllowed(table, operation) {
		return nil, fmt.Errorf("operation '%s' not allowed for table '%s'", operation, tableKey)
	}

	// Build resolved path with link field resolution if needed
	resolvedPath, err := v.buildResolvedPath(table.TableID, table.Name, parts[1:])
	if err != nil {
		return nil, err
	}

	result := &ValidationResult{
		TableKey:     tableKey,
		TableID:      table.TableID,
		TableName:    table.Name,
		Operation:    operation,
		Allowed:      true,
		ResolvedPath: resolvedPath,
	}

	log.Printf("[VALIDATOR] Validation successful: %+v", result)
	return result, nil
}

// ValidationResult contains the result of request validation
type ValidationResult struct {
	TableKey     string
	TableID      string
	TableName    string
	Operation    string
	Allowed      bool
	ResolvedPath string
}

// determineOperation determines the operation type from HTTP method and path
func (v *Validator) determineOperation(method string, parts []string) string {
	switch method {
	case http.MethodGet:
		return "read"
	case http.MethodPost:
		if len(parts) > 2 && parts[2] == "links" {
			return "link"
		}
		return "create"
	case http.MethodPatch, http.MethodPut:
		return "update"
	case http.MethodDelete:
		return "delete"
	default:
		return "unknown"
	}
}

// isOperationAllowed checks if an operation is allowed for a table
func (v *Validator) isOperationAllowed(table config.ResolvedTable, operation string) bool {
	for _, allowedOp := range table.Operations {
		if allowedOp == operation {
			return true
		}
	}
	return false
}

// buildResolvedPath constructs the resolved path with table ID and resolves link field aliases
// Path format: {tableID}/links/{linkAlias}/{recordId} -> {tableID}/links/{linkFieldID}/{recordId}
func (v *Validator) buildResolvedPath(tableID, tableName string, remainingParts []string) (string, error) {
	if len(remainingParts) == 0 {
		return tableID, nil
	}

	// Check if this is a link request: /links/{linkAlias}/{recordId}
	// Pattern: parts[0] = "links", parts[1] = linkAlias, parts[2] = recordId
	if len(remainingParts) >= 3 && remainingParts[0] == "links" {
		linkAlias := remainingParts[1]
		log.Printf("[LINK RESOLVER] Detected link request for table '%s', alias '%s'", tableName, linkAlias)

		// Try to resolve the link field alias to field ID using MetaCache
		if v.metaCache != nil {
			// Try direct match first
			linkFieldID, ok := v.metaCache.ResolveLinkField(tableID, linkAlias)
			if !ok {
				// Try normalized version (replace spaces/underscores)
				normalizedAlias := strings.ReplaceAll(linkAlias, "_", " ")
				linkFieldID, ok = v.metaCache.ResolveLinkField(tableID, normalizedAlias)
			}

			if ok {
				log.Printf("[LINK RESOLVER] %s.%s → %s", tableName, linkAlias, linkFieldID)
				// Replace the alias with the resolved field ID
				remainingParts[1] = linkFieldID
			} else {
				// Link field not found in cache
				return "", fmt.Errorf("unknown link field '%s' for table '%s'", linkAlias, tableName)
			}
		} else {
			log.Printf("[LINK RESOLVER WARNING] MetaCache not available, using alias as-is")
		}
	}

	return tableID + "/" + strings.Join(remainingParts, "/"), nil
}
