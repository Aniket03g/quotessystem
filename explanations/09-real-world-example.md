# Real-World Example: Creating a Quote

Let's walk through a complete, real-world scenario: **A sales rep creating a new quote with products and linking it to a customer account.**

## The Business Scenario

**Sarah** is a sales rep at Grove Systems. She needs to:
1. Create a new quote for customer "Acme Corp"
2. Add 3 products to the quote
3. Set the quote status to "Draft"
4. Save everything

Let's follow this journey through the entire system!

## Phase 1: Sarah Opens the App

### What Sarah Sees:
```
[Login Page]
Email: sarah@grovesystems.com
Password: ••••••••
[Login Button]
```

### What Happens Behind the Scenes:

#### Frontend (Browser):
```javascript
// User clicks "Login"
const response = await fetch('http://localhost:8080/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'sarah@grovesystems.com',
    password: 'sarah123'
  })
});

const data = await response.json();
// { token: "eyJhbGc...", user_id: "sarah-001", role: "user" }

localStorage.setItem('token', data.token);
```

#### Proxy Server:
```
[LOGIN] Login attempt from 192.168.1.100
[LOGIN] Login request for email: sarah@grovesystems.com
[LOGIN] Database user authenticated: sarah@grovesystems.com (role: user)
[LOGIN] Generating JWT token...
[LOGIN] JWT generated successfully
[LOGIN] Login successful for database user: sarah@grovesystems.com
```

**Result:** Sarah is logged in, has a JWT token stored in her browser.

## Phase 2: Sarah Navigates to "Create Quote"

### What Sarah Sees:
```
[Create Quote Page]
Subject: [_____________]
Account: [Select Account ▼]
Products: [Select Products ▼]
Status: [Draft ▼]
[Create Quote Button]
```

### What Happens Behind the Scenes:

The page needs to load:
- List of accounts (for dropdown)
- List of products (for dropdown)

#### Frontend Fetches Accounts:
```javascript
const response = await fetch('http://localhost:8080/proxy/accounts/records?limit=100', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});

const accounts = await response.json();
// { list: [{ id: 1, fields: { "Account Name": "Acme Corp" } }, ...] }
```

#### Proxy Processes Request:
```
[PROXY] Incoming request: GET /proxy/accounts/records?limit=100
[AUTH] ✓ Token valid (User: sarah-001)
[VALIDATOR] ✓ Table 'accounts' found
[VALIDATOR] ✓ Operation 'read' is allowed
[META] Resolved: 'accounts' → 'tbl_def456ghi'
[PROXY] Target URL: http://localhost:8090/api/v3/data/project/pbf7tt48gxdl50h/tbl_def456ghi/records?limit=100
[PROXY] Request completed successfully
```

#### Frontend Fetches Products:
```javascript
const response = await fetch('http://localhost:8080/proxy/products/records?limit=100', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});

const products = await response.json();
// { list: [{ id: 1, fields: { "Product Name": "Widget A", "Unit Price": "100" } }, ...] }
```

**Result:** Sarah sees dropdowns populated with accounts and products.

## Phase 3: Sarah Fills Out the Form

### What Sarah Does:
```
Subject: Q-2024-001
Account: Acme Corp (selected from dropdown)
Products: 
  ✓ Widget A ($100)
  ✓ Gadget B ($250)
  ✓ Tool C ($150)
Status: Draft

[Clicks "Create Quote"]
```

## Phase 4: Frontend Creates the Quote

### Step 1: Create Quote Record

```javascript
// Frontend code
const quoteData = {
  'Subject': 'Q-2024-001',
  'Quote Status': 'Draft',
  'Total Amount': '500' // 100 + 250 + 150
};

const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ fields: quoteData })
});

const quote = await response.json();
// { id: 123, fields: { Subject: "Q-2024-001", ... } }
```

#### Proxy Processes:
```
[PROXY] Incoming request: POST /proxy/quotes/records
[AUTH] ✓ Token valid
[VALIDATOR] ✓ Table 'quotes' found
[VALIDATOR] ✓ Operation 'create' is allowed
[META] Resolved: 'quotes' → 'clkczb2ifl6l25g'
[PROXY] Forwarding to NocoDB...
[PROXY] NocoDB responded with status: 200 OK
[PROXY] Response: {"id":123,"fields":{...}}
```

