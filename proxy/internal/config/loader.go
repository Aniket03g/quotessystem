package config

import (
	"fmt"
	"log"
	"os"

	"gopkg.in/yaml.v3"
)

// LoadProxyConfig loads the proxy configuration from a YAML file
func LoadProxyConfig(path string) (*ProxyConfig, error) {
	log.Printf("[CONFIG] Loading proxy configuration from: %s", path)

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config ProxyConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse YAML config: %w", err)
	}

	if err := validateConfig(&config); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	log.Printf("[CONFIG] Successfully loaded configuration with %d tables", len(config.Tables))
	return &config, nil
}

// validateConfig performs basic validation on the configuration
func validateConfig(config *ProxyConfig) error {
	if config.NocoDB.BaseID == "" {
		return fmt.Errorf("nocodb.base_id is required")
	}

	if len(config.Tables) == 0 {
		return fmt.Errorf("at least one table must be defined")
	}

	for tableName, table := range config.Tables {
		if table.Name == "" {
			return fmt.Errorf("table '%s': name is required", tableName)
		}

		if len(table.Operations) == 0 {
			return fmt.Errorf("table '%s': at least one operation must be specified", tableName)
		}

		for _, op := range table.Operations {
			if !isValidOperation(op) {
				return fmt.Errorf("table '%s': invalid operation '%s'", tableName, op)
			}
		}

		for linkName, link := range table.Links {
			if link.Field == "" {
				return fmt.Errorf("table '%s', link '%s': field is required", tableName, linkName)
			}
			if link.TargetTable == "" {
				return fmt.Errorf("table '%s', link '%s': target_table is required", tableName, linkName)
			}
		}
	}

	return nil
}

// isValidOperation checks if an operation is valid
func isValidOperation(op string) bool {
	validOps := map[string]bool{
		"read":   true,
		"create": true,
		"update": true,
		"delete": true,
		"link":   true,
	}
	return validOps[op]
}
