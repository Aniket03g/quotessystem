# Working With Any Frontend

The proxy is **framework-agnostic** - it works with any frontend technology that can make HTTP requests.

## Why It Works Everywhere

The proxy is just a **REST API**:
- Accepts HTTP requests (GET, POST, PATCH, DELETE)
- Returns JSON responses
- Uses standard authentication (JWT tokens)

Any frontend that can do these things can use the proxy!

## Supported Frontend Technologies

### ✅ JavaScript Frameworks
- React
- Vue.js
- Angular
- Svelte
- Next.js
- Nuxt.js
- Astro (your current one)
- Solid.js
- Qwik

### ✅ Mobile Apps
- React Native
- Flutter
- Swift (iOS)
- Kotlin (Android)
- Ionic
- Capacitor

### ✅ Desktop Apps
- Electron
- Tauri
- .NET (WPF, WinForms)
- Qt

### ✅ Other Languages
- Python (requests library)
- PHP (cURL)
- Ruby (Net::HTTP)
- Java (HttpClient)
- Go (net/http)
- Rust (reqwest)

### ✅ No-Code Tools
- Retool
- Bubble
- Webflow (with custom code)
- AppGyver

## Universal Integration Pattern

Every frontend follows the same pattern:

### Step 1: Configure Base URL
```
Point your API calls to: http://localhost:8080
```

### Step 2: Authenticate
```
POST /login
Get JWT token
Store token (localStorage, cookies, memory, etc.)
```

### Step 3: Make Requests
```
Include token in Authorization header
Call /proxy/* endpoints
Handle responses
```

That's it! The specifics depend on your framework, but the pattern is universal.

## Examples in Different Frameworks

### React Example

```jsx
// api.js
const API_BASE = 'http://localhost:8080';

export async function getQuotes() {
  const token = localStorage.getItem('token');
  
  const response = await fetch(`${API_BASE}/proxy/quotes/records`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
}

// QuotesList.jsx
import { useEffect, useState } from 'react';
import { getQuotes } from './api';

function QuotesList() {
  const [quotes, setQuotes] = useState([]);

  useEffect(() => {
    getQuotes().then(data => {
      setQuotes(data.list || []);
    });
  }, []);

  return (
    <div>
      {quotes.map(quote => (
        <div key={quote.id}>
          {quote.fields.Subject}
        </div>
      ))}
    </div>
  );
}
```

### Vue.js Example

```vue
<!-- QuotesList.vue -->
<template>
  <div>
    <div v-for="quote in quotes" :key="quote.id">
      {{ quote.fields.Subject }}
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return {
      quotes: []
    };
  },
  
  async mounted() {
    const token = localStorage.getItem('token');
    
    const response = await axios.get(
      'http://localhost:8080/proxy/quotes/records',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    this.quotes = response.data.list || [];
  }
};
</script>
```

### Angular Example

```typescript
// quotes.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class QuotesService {
  private apiBase = 'http://localhost:8080';

  constructor(private http: HttpClient) {}

  getQuotes() {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });

    return this.http.get(`${this.apiBase}/proxy/quotes/records`, { headers });
  }
}

// quotes.component.ts
import { Component, OnInit } from '@angular/core';
import { QuotesService } from './quotes.service';

@Component({
  selector: 'app-quotes',
  template: `
    <div *ngFor="let quote of quotes">
      {{ quote.fields.Subject }}
    </div>
  `
})
export class QuotesComponent implements OnInit {
  quotes: any[] = [];

  constructor(private quotesService: QuotesService) {}

  ngOnInit() {
    this.quotesService.getQuotes().subscribe(data => {
      this.quotes = data.list || [];
    });
  }
}
```

### Python Example (for backend-to-backend)

```python
import requests

API_BASE = 'http://localhost:8080'

# Login
response = requests.post(f'{API_BASE}/login', json={
    'email': 'user@example.com',
    'password': 'password123'
})
token = response.json()['token']

# Get quotes
response = requests.get(
    f'{API_BASE}/proxy/quotes/records',
    headers={'Authorization': f'Bearer {token}'}
)
quotes = response.json()

for quote in quotes.get('list', []):
    print(quote['fields']['Subject'])
```

### Mobile App Example (React Native)

```javascript
// api.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'http://localhost:8080';

export async function getQuotes() {
  const token = await AsyncStorage.getItem('token');
  
  const response = await fetch(`${API_BASE}/proxy/quotes/records`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
}

// QuotesScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { getQuotes } from './api';

function QuotesScreen() {
  const [quotes, setQuotes] = useState([]);

  useEffect(() => {
    getQuotes().then(data => {
      setQuotes(data.list || []);
    });
  }, []);

  return (
    <FlatList
      data={quotes}
      renderItem={({ item }) => (
        <View>
          <Text>{item.fields.Subject}</Text>
        </View>
      )}
      keyExtractor={item => item.id.toString()}
    />
  );
}
```

## Setting Up a New Frontend

Here's a step-by-step guide for any framework:

### Step 1: Create API Module

Create a file (e.g., `api.js`, `api.ts`, `api.py`) with:

