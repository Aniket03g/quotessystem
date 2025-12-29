# Generic NocoDB Proxy - API Documentation

This document explains how the proxy works and what any frontend developer needs to know to build applications that use it.

## What Is This Proxy?

A **generic, reusable middleware layer** that sits between any frontend application and NocoDB. It provides:

1. **Authentication** - Secure JWT-based user authentication
2. **Translation** - Converts human-readable names to NocoDB's internal IDs
3. **Validation** - Enforces operation permissions via configuration
4. **Security** - Keeps NocoDB credentials hidden from frontend

## Why Use This Proxy?

**Without Proxy (Direct NocoDB Access):**
- Frontend needs NocoDB master token (security risk)
- Must use cryptic IDs like `clkczb2ifl6l25g` everywhere
- No operation-level permissions
- Code breaks when NocoDB structure changes

**With Proxy:**
- Frontend uses temporary JWT tokens
- Uses friendly names like `quotes` instead of IDs
- Config-driven permissions (read-only, full access, etc.)
- Automatic adaptation to NocoDB changes

## Connection Details

- **Proxy URL**: `http://localhost:8080` (default, configurable)
- **Authentication**: JWT tokens via `Authorization: Bearer {token}` header
- **API Pattern**: `/proxy/{table}/{endpoint}`
- **Methods**: Standard REST (GET, POST, PATCH, DELETE)

---

## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Authentication Flow](#authentication-flow)
3. [Making Data Requests](#making-data-requests)
4. [Error Handling](#error-handling)
5. [Frontend Setup Guide](#frontend-setup-guide)
6. [Code Examples](#code-examples)
7. [Available Tables and Operations](#available-tables-and-operations)
8. [Best Practices](#best-practices)

---

## API Endpoints

### Base URL
```
http://localhost:8080
```

### Public Endpoints (No Authentication Required)

#### Login
```http
POST /login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "123",
  "role": "user"
}
```

#### Signup
```http
POST /signup
Content-Type: application/json

{
  "email": "newuser@example.com",
  "password": "securepass123",
  "name": "John Doe"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "124",
  "role": "user"
}
```

#### OAuth (Google)
```http
GET /auth/google
→ Redirects to Google login

GET /auth/google/callback
→ Handles OAuth callback
→ Redirects to: {frontend_url}/auth/callback?token=...
```

#### OAuth (GitHub)
```http
GET /auth/github
→ Redirects to GitHub login

GET /auth/github/callback
→ Handles OAuth callback
→ Redirects to: {frontend_url}/auth/callback?token=...
```

#### Health Check
```http
GET /health

Response:
{
  "status": "ok"
}
```

### Protected Endpoints (Authentication Required)

All protected endpoints require the `Authorization` header:
```
Authorization: Bearer {your_jwt_token}
```

#### Get Current User
```http
GET /auth/me
Authorization: Bearer {token}

Response:
{
  "id": 123,
  "email": "user@example.com",
  "name": "John Doe",
  "role": "user"
}
```

#### Data Access (Main Proxy Endpoint)
```http
/proxy/{table}/{endpoint}
```

Examples:
- `GET /proxy/quotes/records` - List all quotes
- `POST /proxy/quotes/records` - Create a quote
- `PATCH /proxy/quotes/records/123` - Update quote #123
- `DELETE /proxy/quotes/records/123` - Delete quote #123
- `POST /proxy/quotes/links/products/123` - Link products to quote #123
- `GET /proxy/quotes/links/products/123` - Get products linked to quote #123

---

## Authentication Flow

### Step 1: User Logs In

**Option A: Local Login**
```javascript
const response = await fetch('http://localhost:8080/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

const data = await response.json();
// { token: "eyJhbGc...", user_id: "123", role: "user" }
```

**Option B: OAuth Login**
```javascript
// Redirect user to OAuth provider
window.location.href = 'http://localhost:8080/auth/google';

// After OAuth, user is redirected back to your frontend:
// http://localhost:4321/auth/callback?token=eyJhbGc...

// Extract token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
```

### Step 2: Store Token

```javascript
// Store in localStorage (persists across sessions)
localStorage.setItem('token', data.token);

// Or sessionStorage (cleared when tab closes)
sessionStorage.setItem('token', data.token);

// Or in-memory (cleared on page refresh)
let authToken = data.token;
```

### Step 3: Use Token in Requests

```javascript
const token = localStorage.getItem('token');

const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Step 4: Handle Token Expiration

```javascript
const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

if (response.status === 401) {
  // Token expired or invalid
  localStorage.removeItem('token');
  window.location.href = '/login';
}
```

---

## Making Data Requests

### Pattern 1: List Records

```javascript
// Get all records
GET /proxy/{table}/records

// With pagination
GET /proxy/{table}/records?limit=50&offset=0

// With field selection
GET /proxy/{table}/records?fields=Field1,Field2,Field3

// With filters
GET /proxy/{table}/records?where=(Status,eq,Active)
```

**Example:**
```javascript
const response = await fetch(
  'http://localhost:8080/proxy/quotes/records?limit=10&offset=0',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

const data = await response.json();
// {
//   list: [
//     { id: 1, fields: { Subject: "Q-001", Status: "Draft" } },
//     { id: 2, fields: { Subject: "Q-002", Status: "Sent" } }
//   ],
//   pageInfo: { totalRows: 100, page: 1, pageSize: 10 }
// }
```

### Pattern 2: Get Single Record

```javascript
GET /proxy/{table}/records/{id}
```

**Example:**
```javascript
const response = await fetch(
  'http://localhost:8080/proxy/quotes/records/123',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

const data = await response.json();
// { id: 123, fields: { Subject: "Q-001", Status: "Draft", ... } }
```

### Pattern 3: Create Record

```javascript
POST /proxy/{table}/records
Content-Type: application/json

{
  "fields": {
    "Field1": "value1",
    "Field2": "value2"
  }
}
```

**Example:**
```javascript
const response = await fetch(
  'http://localhost:8080/proxy/quotes/records',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        'Subject': 'Q-2024-001',
        'Quote Status': 'Draft',
        'Total Amount': '5000'
      }
    })
  }
);

const data = await response.json();
// { id: 123, fields: { Subject: "Q-2024-001", ... } }
```

### Pattern 4: Update Record

```javascript
PATCH /proxy/{table}/records/{id}
Content-Type: application/json

{
  "fields": {
    "Field1": "new_value"
  }
}
```

**Example:**
```javascript
const response = await fetch(
  'http://localhost:8080/proxy/quotes/records/123',
  {
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
  }
);
```

### Pattern 5: Delete Record

```javascript
DELETE /proxy/{table}/records/{id}
```

**Example:**
```javascript
const response = await fetch(
  'http://localhost:8080/proxy/quotes/records/123',
  {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
```

### Pattern 6: Link Records

```javascript
POST /proxy/{table}/links/{linkField}/{recordId}
Content-Type: application/json

[
  { "id": 1 },
  { "id": 2 }
]
```

**Example:**
```javascript
// Link products to a quote
const response = await fetch(
  'http://localhost:8080/proxy/quotes/links/products/123',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      { id: 1 },  // Product ID 1
      { id: 2 },  // Product ID 2
      { id: 3 }   // Product ID 3
    ])
  }
);
```

### Pattern 7: Get Linked Records

```javascript
GET /proxy/{table}/links/{linkField}/{recordId}
```

**Example:**
```javascript
// Get products linked to a quote
const response = await fetch(
  'http://localhost:8080/proxy/quotes/links/products/123?fields=Product Name,Unit Price',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

const data = await response.json();
// {
//   list: [
//     { id: 1, fields: { "Product Name": "Widget A", "Unit Price": "100" } },
//     { id: 2, fields: { "Product Name": "Gadget B", "Unit Price": "250" } }
//   ]
// }
```

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Process response |
| 401 | Unauthorized | Token missing/invalid/expired - redirect to login |
| 403 | Forbidden | Operation not allowed - show error message |
| 400 | Bad Request | Invalid data - show validation error |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Something went wrong - retry or show error |

### Error Response Format

```json
{
  "error": "error message here"
}
```

### Example Error Handling

```javascript
async function makeRequest(url, options) {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 401) {
      // Unauthorized - redirect to login
      localStorage.removeItem('token');
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    
    if (response.status === 403) {
      // Forbidden - show error
      const error = await response.json();
      throw new Error(error.error || 'Operation not allowed');
    }
    
    if (!response.ok) {
      // Other errors
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}
```

---

## Frontend Setup Guide

### 1. Create API Module

Create a file `api.js` or `api.ts`:

```javascript
const API_BASE = 'http://localhost:8080';

// Get stored token
export function getToken() {
  return localStorage.getItem('token');
}

// Store token
export function setToken(token) {
  localStorage.setItem('token', token);
}

// Clear token
export function clearToken() {
  localStorage.removeItem('token');
}

// Login
export async function login(email, password) {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    throw new Error('Login failed');
  }
  
  const data = await response.json();
  setToken(data.token);
  return data;
}

// Signup
export async function signup(email, password, name) {
  const response = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password, name })
  });
  
  if (!response.ok) {
    throw new Error('Signup failed');
  }
  
  const data = await response.json();
  setToken(data.token);
  return data;
}