**Result:** Quote #123 created in NocoDB.

### Step 2: Link Account to Quote

```javascript
// Frontend code
const accountId = 1; // Acme Corp's ID
const quoteId = 123; // Newly created quote

const response = await fetch(
  `http://localhost:8080/proxy/quotes/links/accounts_copy/${quoteId}`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ id: accountId }])
  }
);
```

#### Proxy Processes:
```
[PROXY] Incoming request: POST /proxy/quotes/links/accounts_copy/123
[AUTH] ✓ Token valid
[VALIDATOR] ✓ Table 'quotes' found
[VALIDATOR] ✓ Operation 'link' is allowed
[META] Resolved table: 'quotes' → 'clkczb2ifl6l25g'
[LINK RESOLVER] Detected link request for table 'quotes', alias 'accounts_copy'
[META] Resolved link field: 'accounts_copy' → 'lnk_abc123'
[PROXY] Target URL: .../clkczb2ifl6l25g/links/lnk_abc123/123
[PROXY] Request completed successfully
```

**Result:** Quote #123 is now linked to Acme Corp.

### Step 3: Link Products to Quote

```javascript
// Frontend code
const productIds = [1, 2, 3]; // Widget A, Gadget B, Tool C
const quoteId = 123;

const response = await fetch(
  `http://localhost:8080/proxy/quotes/links/products/${quoteId}`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(productIds.map(id => ({ id })))
  }
);
```

#### Proxy Processes:
```
[PROXY] Incoming request: POST /proxy/quotes/links/products/123
[AUTH] ✓ Token valid
[VALIDATOR] ✓ Table 'quotes' found
[VALIDATOR] ✓ Operation 'link' is allowed
[META] Resolved table: 'quotes' → 'clkczb2ifl6l25g'
[LINK RESOLVER] Detected link request for table 'quotes', alias 'products'
[META] Resolved link field: 'products' → 'lnk_xyz789'
[PROXY] Target URL: .../clkczb2ifl6l25g/links/lnk_xyz789/123
[PROXY] Request completed successfully
```

**Result:** Quote #123 is now linked to 3 products.

## Phase 5: Success!

### What Sarah Sees:
```
✓ Quote created successfully!

[Redirecting to quote details...]
```

### Frontend Redirects:
```javascript
window.location.href = `/quote-detail?id=123`;
```

## Phase 6: Sarah Views the Quote

### What Sarah Sees:
```
[Quote Details Page]

Quote #123
Subject: Q-2024-001
Status: Draft
Total: $500

Account:
  Acme Corp

Products:
  • Widget A - $100
  • Gadget B - $250
  • Tool C - $150
```

### What Happens Behind the Scenes:

#### Fetch Quote Details:
```javascript
// Fetch linked account
const accountResponse = await fetch(
  `http://localhost:8080/proxy/quotes/links/accounts_copy/123?fields=Account Name`,
  {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    }
  }
);

// Fetch linked products
const productsResponse = await fetch(
  `http://localhost:8080/proxy/quotes/links/products/123?fields=Product Name,Unit Price`,
  {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    }
  }
);
```

#### Proxy Processes Both Requests:
```
[PROXY] GET /proxy/quotes/links/accounts_copy/123
[META] Resolved: 'accounts_copy' → 'lnk_abc123'
[PROXY] Forwarding to NocoDB...
[PROXY] Response: { list: [{ id: 1, fields: { "Account Name": "Acme Corp" } }] }

[PROXY] GET /proxy/quotes/links/products/123
[META] Resolved: 'products' → 'lnk_xyz789'
[PROXY] Forwarding to NocoDB...
[PROXY] Response: { list: [
  { id: 1, fields: { "Product Name": "Widget A", "Unit Price": "100" } },
  { id: 2, fields: { "Product Name": "Gadget B", "Unit Price": "250" } },
  { id: 3, fields: { "Product Name": "Tool C", "Unit Price": "150" } }
] }
```

**Result:** Sarah sees the complete quote with account and products.

## What Happened in NocoDB?

### Tables After Sarah's Actions:

#### Quotes Table:
```
| ID  | Subject     | Quote Status | Total Amount | Created Date        |
|-----|-------------|--------------|--------------|---------------------|
| 123 | Q-2024-001  | Draft        | 500          | 2024-12-23 08:30:00 |
```

#### Accounts Quotes Junction Table:
```
| Quote ID | Account ID |
|----------|------------|
| 123      | 1          |
```

#### ProductsForQuotes Junction Table:
```
| Quote ID | Product ID |
|----------|------------|
| 123      | 1          |
| 123      | 2          |
| 123      | 3          |
```

## The Complete Data Flow

```
Sarah's Browser
    ↓ [1. Login]
