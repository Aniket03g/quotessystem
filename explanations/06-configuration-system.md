# Configuration System

The proxy uses a simple YAML file to control what operations are allowed. This makes it easy to configure without touching code!

## The Configuration File: proxy.yaml

Located at: `proxy/config/proxy.yaml`

```yaml
# Generic NocoDB Proxy Configuration
nocodb:
  base_id: "pbf7tt48gxdl50h"

tables:
  quotes:
    name: "Quotes"
    operations: [read, create, update, delete, link]

  products:
    name: "Products"
    operations: [read]

  accounts:
    name: "Accounts"
    operations: [read]
```

## Breaking It Down

### Section 1: NocoDB Connection
```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"
```

**What it means:**
- `base_id` - Your NocoDB project/base ID
- This tells the proxy which NocoDB project to connect to

**Where to find it:**
- In your NocoDB URL: `http://nocodb.com/nc/pbf7tt48gxdl50h`
- Or in the `.env` file as `NOCODB_BASE_ID`

### Section 2: Table Definitions
```yaml
tables:
  quotes:              # ← Key (used in URLs)
    name: "Quotes"     # ← Actual table name in NocoDB
    operations: [...]  # ← What's allowed
```

**The key (`quotes`):**
- This is what you use in API calls: `/proxy/quotes/records`
- It's like a nickname or alias
- Can be anything you want (lowercase recommended)

**The name (`"Quotes"`):**
- This is the actual table name in NocoDB
- Must match exactly (case-sensitive)
- The proxy uses MetaCache to find the ID for this name

**The operations:**
- List of allowed operations for this table
- More on this below!

## The Five Operations

### 1. `read` - Viewing Data
```yaml
operations: [read]
```

**Allows:**
- `GET /proxy/quotes/records` - List all quotes
- `GET /proxy/quotes/records/123` - Get specific quote
- `GET /proxy/quotes/records?limit=10` - List with filters

**Use case:**
- Public data that anyone can view
- Reference data (products, categories)
- Read-only tables

### 2. `create` - Adding New Data
```yaml
operations: [create]
```

**Allows:**
- `POST /proxy/quotes/records` - Create new quote

**Use case:**
- Forms where users submit new data
- Adding new records

### 3. `update` - Modifying Existing Data
```yaml
operations: [update]
```

**Allows:**
- `PATCH /proxy/quotes/records/123` - Update quote #123

**Use case:**
- Edit forms
- Changing status
- Updating values

### 4. `delete` - Removing Data
```yaml
operations: [delete]
```

**Allows:**
- `DELETE /proxy/quotes/records/123` - Delete quote #123

**Use case:**
- Admin functions
- Cleanup operations
- **Use carefully!** Deletion is permanent

### 5. `link` - Connecting Records
```yaml
operations: [link]
```

**Allows:**
- `POST /proxy/quotes/links/products/123` - Link products to quote #123
- `DELETE /proxy/quotes/links/products/123` - Unlink products

**Use case:**
- Associating records (quote ↔ products)
- Building relationships
- Junction table operations

## Combining Operations

You can mix and match operations:

### Full Access (CRUD + Link)
```yaml
quotes:
  name: "Quotes"
  operations: [read, create, update, delete, link]
```
Users can do everything with quotes.

### Read-Only
```yaml
products:
  name: "Products"
  operations: [read]
```
Users can only view products, not modify them.

### Create and Link Only
```yaml
orders:
  name: "Orders"
  operations: [create, link]
```
Users can create orders and link items, but can't edit or delete.

### No Delete
```yaml
customers:
  name: "Customers"
  operations: [read, create, update, link]
```
Users can do everything except delete customers (safety!).

## Real-World Configuration Examples

### Example 1: Quote Management System
```yaml
tables:
  # Users can fully manage quotes
  quotes:
    name: "Quotes"
    operations: [read, create, update, delete, link]

  # Users can view and select products, but not modify them
  products:
    name: "Products"
    operations: [read]

  # Users can view and select accounts, but not modify them
  accounts:
    name: "Accounts"
    operations: [read]

  # Junction tables for linking
  accounts_quotes:
    name: "Accounts Quotes"
    operations: [read, create, link]

  products_for_quotes:
    name: "ProductsForQuotes"
    operations: [read, create, link]
```

**Why this setup?**
- Quotes: Full control (main entity users work with)
- Products/Accounts: Read-only (reference data, managed by admins)
- Junction tables: Create and link (for associations)