// Generic API request
export async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  
  if (!token) {
    throw new Error('No authentication token');
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (response.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Request failed');
  }
  
  return response.json();
}

// Get quotes
export async function getQuotes(limit = 50, offset = 0) {
  return apiRequest(`/proxy/quotes/records?limit=${limit}&offset=${offset}`);
}

// Create quote
export async function createQuote(quoteData) {
  return apiRequest('/proxy/quotes/records', {
    method: 'POST',
    body: JSON.stringify({ fields: quoteData })
  });
}

// Update quote
export async function updateQuote(id, quoteData) {
  return apiRequest(`/proxy/quotes/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: quoteData })
  });
}

// Link products to quote
export async function linkProducts(quoteId, productIds) {
  return apiRequest(`/proxy/quotes/links/products/${quoteId}`, {
    method: 'POST',
    body: JSON.stringify(productIds.map(id => ({ id })))
  });
}

// Get linked products
export async function getLinkedProducts(quoteId) {
  return apiRequest(`/proxy/quotes/links/products/${quoteId}?fields=Product Name,Unit Price`);
}
```

### 2. Use in Components

**React Example:**
```jsx
import { useState, useEffect } from 'react';
import { getQuotes, createQuote } from './api';

function QuotesList() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuotes();
  }, []);

  async function loadQuotes() {
    try {
      const data = await getQuotes();
      setQuotes(data.list || []);
    } catch (error) {
      console.error('Failed to load quotes:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    try {
      await createQuote({
        'Subject': 'Q-2024-001',
        'Quote Status': 'Draft',
        'Total Amount': '5000'
      });
      loadQuotes(); // Reload list
    } catch (error) {
      console.error('Failed to create quote:', error);
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={handleCreate}>Create Quote</button>
      {quotes.map(quote => (
        <div key={quote.id}>
          {quote.fields.Subject} - {quote.fields['Quote Status']}
        </div>
      ))}
    </div>
  );
}
```

**Vue Example:**
```vue
<template>
  <div>
    <button @click="handleCreate">Create Quote</button>
    <div v-for="quote in quotes" :key="quote.id">
      {{ quote.fields.Subject }} - {{ quote.fields['Quote Status'] }}
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { getQuotes, createQuote } from './api';

export default {
  setup() {
    const quotes = ref([]);

    async function loadQuotes() {
      const data = await getQuotes();
      quotes.value = data.list || [];
    }

    async function handleCreate() {
      await createQuote({
        'Subject': 'Q-2024-001',
        'Quote Status': 'Draft',
        'Total Amount': '5000'
      });
      loadQuotes();
    }

    onMounted(loadQuotes);

    return { quotes, handleCreate };
  }
};
</script>
```

---

## Discovering Available Tables and Operations

The proxy is **schema-driven** - available tables and operations are defined in `proxy/config/proxy.yaml`.

### How to Check What's Available

**Option 1: Check proxy.yaml**
```yaml
# proxy/config/proxy.yaml
tables:
  quotes:
    name: "Quotes"
    operations: [read, create, update, delete, link]
  
  products:
    name: "Products"
    operations: [read]
```

**Option 2: Use Introspection Endpoint**
```http
GET /__proxy/schema

Response:
{
  "tables": {
    "quotes": {
      "name": "Quotes",
      "table_id": "clkczb2ifl6l25g",
      "operations": ["read", "create", "update", "delete", "link"]
    },
    "products": {
      "name": "Products",
      "table_id": "tbl_abc123",
      "operations": ["read"]
    }
  }
}
```

### Operation Types

| Operation | HTTP Method | Endpoint Pattern | Description |
|-----------|-------------|------------------|-------------|
| `read` | GET | `/proxy/{table}/records` | List/view records |
| `create` | POST | `/proxy/{table}/records` | Create new records |
| `update` | PATCH | `/proxy/{table}/records/{id}` | Update existing records |
| `delete` | DELETE | `/proxy/{table}/records/{id}` | Delete records |
| `link` | POST | `/proxy/{table}/links/{field}/{id}` | Link related records |

### Example Configurations

**Read-Only Table:**
```yaml
products:
  name: "Products"
  operations: [read]
```
Users can view products but not modify them.

**Full Access Table:**
```yaml
quotes:
  name: "Quotes"
  operations: [read, create, update, delete, link]
```
Users can do everything with quotes.

**Create and Link Only:**
```yaml
orders:
  name: "Orders"
  operations: [create, link]
```
Users can create orders and link items, but can't view, update, or delete.

---

## How the Proxy Works Internally

Understanding the proxy's internal flow helps you build better frontends.

### Request Flow

```
Your Frontend
  ↓
1. Send request with JWT token
  ↓
Proxy: CORS Middleware
  ↓ (adds CORS headers)
Proxy: Auth Middleware
  ↓ (validates JWT token)
Proxy: Validator
  ↓ (checks if operation is allowed)
Proxy: MetaCache
  ↓ (translates "quotes" → "clkczb2ifl6l25g")
Proxy: Handler
  ↓ (forwards to NocoDB with master token)
NocoDB
  ↓ (processes request)
Proxy
  ↓ (forwards response back)
Your Frontend
```

### Name-to-ID Translation

The proxy maintains a **MetaCache** that automatically translates friendly names to NocoDB IDs:

```
Your Request:  GET /proxy/quotes/records
                         ↓
MetaCache:     "quotes" → "clkczb2ifl6l25g"
                         ↓
NocoDB Request: GET /api/v3/data/project/.../clkczb2ifl6l25g/records
```

**Key Points:**
- MetaCache fetches metadata from NocoDB on startup
- Auto-refreshes every 10 minutes
- Case-insensitive lookups
- If NocoDB IDs change, proxy adapts automatically

### Configuration-Driven Validation

Every request is validated against `proxy.yaml`:

```
Request: DELETE /proxy/quotes/records/123
           ↓
Validator checks:
  1. Is "quotes" table in config? ✓
  2. Is "delete" in allowed operations? ✗ (only [read, create])
  3. Block request → 403 Forbidden
```

This means:
- Only explicitly allowed operations work
- Different tables can have different permissions
- No code changes needed to adjust permissions

### Security Model

**Frontend has:**
- JWT token (temporary, user-specific, expires in 24 hours)

**Proxy has:**
- NocoDB master token (permanent, all-access)

**Why this matters:**
- If JWT is stolen, it expires quickly
- Frontend never sees NocoDB master token
- Each user has their own JWT with their user_id

---

## Proxy Configuration

The proxy behavior is controlled by two configuration files:

### 1. Environment Variables (.env)

```env
PORT=8080
NOCODB_URL=http://localhost:8090/api/v3/data/project/
NOCODB_TOKEN=your_nocodb_token
NOCODB_BASE_ID=your_base_id
JWT_SECRET=your_jwt_secret
DATABASE_PATH=./users.db
```

**What you need to know:**
- `PORT`: Where the proxy listens (default: 8080)
- `NOCODB_URL`: Your NocoDB instance URL
- JWT tokens are signed with `JWT_SECRET`

### 2. Proxy Schema (proxy.yaml)

```yaml
nocodb:
  base_id: "pbf7tt48gxdl50h"

tables:
  quotes:
    name: "Quotes"
    operations: [read, create, update, delete, link]
  
  products:
    name: "Products"
    operations: [read]
```

**What you need to know:**
- Defines which tables are accessible
- Defines which operations are allowed per table
- Uses human-readable table names (not IDs)
- Can be updated without code changes

### Adding New Tables

To make a new NocoDB table accessible:

1. Add to `proxy.yaml`:
```yaml
tables:
  my_new_table:
    name: "My New Table"
    operations: [read, create, update]
```

2. Restart proxy

3. Frontend can now use:
```javascript
GET /proxy/my_new_table/records
POST /proxy/my_new_table/records
PATCH /proxy/my_new_table/records/{id}
```

---

## Introspection Endpoints

The proxy provides endpoints to discover its configuration:

### Get Proxy Status
```http
GET /__proxy/status

Response:
{
  "mode": "schema-driven",
  "tables_count": 6,
  "metacache_ready": true,
  "last_refresh": "2024-12-23T08:30:00Z"
}
```

### Get Schema Information
```http
GET /__proxy/schema

Response:
{
  "base_id": "pbf7tt48gxdl50h",
  "tables": {
    "quotes": {
      "name": "Quotes",
      "table_id": "clkczb2ifl6l25g",
      "operations": ["read", "create", "update", "delete", "link"]
    }
  }
}
```

**Use these endpoints to:**
- Dynamically discover available tables
- Build generic admin interfaces
- Validate frontend code against proxy config
- Debug configuration issues

---

## Best Practices

### 1. Always Handle Errors

```javascript
try {
  const data = await getQuotes();
  // Success
} catch (error) {
  // Handle error
  console.error(error);
  showErrorMessage(error.message);
}
```

### 2. Store Token Securely

```javascript
// ✓ Good: localStorage (for web apps)
localStorage.setItem('token', token);

// ✓ Good: Secure storage (for mobile apps)
await SecureStore.setItemAsync('token', token);

// ✗ Bad: Plain cookies (vulnerable to XSS)
document.cookie = `token=${token}`;
```

### 3. Implement Token Refresh Logic

```javascript
// Check if token is expired before making request
function isTokenExpired(token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.exp * 1000 < Date.now();
}

if (isTokenExpired(token)) {
  // Redirect to login
  window.location.href = '/login';
}
```

### 4. Use Loading States

```javascript
const [loading, setLoading] = useState(false);

async function loadData() {
  setLoading(true);
  try {
    const data = await getQuotes();
    setQuotes(data.list);
  } finally {
    setLoading(false);
  }
}
```

### 5. Implement Retry Logic

```javascript
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### 6. Cache Data When Appropriate

```javascript
const cache = new Map();

async function getCachedQuotes() {
  if (cache.has('quotes')) {
    return cache.get('quotes');
  }
  
  const data = await getQuotes();
  cache.set('quotes', data);
  
  // Clear cache after 5 minutes
  setTimeout(() => cache.delete('quotes'), 5 * 60 * 1000);
  
  return data;
}
```

### 7. Validate Data Before Sending

```javascript
function validateQuote(quoteData) {
  if (!quoteData.Subject) {
    throw new Error('Subject is required');
  }
  if (!quoteData['Quote Status']) {
    throw new Error('Status is required');
  }
  if (quoteData['Total Amount'] && isNaN(quoteData['Total Amount'])) {
    throw new Error('Total Amount must be a number');
  }
}

async function createQuote(quoteData) {
  validateQuote(quoteData);
  return apiRequest('/proxy/quotes/records', {
    method: 'POST',
    body: JSON.stringify({ fields: quoteData })
  });
}
```

---

## Environment Configuration

Use environment variables for different environments:

```javascript
// .env.development
VITE_API_URL=http://localhost:8080

// .env.production
VITE_API_URL=https://api.yourcompany.com

// In code:
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
```

---

## Testing Your Integration

### 1. Test Authentication
```javascript
// Test login
const result = await login('user@example.com', 'password123');
console.log('Token:', result.token);
```

### 2. Test Data Fetching
```javascript
// Test getting quotes
const quotes = await getQuotes();
console.log('Quotes:', quotes);
```

### 3. Test Error Handling
```javascript
// Test with invalid token
localStorage.setItem('token', 'invalid');
try {
  await getQuotes();
} catch (error) {
  console.log('Error caught:', error.message);
}
```

---

## Framework-Agnostic Design

This proxy works with **any frontend technology** that can make HTTP requests:

### Web Frameworks
- React, Vue, Angular, Svelte
- Next.js, Nuxt.js, SvelteKit
- Vanilla JavaScript

### Mobile
- React Native, Flutter
- Swift (iOS), Kotlin (Android)

### Desktop
- Electron, Tauri
- .NET, Qt

### Other Languages
- Python, PHP, Ruby, Java, Go, Rust

**Why it works everywhere:**
- Standard REST API
- Standard HTTP methods
- Standard JSON responses
- Standard JWT authentication

---

## Key Concepts for Frontend Developers

### 1. The Proxy is Stateless

Each request is independent. The proxy doesn't maintain session state.

**What this means:**
- Include JWT token in every request
- No server-side sessions
- Easy to scale horizontally

### 2. Use Friendly Names, Not IDs

**Don't do this:**
```javascript
GET /proxy/clkczb2ifl6l25g/records  // ✗ Using NocoDB ID
```

**Do this:**
```javascript
GET /proxy/quotes/records  // ✓ Using friendly name
```

The proxy translates names to IDs automatically.

### 3. Operations are Whitelisted

If an operation isn't in the config, it won't work:

```yaml
products:
  operations: [read]  # Only read allowed
```

```javascript
POST /proxy/products/records  // ✗ 403 Forbidden
GET /proxy/products/records   // ✓ 200 OK
```

### 4. JWT Tokens Expire

Tokens expire after 24 hours. Always handle 401 errors:

```javascript
if (response.status === 401) {
  // Token expired - redirect to login
  redirectToLogin();
}
```

### 5. Field Names are Case-Sensitive

NocoDB field names must match exactly:

```javascript
// ✓ Correct
{ "Quote Status": "Draft" }

// ✗ Wrong
{ "quote status": "Draft" }
{ "QuoteStatus": "Draft" }
```

---

## Deployment Considerations

### Production Checklist

**Environment Variables:**
- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Use production NocoDB URL
- [ ] Use secure NocoDB token
- [ ] Set appropriate `PORT`

**CORS Configuration:**
- [ ] Update allowed origins in `internal/middleware/cors.go`
- [ ] Add your production frontend URL

**HTTPS:**
- [ ] Use HTTPS in production (not HTTP)
- [ ] Update frontend to use `https://` proxy URL

**Database:**
- [ ] Consider PostgreSQL instead of SQLite for production
- [ ] Backup `users.db` regularly

### Scaling

**Single Instance:**
- Handles ~1000 concurrent users
- MetaCache in memory
- SQLite database

**Multiple Instances:**
- Use load balancer
- Share JWT secret across instances
- Use PostgreSQL (not SQLite)
- Consider Redis for MetaCache

---

## Troubleshooting

### Common Issues

**401 Unauthorized**
- Token missing or invalid
- Token expired (24 hours)
- Wrong JWT secret

**403 Forbidden**
- Operation not allowed in config
- Table not in config
- Link field not found

**502 Bad Gateway**
- NocoDB is down
- Wrong NocoDB URL
- Network issue

**CORS Errors**
- Frontend origin not in allowed list
- Missing CORS headers
- Preflight request failed

### Debug Mode

Check proxy logs for detailed information:

```
[AUTH] Token valid for user: 123
[VALIDATOR] ✓ Operation 'read' is allowed
[META] Resolved table 'quotes' → 'clkczb2ifl6l25g'
[PROXY] Target URL: http://nocodb.../clkczb2ifl6l25g/records
```

---

## Summary

**To build a frontend that uses this proxy:**

1. **Understand the API**: REST endpoints, JWT auth, 7 request patterns
2. **Check Configuration**: Use `/__proxy/schema` to see available tables
3. **Implement Authentication**: Login/OAuth → Store JWT → Use in requests
4. **Handle Errors**: 401 (reauth), 403 (permission), 400 (validation)
5. **Use Friendly Names**: `quotes` not `clkczb2ifl6l25g`
6. **Follow Patterns**: List, get, create, update, delete, link, get-linked

**The proxy provides:**
- ✓ Secure authentication layer
- ✓ Automatic name-to-ID translation
- ✓ Config-driven permissions
- ✓ Hidden NocoDB credentials
- ✓ Consistent REST API

**Your frontend provides:**
- User interface and experience
- State management
- Data presentation
- Business logic
- User interactions

This separation creates a clean, secure, and maintainable architecture that works with any frontend technology!
