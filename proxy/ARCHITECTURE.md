# Generic NocoDB Proxy - Architecture Documentation

## 🎯 Overview

This Go backend has been refactored into a **truly generic, schema-driven NocoDB proxy** with zero domain knowledge. It is now a **Database Control Plane** that can be reused across multiple frontends and use cases.

## 🏗️ Core Principles

1. **Zero Domain Knowledge**: Go code contains no business entities (Quotes, Accounts, Products, etc.)
2. **Schema-Driven**: All table/field knowledge lives in `config/proxy.yaml`
3. **MetaCache as Source of Truth**: Runtime resolution of names → IDs
4. **Single Data Path**: `/proxy/*` is the ONLY data access endpoint
5. **Open-Source Friendly**: Reusable across multiple projects

## 📁 Folder Structure

```
backend/
├── internal/
│   ├── auth/           # Authentication & JWT handling
│   ├── proxy/          # Generic proxy handler + MetaCache
│   │   ├── handler.go      # Main proxy HTTP handler
│   │   ├── metacache.go    # Table/field name → ID resolution
│   │   └── validator.go    # Schema-driven request validation
│   ├── config/         # Configuration system
│   │   ├── config.go       # Environment config (ports, tokens, etc.)
│   │   ├── schema.go       # Schema type definitions
│   │   ├── loader.go       # YAML config loader
│   │   └── resolver.go     # MetaCache → Config resolver
│   ├── middleware/     # HTTP middleware (CORS, auth, etc.)
│   ├── db/             # SQLite user database
│   └── utils/          # JWT utilities
├── config/
│   └── proxy.yaml      # Schema-driven configuration
├── main.go             # Server entry point
├── main_helpers.go     # OAuth & helper functions
└── go.mod
```

## 🔄 Request Flow

### Config-Driven Mode (Recommended)

```
Frontend Request
    ↓
POST /proxy/quotes/records
    ↓
[AuthMiddleware] → Validates JWT token
    ↓
[ProxyHandler] → Loads resolved config
    ↓
[Validator] → Checks if operation allowed for "quotes"
    ↓
[MetaCache] → Resolves "quotes" → table ID
    ↓
[ProxyHandler] → Forwards to NocoDB
    ↓
NocoDB Response → Frontend
```

### Legacy Mode (Fallback)

If no `config/proxy.yaml` exists, the proxy operates in legacy mode:
- Uses MetaCache for table name resolution only
- No operation validation
- All operations allowed

## 📋 Configuration System

### Environment Variables (`.env`)

```env
PORT=8080
NOCODB_URL=http://localhost:8090/api/v3/data/project/
NOCODB_TOKEN=your_token_here
NOCODB_BASE_ID=your_base_id_here
JWT_SECRET=your_jwt_secret
DATABASE_PATH=./users.db
PROXY_CONFIG_PATH=./config/proxy.yaml
```

### Schema Configuration (`config/proxy.yaml`)

```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"

tables:
  quotes:
    name: "Quotes"
    operations:
      - read
      - create
      - update
      - delete
      - link
    fields:
      subject: "Subject"
      status: "Quote Status"
    links:
      products:
        field: "Products"
        target_table: "Products"
```

**Key Points:**
- Uses **human-readable names** (not IDs)
- MetaCache resolves names → IDs at runtime
- Operations whitelist: `read`, `create`, `update`, `delete`, `link`
- Fields and links are optional (for documentation/future use)

## 🧩 Key Components

### 1. MetaCache (`internal/proxy/metacache.go`)

**Purpose**: Fetches and caches NocoDB metadata (table/field names → IDs)

**Features**:
- Auto-refreshes every 10 minutes
- Thread-safe with `sync.RWMutex`
- Resolves both table names and field names
- Supports case-insensitive lookups

**Methods**:
- `ResolveTable(name)` → table ID
- `ResolveField(tableID, fieldName)` → field ID

### 2. Config Resolver (`internal/config/resolver.go`)

**Purpose**: Converts `ProxyConfig` (YAML) → `ResolvedConfig` (runtime IDs)

**Flow**:
```
proxy.yaml (names) → Loader → ProxyConfig
                                    ↓
                            Resolver + MetaCache
                                    ↓
                            ResolvedConfig (IDs)
```

