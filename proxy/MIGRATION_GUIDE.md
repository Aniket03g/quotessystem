# Migration Guide: From Domain-Specific to Generic Proxy

## 🎯 Quick Start

The refactor is **complete**. Your Go backend is now a truly generic, schema-driven NocoDB proxy.

### What Changed?

**Before:**
- Domain-specific handlers (`/api/quotes`)
- Hardcoded table/field IDs in Go code
- Business logic in backend

**After:**
- Generic proxy (`/proxy/*` only)
- Schema-driven configuration
- Business logic in frontend

## 🚀 Getting Started

### 1. Update Your Configuration

Create or update `config/proxy.yaml`:

```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"  # Your actual base ID

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

### 2. Build and Run

```bash
cd backend
go mod tidy
go build -o generic-proxy.exe
./generic-proxy.exe
```

### 3. Verify Startup

You should see:

```
[STARTUP] Loading proxy configuration from: ./config/proxy.yaml
[STARTUP] Successfully loaded configuration with 4 tables
[STARTUP] Resolving proxy configuration...
[STARTUP] Successfully resolved proxy configuration
[STARTUP] Proxy handler configured in schema-driven mode
```

## 📝 Frontend Migration

### Old Endpoint: `/api/quotes`

**Before (Domain-Specific):**
```javascript
const response = await fetch('/api/quotes', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    subject: 'Q-2024-001',
    status: 'Draft',
    total: '5000',
    account_id: 123,
    product_ids: [1, 2, 3]
  })
});
```

**After (Generic Proxy):**

You need to break this into separate operations:

```javascript
// 1. Create the quote
const quoteResp = await fetch('/proxy/quotes/records', {
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

const quote = quoteResp.records[0];
const quoteId = quote.id;

// 2. Link products to quote
if (productIds.length > 0) {
  await fetch(`/proxy/quotes/links/clkczb2ifl6l25g/${quoteId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(productIds.map(id => ({ id })))
  });
}

// 3. Link account to quote (via junction table)
if (accountId) {
  await fetch(`/proxy/accounts_quotes/links/cql0d2qo2giqe26/${accountId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ id: quoteId }])
  });
}
```

### Generic CRUD Operations

**Read Records:**
```javascript
// Get all quotes
const quotes = await fetch('/proxy/quotes/records?limit=10', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Get single quote
const quote = await fetch('/proxy/quotes/records/123', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Create Record:**
```javascript
const newRecord = await fetch('/proxy/quotes/records', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fields: {
      Subject: 'New Quote',
      'Quote Status': 'Draft'
    }
  })
});
```

**Update Record:**
```javascript
const updated = await fetch('/proxy/quotes/records/123', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fields: {
      'Quote Status': 'Approved'
    }
  })
});
```

**Delete Record:**
```javascript
await fetch('/proxy/quotes/records/123', {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Link Records:**
```javascript
// Link products to quote
await fetch('/proxy/quotes/links/{linkFieldId}/{quoteId}', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify([
    { id: productId1 },
    { id: productId2 }
  ])
});
```

## 🔧 Finding Field IDs

You need field IDs for linking operations. Here's how to find them:

### Method 1: Use MetaCache Logs

Start the server and check the logs:

```
[META] Mapped field 'Quotes.Products' -> 'clkczb2ifl6l25g'
[META] Mapped field 'Quotes.Accounts' -> 'c87oqznadulf80i'
```

### Method 2: NocoDB API

```bash
curl -H "xc-token: YOUR_TOKEN" \
  http://localhost:8090/api/v2/meta/bases/YOUR_BASE_ID/tables
```

Look for the `columns` array in each table's response.

### Method 3: Browser DevTools

1. Open NocoDB in browser
2. Open DevTools → Network tab
3. Click on a link field
4. Inspect the API request
5. Note the field ID in the URL

## 🎨 Example: Complete Quote Creation Flow

```javascript
async function createQuoteWithLinks(quoteData, productIds, accountId) {
  const token = localStorage.getItem('token');
  
  try {
    // Step 1: Create quote
    const quoteResp = await fetch('/proxy/quotes/records', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          Subject: quoteData.subject,
          'Quote Status': quoteData.status,
          'Quote Version': quoteData.version,
          'Quote Date': quoteData.date,
          'Total Amount': quoteData.total
        }
      })
    });
    
    if (!quoteResp.ok) throw new Error('Failed to create quote');
    
    const quoteResult = await quoteResp.json();
    const quoteId = quoteResult.records[0].id;
    
    // Step 2: Link products (if any)
    if (productIds && productIds.length > 0) {
      const productsLinkResp = await fetch(
        `/proxy/quotes/links/clkczb2ifl6l25g/${quoteId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(productIds.map(id => ({ id })))
        }
      );
      
      if (!productsLinkResp.ok) {
        console.warn('Failed to link products');
      }
    }
    
    // Step 3: Link account (if provided)
    if (accountId) {
      const accountLinkResp = await fetch(
        `/proxy/accounts_quotes/links/cql0d2qo2giqe26/${accountId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([{ id: quoteId }])
        }
      );
      
      if (!accountLinkResp.ok) {
        console.warn('Failed to link account');
      }
    }
    
    return { success: true, quoteId };
    
  } catch (error) {
    console.error('Quote creation failed:', error);
    return { success: false, error: error.message };
  }
}

