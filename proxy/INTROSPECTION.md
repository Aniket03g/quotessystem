# Introspection Endpoints Documentation

## Overview

The Generic NocoDB Proxy now includes runtime introspection endpoints that provide visibility into the proxy's configuration, schema resolution, and operational status. These endpoints are **read-only** and do not expose secrets or tokens.

## Endpoints

### 1. Status Endpoint

**Endpoint:** `GET /__proxy/status`

**Purpose:** Health and readiness check for monitoring systems

**Authentication:** None required (public endpoint)

**Response:**
```json
{
  "metacache_ready": true,
  "schema_resolved": true,
  "tables_resolved": 4,
  "last_refresh": "2024-12-17T18:30:00Z",
  "mode": "schema-driven"
}
```

**Fields:**
- `metacache_ready` (boolean) - Whether MetaCache has successfully loaded NocoDB metadata
- `schema_resolved` (boolean) - Whether proxy.yaml was successfully resolved
- `tables_resolved` (integer) - Number of tables configured in schema-driven mode
- `last_refresh` (string, RFC3339) - Last time MetaCache refreshed metadata
- `mode` (string) - Either "schema-driven" or "legacy"

**Use Cases:**
- Kubernetes readiness probes
- Health monitoring dashboards
- CI/CD deployment verification
- Debugging configuration issues

**Example:**
```bash
curl http://localhost:8080/__proxy/status
```

---

### 2. Schema Introspection Endpoint

**Endpoint:** `GET /__proxy/schema`

**Purpose:** View resolved schema configuration at runtime

**Authentication:** None required (public endpoint)

**Response:**
```json
{
  "mode": "schema-driven",
  "config_path": "./config/proxy.yaml",
  "metacache_ready": true,
  "last_refresh": "2024-12-17T18:30:00Z",
  "tables": {
    "quotes": {
      "logical_name": "Quotes",
      "table_id": "mqsc4pb7g3vj2ex",
      "operations": ["read", "create", "update", "delete", "link"],
      "fields": {
        "subject": "clkczb2ifl6l25g",
        "status": "c87oqznadulf80i"
      },
      "links": {
        "products": {
          "field_id": "clkczb2ifl6l25g",
          "target_table": "Products"
        }
      }
    },
    "products": {
      "logical_name": "Products",
      "table_id": "mh67cfv10x81iav",
      "operations": ["read", "create", "update"],
      "fields": {},
      "links": {}
    }
  }
}
```

**Fields:**
- `mode` (string) - Proxy mode: "schema-driven" or "legacy"
- `config_path` (string) - Path to proxy.yaml configuration file
- `metacache_ready` (boolean) - MetaCache status
- `last_refresh` (string, RFC3339) - Last MetaCache refresh time
- `tables` (object) - Map of table configurations

**Table Object Fields:**
- `logical_name` (string) - Human-readable table name from NocoDB
- `table_id` (string) - NocoDB internal table ID
- `operations` (array) - Allowed operations for this table
- `fields` (object) - Field alias → field ID mappings
- `links` (object) - Link definitions with resolved field IDs

**Use Cases:**
- Frontend developers discovering available tables
- Debugging field ID resolution
- Verifying schema configuration
- API documentation generation
- Development tools integration

**Example:**
```bash
curl http://localhost:8080/__proxy/schema | jq
```

---

## Security Considerations

### What These Endpoints DO NOT Expose

✅ **Safe Information:**
- Table names and IDs (already visible in NocoDB UI)
- Field names and IDs (already visible in NocoDB UI)
- Allowed operations (configuration policy)
- Proxy mode and status

❌ **Protected Information:**
- NocoDB authentication tokens
- JWT secrets
- Database credentials
- OAuth client secrets
- User data
- Record contents

### Access Control

These endpoints are **intentionally public** (no authentication required) because:

1. **Operational Visibility:** DevOps teams need health checks without authentication
2. **Developer Experience:** Frontend developers need schema discovery
3. **No Sensitive Data:** Only metadata that's already visible in NocoDB UI
4. **Read-Only:** Cannot modify configuration or data

If you need to restrict access, use a reverse proxy (nginx, Traefik) to add authentication to `/__proxy/*` paths.

---

## Startup Ordering

The proxy now ensures proper initialization order:

1. **Load Environment Config** - Read .env variables
2. **Load Proxy Config** - Read proxy.yaml (if exists)
3. **Initialize MetaCache** - Synchronous initial load from NocoDB
4. **Resolve Schema** - Convert proxy.yaml names → IDs using MetaCache
5. **Start Server** - Register endpoints and begin serving requests

### Startup Logs

**Schema-Driven Mode:**
```
[META] Performing initial synchronous metadata load...
[META] Mapped 'Quotes' -> 'mqsc4pb7g3vj2ex'
[META] Mapped field 'Quotes.Subject' -> 'clkczb2ifl6l25g'
[META] Initial metadata load complete: 4 tables cached
[STARTUP] Resolving proxy configuration using loaded MetaCache...
[RESOLVER] Resolved table 'Quotes' -> 'mqsc4pb7g3vj2ex'
[STARTUP] ✅ Successfully resolved proxy configuration
[STARTUP] Schema-driven mode ACTIVE with 4 tables

[STARTUP] 🎯 PROXY MODE: Schema-Driven
[STARTUP]    Config: ./config/proxy.yaml
[STARTUP]    Tables: 4 configured
[STARTUP]    Validation: ENABLED
```