### 3. Validator (`internal/proxy/validator.go`)

**Purpose**: Validates incoming requests against resolved configuration

**Checks**:
- Table exists in config
- Operation is allowed for table
- Resolves table key → table ID

### 4. Proxy Handler (`internal/proxy/handler.go`)

**Purpose**: Generic HTTP handler that forwards requests to NocoDB

**Modes**:
- **Config-Driven**: Uses validator + resolved config
- **Legacy**: Uses MetaCache only (no validation)

**Supports**:
- All HTTP methods (GET, POST, PATCH, DELETE)
- Query parameters passthrough
- Authentication header injection (`xc-token`)

## 🚀 Usage Examples

### Frontend: Create a Quote

```javascript
const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fields: {
      Subject: 'Q-2024-001',
      'Quote Status': 'Draft',
      'Total Amount': '5000'
    }
  })
});
```

### Frontend: Link Products to Quote

```javascript
const response = await fetch(
  `http://localhost:8080/proxy/quotes/links/clkczb2ifl6l25g/123`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      { id: 1 },
      { id: 2 }
    ])
  }
);
```

### Frontend: Read Accounts

```javascript
const response = await fetch(
  'http://localhost:8080/proxy/accounts/records?limit=10',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
```

## 🔒 Security

### Authentication
- JWT-based authentication
- OAuth support (Google, GitHub)
- Local user accounts with bcrypt password hashing

### Authorization
- Config-driven operation whitelisting
- Per-table operation control
- Future: Role-based access control (RBAC)

## 🛠️ Development

### Build & Run

```bash
cd backend
go mod tidy
go build -o generic-proxy.exe
./generic-proxy.exe
```

### Environment Setup

1. Copy `.env.example` to `.env`
2. Configure NocoDB connection details
3. Create `config/proxy.yaml` with your schema
4. Run the server

### Adding a New Table

1. Add table definition to `config/proxy.yaml`:
```yaml
tables:
  my_table:
    name: "My Table"
    operations:
      - read
      - create
```

2. Restart server (MetaCache will auto-refresh)
3. Frontend can now access `/proxy/my_table/records`

**No Go code changes required!**

## 📊 What Go Code No Longer Knows

❌ Entity names (Quotes, Accounts, Products)  
❌ Business logic (quote creation, account linking)  
❌ Table IDs or Field IDs  
❌ Schema structure  
❌ Orchestration logic  

## ✅ What Is Now Config-Driven

✓ Table definitions  
✓ Allowed operations per table  
✓ Field mappings (optional)  
✓ Link relationships (optional)  
✓ Access control (future)  

## 🔄 Migration from Domain-Specific Code

### Before (Domain-Specific)
```go
// handlers/quotes.go
func (h *QuoteHandler) CreateQuote(w http.ResponseWriter, r *http.Request) {
    // Hardcoded table IDs, field IDs, business logic
    quoteID := createQuoteRecord(...)
    linkProducts(quoteID, productIDs)
    linkAccount(quoteID, accountID)
}
```

### After (Generic)
```go
// internal/proxy/handler.go
func (p *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    validation := p.Validator.ValidateRequest(r.Method, path)
    // Forward to NocoDB - no business logic
    proxyRequest(validation.ResolvedPath)
}
```

**Frontend now controls orchestration!**

## 🎓 Mental Model

This is a **Database Control Plane**, not an application backend.

Think of it as:
- **Nginx** for NocoDB (with auth + schema validation)
- **API Gateway** with dynamic routing
- **Zero-trust proxy** with config-driven policies

## 📝 Future Enhancements

- [ ] Role-based access control (RBAC)
- [ ] Field-level permissions
- [ ] Rate limiting per table
- [ ] Audit logging
- [ ] GraphQL support
- [ ] Webhook support
- [ ] Multi-tenant support

## 🤝 Contributing

This proxy is designed to be:
- **Reusable**: Works with any NocoDB base
- **Extensible**: Add features without breaking existing code
- **Maintainable**: Clear separation of concerns
- **Testable**: Pure functions with minimal dependencies

---

**Version**: 2.0.0 (Generic Schema-Driven Architecture)  
**Last Updated**: December 2024