### Example 2: Blog System
```yaml
tables:
  # Public can read posts
  posts:
    name: "Blog Posts"
    operations: [read]

  # Only admins can manage posts (configured elsewhere)
  posts_admin:
    name: "Blog Posts"
    operations: [read, create, update, delete]

  # Users can create comments
  comments:
    name: "Comments"
    operations: [read, create]

  # Categories are read-only
  categories:
    name: "Categories"
    operations: [read]
```

### Example 3: Inventory System
```yaml
tables:
  # View and update inventory
  inventory:
    name: "Inventory"
    operations: [read, update]

  # Create orders but can't delete them
  orders:
    name: "Orders"
    operations: [read, create, update, link]

  # Suppliers are reference data
  suppliers:
    name: "Suppliers"
    operations: [read]
```

## How Configuration is Loaded

### Step 1: Proxy Starts
```
[STARTUP] Loading proxy configuration from: ./config/proxy.yaml
```

### Step 2: Parse YAML File
```
[CONFIG] Parsing YAML...
[CONFIG] Found 6 table definitions
```

### Step 3: Validate Structure
```
[CONFIG] Validating configuration...
[CONFIG] ✓ All table names are valid
[CONFIG] ✓ All operations are valid
```

### Step 4: Resolve Names to IDs
```
[RESOLVER] Starting resolution of proxy configuration...
[RESOLVER] Resolving table: quotes (name: Quotes)
[RESOLVER] Resolved table 'Quotes' → 'clkczb2ifl6l25g'
[RESOLVER] Successfully resolved 6 tables
```

The proxy uses MetaCache to convert table names to IDs.

### Step 5: Ready!
```
[STARTUP] ✅ Successfully resolved proxy configuration
[STARTUP] Schema-driven mode ACTIVE with 6 tables
```

## What If Configuration is Missing?

If `proxy.yaml` doesn't exist:

```
[STARTUP] No proxy config found at ./config/proxy.yaml
[STARTUP] 🔓 PROXY MODE: Legacy (No Validation)
[STARTUP] All operations allowed
```

**Legacy mode:**
- No validation
- All operations allowed on all tables
- Less secure but more flexible
- Good for development, bad for production

## Updating Configuration

### To Add a New Table:
1. Edit `proxy.yaml`
2. Add the table definition
3. Restart the proxy

```yaml
tables:
  # ... existing tables ...
  
  invoices:
    name: "Invoices"
    operations: [read, create, update, link]
```

**No code changes needed!**

### To Change Permissions:
1. Edit the `operations` list
2. Restart the proxy

```yaml
# Before: Full access
quotes:
  name: "Quotes"
  operations: [read, create, update, delete, link]

# After: Read-only
quotes:
  name: "Quotes"
  operations: [read]
```

### To Rename a Table Key:
```yaml
# Before
quotes:
  name: "Quotes"
  operations: [...]

# After
sales_quotes:
  name: "Quotes"
  operations: [...]
```

Now use `/proxy/sales_quotes/records` instead of `/proxy/quotes/records`.

The actual NocoDB table name stays the same!

## Configuration Best Practices

### 1. Use Descriptive Keys
```yaml
# Good
quotes:
  name: "Quotes"

# Less clear
q:
  name: "Quotes"
```

### 2. Start Restrictive, Open Up Later
```yaml
# Start with read-only
products:
  name: "Products"
  operations: [read]

# Add more permissions as needed
products:
  name: "Products"
  operations: [read, create, update]
```

### 3. Separate Admin Tables
```yaml
# Regular users
quotes:
  name: "Quotes"
  operations: [read, create, update]

# Admin access (different endpoint or role-based)
quotes_admin:
  name: "Quotes"
  operations: [read, create, update, delete]
```

### 4. Document Your Choices
```yaml
tables:
  # Products are managed by admins only
  # Regular users can view and select them
  products:
    name: "Products"
    operations: [read]
```

## Key Takeaway

**The configuration system makes the proxy flexible:**
- Define tables and permissions in YAML
- No code changes needed
- Easy to understand and modify
- Secure by default (only allowed operations work)
- Adaptable to any use case

The proxy reads this file, resolves names to IDs using MetaCache, and enforces the rules for every request!

---

**Next:** [07-working-with-this-frontend.md](./07-working-with-this-frontend.md) - Let's see how your current frontend uses the proxy.
