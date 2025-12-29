# Request Flow: From Frontend to Database

Let's follow a complete request through the entire system, step by step.

## Example: Creating a New Quote

We'll trace what happens when a user creates a quote in the frontend.

## The Journey Begins

### Step 1: User Action (Frontend)
```
User fills out form:
- Subject: "Q-2024-001"
- Status: "Draft"
- Total: "$5,000"

User clicks "Create Quote" button
```

### Step 2: Frontend Makes API Call
```javascript
// File: frontend/src/lib/api.ts
const response = await fetch('http://localhost:8080/proxy/quotes/records', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fields: {
      'Subject': 'Q-2024-001',
      'Quote Status': 'Draft',
      'Total Amount': '5000'
    }
  })
});
```

**Notice:**
- URL uses friendly name: `/proxy/quotes/records`
- Authorization header contains JWT token
- Body uses human-readable field names

### Step 3: Request Hits the Proxy Server
```
[PROXY] Incoming request: POST /proxy/quotes/records
```

The request enters the proxy at `http://localhost:8080`

### Step 4: CORS Middleware (First Layer)
```
[CORS] Checking request origin...
[CORS] Origin: http://localhost:4321
[CORS] ✓ Allowed origin
[CORS] Adding CORS headers to response
```

**What it does:**
- Checks if the frontend is allowed to make requests
- Adds headers like `Access-Control-Allow-Origin`
- Prevents unauthorized websites from accessing your API

### Step 5: Auth Middleware (Second Layer)
```
[AUTH] Checking authorization header...
[AUTH] Found token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
[AUTH] Validating JWT token...
[AUTH] ✓ Token valid
[AUTH] User ID: user-001
[AUTH] User Role: user
[AUTH] Proceeding to next handler...
```

**What it does:**
- Extracts the JWT token from the Authorization header
- Validates the token signature
- Checks if the token is expired
- Extracts user information (ID, role)
- Blocks request if token is invalid

### Step 6: Proxy Handler (Core Logic)
```
[PROXY] Extracted path: quotes/records
[PROXY] Using config-driven validation
```

The proxy now needs to translate and validate the request.

### Step 7: Validator Checks Configuration
```
[VALIDATOR] Validating request...
[VALIDATOR] Method: POST
[VALIDATOR] Path: quotes/records
[VALIDATOR] Looking up table 'quotes' in configuration...
[VALIDATOR] ✓ Table 'quotes' found in config
[VALIDATOR] Checking allowed operations for 'quotes'...
[VALIDATOR] Allowed operations: [read, create, update, delete, link]
[VALIDATOR] ✓ Operation 'create' is allowed
```

**What it checks:**
- Is the table defined in `proxy.yaml`?
- Is the operation (create) allowed for this table?
- If not, block the request with 403 Forbidden

### Step 8: MetaCache Translation
```
[META] Resolving table 'quotes'...
[META] Found: 'quotes' → 'clkczb2ifl6l25g'
[VALIDATOR] Resolved path: clkczb2ifl6l25g/records
```

**What happens:**
- Validator asks MetaCache: "What's the ID for 'quotes'?"
- MetaCache looks it up in its dictionary
- Returns the NocoDB table ID

### Step 9: Construct NocoDB Request
```
[PROXY] Target URL: http://localhost:8090/api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/records
[PROXY] Created proxy request successfully
```

The proxy builds the final URL:
- Base: `http://localhost:8090/api/v3/data/project/`
- Project ID: `pbf7tt48gxdl50h`
- Table ID: `clkczb2ifl6l25g` (translated from "quotes")
- Endpoint: `/records`

### Step 10: Add NocoDB Authentication
```
[PROXY] Added xc-token header
```

The proxy adds NocoDB's authentication token:
- Removes the JWT token (frontend authentication)
- Adds `xc-token` header (NocoDB authentication)
- This keeps the NocoDB token secret from the frontend!

### Step 11: Forward to NocoDB
```
[PROXY] Executing request to NocoDB...

POST http://localhost:8090/api/v3/data/project/pbf7tt48gxdl50h/clkczb2ifl6l25g/records
Headers:
  xc-token: your_nocodb_token_here
  Content-Type: application/json
Body:
  {
    "fields": {
      "Subject": "Q-2024-001",
      "Quote Status": "Draft",
      "Total Amount": "5000"
    }
  }
```

### Step 12: NocoDB Processes Request
```
[NocoDB] Received POST request
[NocoDB] Table: clkczb2ifl6l25g (Quotes)
[NocoDB] Validating fields...
[NocoDB] Creating record...
[NocoDB] Record created with ID: 123
```