// Usage
const result = await createQuoteWithLinks(
  {
    subject: 'Q-2024-001',
    status: 'Draft',
    version: '1.0',
    date: '2024-12-17',
    total: '5000'
  },
  [1, 2, 3],  // product IDs
  123         // account ID
);
```

## 🔍 Troubleshooting

### Issue: "table 'quotes' not found in configuration"

**Solution:** Add the table to `config/proxy.yaml`:

```yaml
tables:
  quotes:
    name: "Quotes"
    operations:
      - read
      - create
```

### Issue: "operation 'create' not allowed for table 'quotes'"

**Solution:** Add the operation to the table's allowed operations:

```yaml
tables:
  quotes:
    operations:
      - read
      - create  # Add this
```

### Issue: MetaCache not resolving table names

**Solution:** 
1. Check `NOCODB_BASE_ID` is set correctly
2. Check server logs for MetaCache errors
3. Verify NocoDB is accessible
4. Wait for auto-refresh (10 minutes) or restart server

### Issue: Field IDs not working

**Solution:**
1. Use the exact field ID from NocoDB metadata
2. Check MetaCache logs for field mappings
3. Verify the field exists in the table

## 📊 Configuration Reference

### Operations

- `read` - GET requests to `/proxy/{table}/records`
- `create` - POST requests to `/proxy/{table}/records`
- `update` - PATCH/PUT requests to `/proxy/{table}/records/{id}`
- `delete` - DELETE requests to `/proxy/{table}/records/{id}`
- `link` - POST requests to `/proxy/{table}/links/{fieldId}/{recordId}`

### Table Configuration

```yaml
tables:
  table_key:              # Used in URL: /proxy/table_key/...
    name: "Table Name"    # Exact name in NocoDB
    operations:           # Allowed operations
      - read
      - create
    fields:               # Optional: field mappings
      alias: "Field Name"
    links:                # Optional: link definitions
      link_name:
        field: "Link Field Name"
        target_table: "Target Table"
```

## 🎓 Best Practices

### 1. Error Handling

Always handle errors in frontend:

```javascript
try {
  const resp = await fetch('/proxy/quotes/records', {...});
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Request failed');
  }
  const data = await resp.json();
  // Process data
} catch (error) {
  console.error('Operation failed:', error);
  // Show user-friendly error message
}
```

### 2. Loading States

Show loading indicators during multi-step operations:

```javascript
setLoading(true);
try {
  await createQuoteWithLinks(...);
} finally {
  setLoading(false);
}
```

### 3. Optimistic Updates

Update UI immediately, rollback on error:

```javascript
// Add to UI
setQuotes([...quotes, newQuote]);

try {
  const result = await createQuote(newQuote);
  // Update with server response
  updateQuote(result.quoteId, result);
} catch (error) {
  // Rollback
  setQuotes(quotes.filter(q => q.id !== newQuote.id));
  showError(error);
}
```

## 🚦 Testing Checklist

- [ ] Server starts without errors
- [ ] MetaCache loads table metadata
- [ ] Config resolves successfully
- [ ] Can create records via `/proxy/*`
- [ ] Can read records via `/proxy/*`
- [ ] Can update records via `/proxy/*`
- [ ] Can delete records via `/proxy/*`
- [ ] Can link records via `/proxy/*`
- [ ] Operations respect config permissions
- [ ] Authentication works correctly

## 📞 Support

If you encounter issues:

1. Check server logs for detailed error messages
2. Verify `config/proxy.yaml` syntax
3. Ensure NocoDB is accessible
4. Review `ARCHITECTURE.md` for system design
5. Check `REFACTOR_SUMMARY.md` for changes made

---

**Migration Guide Version**: 1.0  
**Last Updated**: December 17, 2024
