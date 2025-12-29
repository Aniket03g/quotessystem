# Working With This Frontend (Astro)

Your current frontend is built with **Astro** - a modern web framework. Let's see how it uses the proxy.

## Frontend Structure

```
frontend/
├── src/
│   ├── pages/           # Website pages
│   │   ├── quotes.astro       # List all quotes
│   │   ├── quote-detail.astro # View quote details
│   │   └── api/               # API helpers
│   ├── lib/             # Shared code
│   │   ├── api.ts            # API utilities
│   │   └── quoteDetails.ts   # Quote fetching logic
│   └── layouts/         # Page templates
```

## How the Frontend Talks to the Proxy

### Step 1: Configuration

The frontend knows where the proxy is:

```typescript
// In lib/api.ts and lib/quoteDetails.ts
const API_BASE_URL = 'http://localhost:8080';
```

This points to your proxy server (not directly to NocoDB).

### Step 2: Authentication

When a user logs in, they get a JWT token:

```typescript
// Login flow
const response = await fetch('http://localhost:8080/login', {
  method: 'POST',
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

const data = await response.json();
// data.token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

// Store token in localStorage
localStorage.setItem('token', data.token);
```

**The token is stored in the browser** and sent with every request.

### Step 3: Making Requests

Every API call includes the token:

```typescript
// From lib/api.ts
const token = localStorage.getItem('token');

const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## Real Example: Fetching Quote Details

Let's trace through the actual code in your frontend.

### File: `lib/quoteDetails.ts`

This file fetches a quote's linked data (account and products).

#### Function 1: Fetch Linked Account

```typescript
async function fetchLinkedAccount(quoteId: number, token: string) {
  const response = await fetch(
    `${API_BASE_URL}/proxy/quotes/links/accounts_copy/${quoteId}?fields=Account Name`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  const records = data.list || data.records || [];
  
  if (records.length > 0) {
    return {
      name: records[0].fields['Account Name'] || null
    };
  }

  return { name: null };
}
```

**What's happening:**
1. **URL**: `/proxy/quotes/links/accounts_copy/123`
   - `quotes` - table key from config
   - `links` - NocoDB link endpoint
   - `accounts_copy` - link field alias
   - `123` - quote ID
   - `?fields=Account Name` - only fetch this field

2. **Proxy translates:**
   - `quotes` → `clkczb2ifl6l25g` (table ID)
   - `accounts_copy` → `lnk_abc123` (link field ID)
   - Final URL: `/api/v3/data/project/.../clkczb2ifl6l25g/links/lnk_abc123/123`

3. **NocoDB returns:**
   - List of linked accounts for quote #123
   - Frontend extracts the account name

#### Function 2: Fetch Linked Products

```typescript
async function fetchLinkedProducts(quoteId: number, token: string) {
  const response = await fetch(
    `${API_BASE_URL}/proxy/quotes/links/products/${quoteId}?fields=Product Name,Unit Price`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  const records = data.list || data.records || [];
  
  return records.map(record => ({
    name: record.fields['Product Name'] || 'Unnamed Product',
    price: record.fields['Unit Price'] 
      ? parseFloat(String(record.fields['Unit Price'])) 
      : undefined
  }));
}
```

**What's happening:**
1. **URL**: `/proxy/quotes/links/products/123`
   - Similar to accounts, but for products
   - `products` is the link field alias

2. **Proxy translates:**
   - `products` → `lnk_xyz789` (link field ID)

3. **NocoDB returns:**
   - List of all products linked to quote #123
   - Frontend maps them to a clean structure

#### Function 3: Get Complete Quote Details

```typescript
export async function getQuoteDetails(quoteId: number) {
  const token = getToken();
  
  if (!token) {
    throw new Error('No authentication token found');
  }

  // Fetch account and products in parallel
  const [account, products] = await Promise.all([
    fetchLinkedAccount(quoteId, token),
    fetchLinkedProducts(quoteId, token)
  ]);

  return {
    quoteId,
    account,
    products
  };
}
```

**What's happening:**
1. Gets the auth token from localStorage
2. Fetches account and products **simultaneously** (faster!)
3. Combines the results into one object
4. Returns to the page component

### File: `pages/quote-detail.astro`

This page displays the quote details:

```astro
---
// Server-side code (runs on the server)
import { getQuoteDetails } from '../lib/quoteDetails';

const quoteId = 123; // From URL parameter
const details = await getQuoteDetails(quoteId);
---

<!-- HTML template -->
<div>
  <h1>Quote #{details.quoteId}</h1>
  
  <div>
    <h2>Account</h2>
    <p>{details.account.name || 'No account linked'}</p>
  </div>

  <div>
    <h2>Products</h2>
    {details.products.map(product => (
      <div>
        <span>{product.name}</span>
        <span>${product.price}</span>
      </div>
    ))}
  </div>
</div>
```

## The Complete Flow (Your Frontend)

```
1. User visits /quote-detail?id=123
   ↓
2. Astro page loads (quote-detail.astro)
   ↓
3. Server-side code calls getQuoteDetails(123)
   ↓
4. getQuoteDetails fetches from proxy:
   - GET /proxy/quotes/links/accounts_copy/123
   - GET /proxy/quotes/links/products/123
   ↓
5. Proxy translates and forwards to NocoDB:
   - GET /api/.../clkczb2ifl6l25g/links/lnk_abc123/123
   - GET /api/.../clkczb2ifl6l25g/links/lnk_xyz789/123
   ↓
6. NocoDB returns linked records
   ↓
7. Proxy forwards responses back
   ↓
8. Frontend combines data
   ↓
9. Page renders with account and products
   ↓
10. User sees the quote details!
```

## Key Benefits for Your Frontend

### 1. Clean, Readable Code

**Without proxy:**
```typescript
// Cryptic and hard to maintain
fetch('http://nocodb.com/api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/links/lnk_abc123/123')
```

**With proxy:**
```typescript
// Clear and self-documenting
fetch('http://localhost:8080/proxy/quotes/links/accounts_copy/123')
```

### 2. No Hardcoded IDs

Your frontend code uses **aliases** like:
- `quotes` instead of `clkczb2ifl6l25g`
- `accounts_copy` instead of `lnk_abc123`
- `products` instead of `lnk_xyz789`

If NocoDB changes these IDs, your frontend code doesn't need to change!

### 3. Security

Your frontend **never** knows the NocoDB master token:
- Frontend has: JWT token (temporary, user-specific)
- Proxy has: NocoDB token (permanent, all-access)
- If someone steals the JWT, it expires in 24 hours
- If someone steals the NocoDB token, they have full access forever

The proxy keeps the master key safe!

### 4. Simplified Error Handling

```typescript
const response = await fetch('/proxy/quotes/records');

if (response.status === 401) {
  // Token expired - redirect to login
  logout();
}

if (response.status === 403) {
  // Not allowed - show error
  showError('You don\'t have permission');
}

if (response.ok) {
  // Success!
  const data = await response.json();
}
```

The proxy returns standard HTTP status codes, making error handling consistent.

## How to Add a New Feature

Let's say you want to add a "Contacts" feature.

### Step 1: Update Proxy Config

```yaml
# proxy/config/proxy.yaml
tables:
  # ... existing tables ...
  
  contacts:
    name: "Contacts"
    operations: [read, create, update]
```

### Step 2: Restart Proxy

```bash
cd proxy
./generic-proxy.exe
```

The proxy loads the new config and fetches metadata.

### Step 3: Use in Frontend

```typescript
// lib/contacts.ts
export async function getContacts() {
  const token = getToken();
  
  const response = await fetch(
    'http://localhost:8080/proxy/contacts/records',
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  return response.json();
}
```

### Step 4: Create Page

```astro
---
// pages/contacts.astro
import { getContacts } from '../lib/contacts';

const contacts = await getContacts();
---

<h1>Contacts</h1>
{contacts.list.map(contact => (
  <div>{contact.fields['Name']}</div>
))}
```

**That's it!** No changes to the proxy code, just configuration.

## Common Patterns in Your Frontend

### Pattern 1: List Records
```typescript
GET /proxy/quotes/records?limit=50&offset=0
```

### Pattern 2: Get Single Record
```typescript
GET /proxy/quotes/records/123
```

### Pattern 3: Create Record
```typescript
POST /proxy/quotes/records
Body: { fields: { Subject: "Q-001", ... } }
```

### Pattern 4: Update Record
```typescript
PATCH /proxy/quotes/records/123
Body: { fields: { Status: "Approved" } }
```

### Pattern 5: Link Records
```typescript
POST /proxy/quotes/links/products/123
Body: [{ id: 1 }, { id: 2 }]
```

### Pattern 6: Get Linked Records
```typescript
GET /proxy/quotes/links/products/123
```

## Key Takeaway

**Your frontend benefits from the proxy by:**
- Using human-readable URLs instead of cryptic IDs
- Keeping authentication secure
- Having clean, maintainable code
- Being resilient to database changes
- Following consistent patterns for all data operations

The proxy acts as a **stable API layer** between your frontend and the ever-changing database structure!

---

**Next:** [08-working-with-any-frontend.md](./08-working-with-any-frontend.md) - Let's see how to use the proxy with other frameworks.