NocoDB:
- Validates the data
- Inserts a new row in the database
- Returns the created record

### Step 13: NocoDB Responds
```
[NocoDB] Sending response...

HTTP 200 OK
{
  "id": 123,
  "fields": {
    "Subject": "Q-2024-001",
    "Quote Status": "Draft",
    "Total Amount": "5000",
    "Created Date": "2024-12-23T08:30:00Z"
  }
}
```

### Step 14: Proxy Receives Response
```
[PROXY] NocoDB responded with status: 200 OK
[PROXY] Response body length: 245 bytes
[PROXY] Response body: {"id":123,"fields":{...}}
```

### Step 15: Proxy Forwards Response to Frontend
```
[PROXY] Request completed successfully

HTTP 200 OK
Headers:
  Content-Type: application/json
  Access-Control-Allow-Origin: http://localhost:4321
Body:
  {
    "id": 123,
    "fields": {
      "Subject": "Q-2024-001",
      "Quote Status": "Draft",
      "Total Amount": "5000",
      "Created Date": "2024-12-23T08:30:00Z"
    }
  }
```

### Step 16: Frontend Receives Response
```javascript
// Frontend code continues...
const data = await response.json();
console.log('Quote created:', data.id); // 123

// Update UI
showSuccessMessage('Quote created successfully!');
redirectTo(`/quotes/${data.id}`);
```

## Visual Flow Diagram

```
User (Browser)
    ↓ [1. Click "Create Quote"]
    ↓
Frontend (JavaScript)
    ↓ [2. POST /proxy/quotes/records + JWT token]
    ↓
Proxy Server (Port 8080)
    ↓ [3. CORS Check] ✓
    ↓ [4. Auth Check] ✓
    ↓ [5. Validate Operation] ✓
    ↓ [6. Translate "quotes" → "clkczb2ifl6l25g"]
    ↓ [7. Add NocoDB token]
    ↓ [8. Forward request]
    ↓
NocoDB (Port 8090)
    ↓ [9. Create record in database]
    ↓ [10. Return created record]
    ↓
Proxy Server
    ↓ [11. Forward response]
    ↓
Frontend
    ↓ [12. Update UI]
    ↓
User sees success message! 🎉
```

## What If Something Goes Wrong?

### Scenario 1: Invalid Token
```
Step 5: Auth Middleware
[AUTH] Token validation failed: token expired
[AUTH] ❌ Blocking request

Response to Frontend:
HTTP 401 Unauthorized
{"error": "unauthorized"}

Frontend:
- Redirects user to login page
- User logs in again
- Gets new token
- Tries again
```

### Scenario 2: Operation Not Allowed
```
Step 7: Validator
[VALIDATOR] Operation 'delete' is NOT allowed for 'quotes'
[VALIDATOR] ❌ Blocking request

Response to Frontend:
HTTP 403 Forbidden
{"error": "forbidden: operation 'delete' not allowed for table 'quotes'"}

Frontend:
- Shows error message
- "You don't have permission to delete quotes"
```

### Scenario 3: Table Doesn't Exist
```
Step 8: MetaCache Translation
[META] Table 'unicorns' not found in cache
[VALIDATOR] ❌ Blocking request

Response to Frontend:
HTTP 403 Forbidden
{"error": "forbidden: table 'unicorns' not found in configuration"}

Frontend:
- Shows error message
- "Invalid request"
```

### Scenario 4: NocoDB Error
```
Step 12: NocoDB Processing
[NocoDB] Validation error: 'Total Amount' must be a number
[NocoDB] Returning error

Step 14: Proxy Receives Error
[PROXY] NocoDB error response (status 400): {"error": "Invalid field value"}

Step 15: Proxy Forwards Error
HTTP 400 Bad Request
{"error": "Invalid field value"}

Frontend:
- Shows validation error
- "Please enter a valid amount"
```

## Key Takeaway

**A request goes through multiple layers:**

1. **Frontend** - User-friendly interface
2. **CORS** - Security check for origins
3. **Auth** - User authentication
4. **Validator** - Operation permission check
5. **MetaCache** - Name-to-ID translation
6. **Proxy** - Request forwarding
7. **NocoDB** - Database operations
8. **Response flows back** through all layers

Each layer has a specific job, making the system secure, maintainable, and flexible!

---

**Next:** [06-configuration-system.md](./06-configuration-system.md) - Let's understand how the proxy knows what to allow.
