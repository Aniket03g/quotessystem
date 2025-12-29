# MetaCache Explained

## What is MetaCache?

**MetaCache** is the proxy's **translation dictionary** stored in memory (RAM).

Think of it like a phone's contact list:
- You see: "Mom 📱"
- Phone dials: "+1-555-0123"

MetaCache works the same way:
- You say: "quotes"
- MetaCache translates: "clkczb2ifl6l25g"

## Why "Cache"?

**Cache** = temporary storage for quick access

Instead of asking NocoDB "What's the ID for Quotes?" every single time, the proxy:
1. Asks once
2. Stores the answer in memory (MetaCache)
3. Uses the stored answer for all future requests
4. Refreshes every 10 minutes to stay current

This makes everything **super fast**!

## What Does MetaCache Store?

MetaCache maintains three dictionaries:

### 1. Table Name → Table ID
```
"quotes"      → "clkczb2ifl6l25g"
"products"    → "tbl_abc123xyz"
"accounts"    → "tbl_def456ghi"
"contacts"    → "tbl_ghi789jkl"
```

### 2. Field Names (per table)
```
Table "clkczb2ifl6l25g" (Quotes):
  "subject"        → "fld_aaa111"
  "quote status"   → "fld_bbb222"
  "total amount"   → "fld_ccc333"
  "created date"   → "fld_ddd444"
```

### 3. Link Field Names (per table)
```
Table "clkczb2ifl6l25g" (Quotes):
  "products"       → "lnk_xyz789"
  "accounts_copy"  → "lnk_abc123"
  "contacts"       → "lnk_def456"
```

Link fields are special because they connect tables together!

## How MetaCache Works: Step by Step

### Step 1: Initialization (Proxy Starts)
```
[METACACHE] Creating new MetaCache instance
[METACACHE] NocoDB URL: http://nocodb.com/api/v2/
[METACACHE] Base ID: pbf7tt48gxdl50h
```

### Step 2: Initial Load (Synchronous)
```
[METACACHE] Performing initial synchronous metadata load...
[METACACHE] Fetching table metadata from NocoDB...
```

The proxy **waits** for this to complete before accepting any requests. Why? Because without metadata, it can't translate anything!

### Step 3: Fetch Tables List
```
GET http://nocodb.com/api/v2/meta/bases/pbf7tt48gxdl50h/tables

Response:
{
  "list": [
    {"id": "clkczb2ifl6l25g", "title": "Quotes"},
    {"id": "tbl_abc123xyz", "title": "Products"},
    ...
  ]
}
```

### Step 4: Store Table Mappings
```
[METACACHE] Mapped table 'Quotes' → 'clkczb2ifl6l25g'
[METACACHE] Mapped table 'Products' → 'tbl_abc123xyz'
```

### Step 5: Fetch Field Details for Each Table
```
For each table:
  GET http://nocodb.com/api/v3/meta/bases/pbf7tt48gxdl50h/tables/{tableId}
  
  Extract:
  - Regular fields (text, numbers, dates)
  - Link fields (relationships to other tables)
```

### Step 6: Store Field Mappings
```
[METACACHE] Mapped field 'Quotes.Subject' → 'fld_aaa111'
[METACACHE] ✓ Found link field 'Quotes.Products' (ID: lnk_xyz789, Type: Links)
[METACACHE] Cached 15 fields for table 'Quotes'
```

### Step 7: Ready!
```
[METACACHE] ✅ Successfully loaded 6 tables and 8 link field mappings
[METACACHE] Initial metadata load complete: 6 tables cached
```

## Using MetaCache: Translation in Action

Now when a request comes in, MetaCache translates it:

### Example 1: Simple Table Lookup
```
Frontend Request:
GET /proxy/quotes/records

MetaCache Translation:
1. Look up "quotes" in table dictionary
2. Find: "quotes" → "clkczb2ifl6l25g"
3. Return: "clkczb2ifl6l25g"

Final NocoDB Request:
GET /api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/records
```

### Example 2: Link Field Lookup
```
Frontend Request:
POST /proxy/quotes/links/products/123

MetaCache Translation:
1. Look up "quotes" → "clkczb2ifl6l25g"
2. Look up link field "products" in table "clkczb2ifl6l25g"
3. Find: "products" → "lnk_xyz789"
4. Return: "clkczb2ifl6l25g" and "lnk_xyz789"

Final NocoDB Request:
POST /api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/links/lnk_xyz789/123
```

### Example 3: Field Name Lookup
```
Frontend Request:
GET /proxy/quotes/records?fields=Subject,Quote Status

MetaCache Translation:
1. Look up table "quotes" → "clkczb2ifl6l25g"
2. Look up field "Subject" → "fld_aaa111"
3. Look up field "Quote Status" → "fld_bbb222"

Note: Field translation is optional - NocoDB accepts both names and IDs
```

## Auto-Refresh: Keeping Fresh

Every 10 minutes, MetaCache refreshes automatically:

```
[METACACHE] Auto-refreshing metadata cache...
[METACACHE] Fetching table metadata from NocoDB...
[METACACHE] Mapped table 'Quotes' → 'clkczb2ifl6l25g'
[METACACHE] ✓ Found link field 'Quotes.Products' (ID: lnk_xyz789)
[METACACHE] ✅ Successfully loaded 6 tables and 8 link field mappings
```

This happens in the background while your app keeps running!

### Why 10 Minutes?

It's a balance:
- **Too frequent** (every 30 seconds): Wastes resources, hammers NocoDB
- **Too rare** (once a day): Changes take too long to appear
- **Just right** (10 minutes): Fresh enough, efficient enough

You can change this in the code if needed!

## Thread Safety: Multiple Requests at Once

MetaCache uses **locks** to prevent chaos when multiple requests happen simultaneously:

```
Request 1: "What's the ID for quotes?"
Request 2: "What's the ID for products?"
Request 3: "Refresh the cache!"

Without locks: ❌ Chaos! Data corruption!
With locks: ✅ Orderly! Each request waits its turn.
```

The locks ensure:
- Reading is fast (multiple reads can happen at once)
- Writing is safe (only one write at a time)
- No corrupted data

## Case-Insensitive Lookups

MetaCache is smart about capitalization:

```
All of these work:
- "quotes"
- "Quotes"
- "QUOTES"
- "QuOtEs"

All translate to: "clkczb2ifl6l25g"
```

This makes the API more forgiving and user-friendly!

## Error Handling

What if a table doesn't exist?

```
Frontend Request:
GET /proxy/unicorns/records

MetaCache Translation:
1. Look up "unicorns" in table dictionary
2. Not found!
3. Return: (empty, false)

Proxy Response:
HTTP 403 Forbidden
"forbidden: table 'unicorns' not found in configuration"
```

The proxy protects NocoDB from invalid requests!

## Memory Usage

MetaCache is **lightweight**:

```
Typical memory usage:
- 6 tables × 50 bytes = 300 bytes
- 100 fields × 100 bytes = 10 KB
- 20 link fields × 100 bytes = 2 KB

Total: ~12 KB (tiny!)
```

Even with hundreds of tables, it's negligible.

## Key Takeaway

**MetaCache is the brain of the proxy:**
- Stores a translation dictionary in memory
- Fetched once at startup, refreshed every 10 minutes
- Translates friendly names to NocoDB IDs instantly
- Thread-safe and case-insensitive
- Lightweight and fast

Without MetaCache, every request would need to query NocoDB for IDs. With MetaCache, translation is instant!

---

**Next:** [05-request-flow.md](./05-request-flow.md) - Let's follow a complete request from frontend to database and back.