Proxy (validates credentials)
    ↓ [2. Returns JWT token]
Sarah's Browser (stores token)
    ↓ [3. Navigate to Create Quote]
    ↓ [4. Fetch accounts and products]
Proxy (translates, forwards)
    ↓
NocoDB (returns data)
    ↓
Sarah's Browser (shows dropdowns)
    ↓ [5. Fill form and submit]
    ↓ [6. POST create quote]
Proxy (validates, translates)
    ↓
NocoDB (creates quote #123)
    ↓ [7. POST link account]
Proxy (resolves link field)
    ↓
NocoDB (creates link in junction table)
    ↓ [8. POST link products]
Proxy (resolves link field)
    ↓
NocoDB (creates links in junction table)
    ↓
Sarah's Browser (shows success)
    ↓ [9. Navigate to quote details]
    ↓ [10. GET linked account and products]
Proxy (translates, forwards)
    ↓
NocoDB (returns linked data)
    ↓
Sarah's Browser (displays complete quote)
```

## Why This Works So Well

### 1. Sarah Never Sees Complexity
She just fills out a form. Behind the scenes:
- 5 API calls are made
- 3 tables are updated
- Multiple translations happen
- Authentication is verified each time

### 2. Frontend Code is Clean
```javascript
// Simple, readable code
await createQuote(quoteData);
await linkAccount(quoteId, accountId);
await linkProducts(quoteId, productIds);
```

No cryptic IDs, no complex logic.

### 3. Proxy Handles Everything
- Translates friendly names to IDs
- Validates permissions
- Secures NocoDB access
- Logs everything for debugging

### 4. NocoDB Stays Protected
- Frontend never has the master token
- All requests are validated
- Only allowed operations succeed
- Audit trail in logs

## What If Something Goes Wrong?

### Scenario 1: Sarah's Token Expires

```
[During step 6: POST create quote]

Proxy:
[AUTH] Token validation failed: token expired
[AUTH] ❌ Blocking request

Response:
HTTP 401 Unauthorized

Frontend:
- Detects 401 status
- Redirects to login page
- Shows message: "Your session expired. Please log in again."

Sarah:
- Logs in again
- Gets new token
- Continues working
```

### Scenario 2: Sarah Tries to Delete a Quote (Not Allowed)

```
Sarah clicks "Delete Quote" button

Frontend:
DELETE /proxy/quotes/records/123

Proxy:
[VALIDATOR] Operation 'delete' is NOT allowed for 'quotes'
[VALIDATOR] ❌ Blocking request

Response:
HTTP 403 Forbidden
{ error: "forbidden: operation 'delete' not allowed for table 'quotes'" }

Frontend:
- Shows error message
- "You don't have permission to delete quotes. Please contact your administrator."

Sarah:
- Sees the error
- Contacts admin if needed
```

### Scenario 3: Network Error

```
[During step 6: POST create quote]

Network drops...

Frontend:
try {
  await createQuote(quoteData);
} catch (error) {
  // Network error caught
  showError('Failed to create quote. Please check your connection and try again.');
}

Sarah:
- Sees error message
- Checks internet connection
- Tries again
```

## Key Takeaway

**This real-world example shows:**
- How all the pieces work together
- The journey from user action to database update
- How the proxy simplifies complex operations
- Why clean architecture matters

Sarah just filled out a form, but behind the scenes:
- Multiple API calls were orchestrated
- Names were translated to IDs
- Permissions were validated
- Data was securely stored
- Everything was logged

The proxy made this complex workflow feel simple and seamless!

---

**Congratulations!** You now understand how the proxy works from top to bottom. You've learned:
- What the proxy is and why it exists
- How NocoDB works and its ID system
- The metadata problem and MetaCache solution
- Complete request flows
- Configuration system
- Integration with any frontend
- Real-world usage

You're ready to build amazing applications with this proxy system! 🎉