```javascript
const API_BASE = 'http://localhost:8080';

// Authentication
export async function login(email, password) {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  // Store token in your preferred way
  localStorage.setItem('token', data.token);
  return data;
}

// Helper to get token
function getToken() {
  return localStorage.getItem('token');
}

// Generic request function
async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (response.status === 401) {
    // Token expired - redirect to login
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  return response.json();
}

// Specific API functions
export async function getQuotes() {
  return apiRequest('/proxy/quotes/records');
}

export async function createQuote(quoteData) {
  return apiRequest('/proxy/quotes/records', {
    method: 'POST',
    body: JSON.stringify({ fields: quoteData })
  });
}

export async function updateQuote(id, quoteData) {
  return apiRequest(`/proxy/quotes/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: quoteData })
  });
}

export async function linkProducts(quoteId, productIds) {
  return apiRequest(`/proxy/quotes/links/products/${quoteId}`, {
    method: 'POST',
    body: JSON.stringify(productIds.map(id => ({ id })))
  });
}
```

### Step 2: Use in Components

Import and use the API functions:

```javascript
import { getQuotes, createQuote } from './api';

// In your component
const quotes = await getQuotes();

// Create a new quote
await createQuote({
  'Subject': 'Q-2024-001',
  'Quote Status': 'Draft',
  'Total Amount': '5000'
});
```

### Step 3: Handle Errors

```javascript
try {
  const quotes = await getQuotes();
  // Success!
} catch (error) {
  if (error.message === 'Unauthorized') {
    // Redirect to login
  } else {
    // Show error message
    console.error('Failed to fetch quotes:', error);
  }
}
```

## CORS Configuration

If your frontend runs on a different domain/port, you need CORS enabled.

### Proxy CORS Settings

The proxy already has CORS configured in `internal/middleware/cors.go`:

```go
// Allowed origins
allowedOrigins := []string{
    "http://localhost:4321",  // Astro default
    "http://localhost:3000",  // React default
    "http://localhost:5173",  // Vite default
    "http://localhost:8000",  // Python default
}
```

### To Add Your Frontend's Origin:

1. Edit `proxy/internal/middleware/cors.go`
2. Add your origin to the `allowedOrigins` list
3. Rebuild and restart the proxy

Or use environment variables (if implemented):
```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4321
```

## Authentication Strategies

Different frontends store tokens differently:

### Browser (Web Apps)
```javascript
// localStorage (persists across sessions)
localStorage.setItem('token', token);

// sessionStorage (cleared when tab closes)
sessionStorage.setItem('token', token);

// Cookies (can be httpOnly for security)
document.cookie = `token=${token}; path=/`;
```

### Mobile Apps
```javascript
// React Native
import AsyncStorage from '@react-native-async-storage/async-storage';
await AsyncStorage.setItem('token', token);

// Flutter
import 'package:shared_preferences/shared_preferences.dart';
final prefs = await SharedPreferences.getInstance();
await prefs.setString('token', token);
```

### Desktop Apps
```javascript
// Electron
const { ipcRenderer } = require('electron');
ipcRenderer.send('store-token', token);
```

## Common API Patterns

These work the same in every framework:

### List Records
```
GET /proxy/{table}/records
Optional query params: ?limit=50&offset=0&fields=Field1,Field2
```

### Get Single Record
```
GET /proxy/{table}/records/{id}
```

### Create Record
```
POST /proxy/{table}/records
Body: { fields: { Field1: "value", Field2: "value" } }
```

### Update Record
```
PATCH /proxy/{table}/records/{id}
Body: { fields: { Field1: "new value" } }
```

### Delete Record
```
DELETE /proxy/{table}/records/{id}
```

### Link Records
```
POST /proxy/{table}/links/{linkField}/{recordId}
Body: [{ id: 1 }, { id: 2 }]
```

### Get Linked Records
```
GET /proxy/{table}/links/{linkField}/{recordId}
```

## Environment-Specific Configuration

Use environment variables for different environments:

### Development
```javascript
const API_BASE = process.env.API_URL || 'http://localhost:8080';
```

### Production
```javascript
const API_BASE = process.env.API_URL || 'https://api.yourcompany.com';
```

### Configuration Files

```javascript
// config.js
const config = {
  development: {
    apiUrl: 'http://localhost:8080'
  },
  production: {
    apiUrl: 'https://api.yourcompany.com'
  }
};

export default config[process.env.NODE_ENV || 'development'];
```

## Testing Your Integration

### 1. Test Authentication
```javascript
const result = await login('user@example.com', 'password123');
console.log('Token:', result.token);
```

### 2. Test Data Fetching
```javascript
const quotes = await getQuotes();
console.log('Quotes:', quotes);
```

### 3. Test Error Handling
```javascript
// Try with invalid token
localStorage.setItem('token', 'invalid');
try {
  await getQuotes();
} catch (error) {
  console.log('Error caught:', error.message);
}
```

## Key Takeaway

**The proxy works with any frontend because:**
- It's a standard REST API
- Uses common HTTP methods and JSON
- Follows universal authentication patterns (JWT)
- No framework-specific code required
- Same endpoints work everywhere

Whether you're building a React web app, a Flutter mobile app, or a Python script, the integration pattern is identical:

1. Configure API base URL
2. Authenticate and store token
3. Make requests with token in header
4. Handle responses

The proxy is your **universal data access layer** that works with any technology!

---

**Next:** [09-real-world-example.md](./09-real-world-example.md) - Let's walk through a complete real-world scenario.