**Legacy Mode (no proxy.yaml):**
```
[META] Performing initial synchronous metadata load...
[META] Initial metadata load complete: 4 tables cached
[STARTUP] No proxy config found at ./config/proxy.yaml, using legacy mode

[STARTUP] 🔓 PROXY MODE: Legacy (No Validation)
[STARTUP]    All operations allowed
```

**Resolution Failure:**
```
[META] Initial metadata load complete: 4 tables cached
[STARTUP] Resolving proxy configuration using loaded MetaCache...
[RESOLVER] Failed to resolve table 'InvalidTable' to ID
[STARTUP ERROR] ❌ Failed to resolve proxy configuration: failed to resolve table 'InvalidTable' to ID
[STARTUP ERROR] This means the proxy.yaml references tables/fields not found in NocoDB
[STARTUP] Falling back to legacy mode (no schema validation)

[STARTUP] 🔓 PROXY MODE: Legacy (No Validation)
```

---

## Integration Examples

### Kubernetes Readiness Probe

```yaml
readinessProbe:
  httpGet:
    path: /__proxy/status
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  successThreshold: 1
  failureThreshold: 3
```

### Frontend Schema Discovery

```javascript
async function discoverSchema() {
  const response = await fetch('http://localhost:8080/__proxy/schema');
  const schema = await response.json();
  
  console.log('Proxy Mode:', schema.mode);
  console.log('Available Tables:', Object.keys(schema.tables));
  
  // Generate API client based on schema
  for (const [key, table] of Object.entries(schema.tables)) {
    console.log(`Table: ${table.logical_name}`);
    console.log(`  ID: ${table.table_id}`);
    console.log(`  Operations: ${table.operations.join(', ')}`);
  }
}
```

### Monitoring Dashboard

```javascript
async function checkProxyHealth() {
  const response = await fetch('http://localhost:8080/__proxy/status');
  const status = await response.json();
  
  return {
    healthy: status.metacache_ready && status.schema_resolved,
    mode: status.mode,
    tables: status.tables_resolved,
    lastRefresh: new Date(status.last_refresh)
  };
}

// Poll every 30 seconds
setInterval(async () => {
  const health = await checkProxyHealth();
  updateDashboard(health);
}, 30000);
```

### CI/CD Deployment Verification

```bash
#!/bin/bash
# wait-for-proxy.sh

echo "Waiting for proxy to be ready..."

for i in {1..30}; do
  STATUS=$(curl -s http://localhost:8080/__proxy/status)
  READY=$(echo $STATUS | jq -r '.metacache_ready')
  
  if [ "$READY" = "true" ]; then
    echo "✅ Proxy is ready!"
    echo $STATUS | jq
    exit 0
  fi
  
  echo "Attempt $i/30: Not ready yet..."
  sleep 2
done

echo "❌ Proxy failed to become ready"
exit 1
```

---

## Troubleshooting

### Issue: `metacache_ready: false`

**Cause:** MetaCache failed to load NocoDB metadata

**Solutions:**
1. Check `NOCODB_URL` is correct and accessible
2. Verify `NOCODB_TOKEN` has valid permissions
3. Check `NOCODB_BASE_ID` matches your NocoDB base
4. Review server logs for connection errors

### Issue: `schema_resolved: false` in schema-driven mode

**Cause:** proxy.yaml references tables/fields not found in NocoDB

**Solutions:**
1. Check `/__proxy/schema` to see which tables are available
2. Verify table names in proxy.yaml match NocoDB exactly (case-sensitive)
3. Ensure MetaCache has loaded (`metacache_ready: true`)
4. Review startup logs for specific resolution errors

### Issue: `tables_resolved: 0`

**Cause:** Running in legacy mode or no tables configured

**Solutions:**
1. Create `config/proxy.yaml` with table definitions
2. Restart the server
3. Check startup logs for configuration loading

---

## Best Practices

### 1. Use Status Endpoint for Health Checks

Always use `/__proxy/status` for automated health monitoring:

```yaml
# Good
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/__proxy/status"]
  
# Avoid
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
```

The status endpoint provides more detailed information about proxy readiness.

### 2. Cache Schema Information

Frontend applications should cache the schema response:

```javascript
// Cache schema for 5 minutes
const SCHEMA_CACHE_TTL = 5 * 60 * 1000;
let schemaCache = null;
let schemaCacheTime = 0;

async function getSchema() {
  const now = Date.now();
  if (schemaCache && (now - schemaCacheTime) < SCHEMA_CACHE_TTL) {
    return schemaCache;
  }
  
  const response = await fetch('/__proxy/schema');
  schemaCache = await response.json();
  schemaCacheTime = now;
  
  return schemaCache;
}
```

### 3. Monitor Last Refresh Time

Alert if MetaCache hasn't refreshed recently:

```javascript
const MAX_REFRESH_AGE = 15 * 60 * 1000; // 15 minutes

async function checkRefreshHealth() {
  const status = await fetch('/__proxy/status').then(r => r.json());
  const lastRefresh = new Date(status.last_refresh);
  const age = Date.now() - lastRefresh.getTime();
  
  if (age > MAX_REFRESH_AGE) {
    console.warn('MetaCache refresh is stale!', {
      lastRefresh,
      ageMinutes: Math.floor(age / 60000)
    });
  }
}
```

---

## API Reference Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/__proxy/status` | GET | None | Health/readiness check |
| `/__proxy/schema` | GET | None | Schema introspection |
| `/proxy/*` | ALL | JWT | Data operations (unchanged) |
| `/health` | GET | None | Basic health check |

---

**Version:** 2.1.0  
**Last Updated:** December 17, 2024
