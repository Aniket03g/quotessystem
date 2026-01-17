# Automatic Pagination Handling

## Overview
The proxy layer now automatically handles paginated responses from NocoDB, fetching all pages and combining them into a single response. This is transparent to the frontend - it makes a single request and receives all records.

---

## How It Works

### Detection
When the proxy receives a GET request to any `/records` endpoint and NocoDB returns a paginated response with a `next` key, the proxy automatically:

1. Detects the `next` URL in the response
2. Fetches all subsequent pages
3. Combines all `records` arrays
4. Returns a single unified response to the frontend

### Example Flow

**Frontend Request:**
```
GET /proxy/quotes/records
```

**NocoDB Response (Page 1):**
```json
{
  "records": [
    { "id": 1, "fields": { "Subject": "Quote 1" } },
    { "id": 2, "fields": { "Subject": "Quote 2" } }
  ],
  "next": "http://100.103.198.65:8090/api/v3/data/pbf7tt48gxdl50h/mqsc4pb7g3vj2ex/records?page=2",
  "nestedNext": null
}
```

**Proxy automatically fetches Page 2, Page 3, etc. until no `next` key exists**

**Final Response to Frontend:**
```json
{
  "records": [
    { "id": 1, "fields": { "Subject": "Quote 1" } },
    { "id": 2, "fields": { "Subject": "Quote 2" } },
    { "id": 3, "fields": { "Subject": "Quote 3" } },
    { "id": 4, "fields": { "Subject": "Quote 4" } },
    // ... all records from all pages
  ],
  "next": null,
  "nestedNext": null
}
```

---

## Implementation Details

### Location
`proxy/internal/proxy/handler.go`

### Key Function: `handlePagination`

```go
func (p *ProxyHandler) handlePagination(initialBody []byte, initialURL string) ([]byte, error)
```

**Logic:**
1. Parse the initial response JSON
2. Check for `records` array and `next` key
3. If `next` exists, fetch the next page with authentication
4. Append records from each page to the combined array
5. Continue until `next` is empty or null
6. Return combined response with all records and `next: null`

### Trigger Conditions
Pagination handling is triggered when **ALL** of the following are true:
- HTTP method is `GET`
- Response status code is `200`
- Request path contains `/records`
- Response body is valid JSON
- Response contains a `records` array
- Response contains a non-empty `next` key

### Error Handling
If pagination fails at any point:
- Logs the error with `[PAGINATION ERROR]` prefix
- Stops fetching additional pages
- Returns all records collected up to that point
- Does not fail the entire request

---

## Logging

All pagination operations are logged with the `[PAGINATION]` prefix:

```
[PAGINATION] Detected paginated response, initial records: 25
[PAGINATION] Fetching page 2 from: http://...?page=2
[PAGINATION] Page 2 fetched: 25 records
[PAGINATION] Fetching page 3 from: http://...?page=3
[PAGINATION] Page 3 fetched: 15 records
[PAGINATION] No more pages after page 3
[PAGINATION] Complete: fetched 3 pages with 65 total records
```

---

## Benefits

### For Frontend
- **No code changes required** - existing API calls work as-is
- **Single request** - no need to implement pagination logic
- **Complete data** - always receives all records
- **Simplified logic** - no page tracking or loop handling

### For Backend
- **Centralized logic** - pagination handled in one place
- **Consistent behavior** - all GET /records endpoints benefit
- **Transparent** - works with any NocoDB table
- **Efficient** - only fetches when pagination exists

---

## Performance Considerations

### When Pagination Occurs
- Only for GET requests to `/records` endpoints
- Only when NocoDB returns paginated results
- Typically happens when record count exceeds NocoDB's page size (default: 25)

### Network Impact
- Multiple sequential requests to NocoDB (one per page)
- Each request includes authentication token
- Total time = (number of pages × average request time)

### Memory Impact
- All records held in memory during combination
- JSON parsing/marshaling for each page
- Final combined response sent to frontend

### Optimization Opportunities
If needed in the future:
- Parallel page fetching (with rate limiting)
- Streaming response to frontend
- Configurable max pages limit
- Caching for frequently accessed paginated data

---

## Testing

### Test Scenarios

1. **Single Page Response (No Pagination)**
   - Request returns < 25 records
   - No `next` key present
   - Response returned as-is

2. **Multi-Page Response**
   - Request returns paginated data
   - Proxy fetches all pages
   - Combined response contains all records

3. **Error During Pagination**
   - Page 2 fetch fails
   - Returns records from page 1 only
   - Logs error but doesn't fail request

4. **Non-JSON Response**
   - Response is not JSON (e.g., file download)
   - Pagination skipped
   - Response returned as-is

### Manual Testing

```bash
# Test with quotes endpoint
curl -H "Authorization: Bearer <token>" \
  http://localhost:8080/proxy/quotes/records

# Check logs for pagination messages
# Verify all records are returned in single response
```

---

## Configuration

Currently, pagination is **always enabled** for GET /records requests. No configuration needed.

Future configuration options could include:
- Enable/disable pagination per table
- Max pages limit
- Timeout for pagination requests
- Parallel fetch settings

---

## Compatibility

### Works With
- All NocoDB tables with `/records` endpoints
- Quotes, Products, Accounts, Contacts, etc.
- Any GET request that returns paginated results

### Does Not Affect
- POST, PATCH, DELETE requests
- Link endpoints (`/links/...`)
- Single record fetches (`/records/{id}`)
- Non-paginated responses

---

## Migration Notes

### Before This Feature
Frontend had to:
```javascript
let allQuotes = [];
let nextUrl = '/proxy/quotes/records';

while (nextUrl) {
  const response = await fetch(nextUrl);
  const data = await response.json();
  allQuotes = [...allQuotes, ...data.records];
  nextUrl = data.next;
}
```

### After This Feature
Frontend simply:
```javascript
const response = await fetch('/proxy/quotes/records');
const data = await response.json();
const allQuotes = data.records; // Already contains all records
```

---

## Future Enhancements

1. **Configurable Pagination**
   - Add config option to enable/disable per table
   - Set max pages limit to prevent excessive fetching

2. **Performance Optimization**
   - Parallel page fetching with concurrency control
   - Response streaming to reduce memory usage

3. **Caching**
   - Cache paginated results with TTL
   - Invalidate on write operations

4. **Metrics**
   - Track pagination frequency
   - Monitor page counts and fetch times
   - Alert on excessive pagination

---

## Code Reference

### Modified Files
- `proxy/internal/proxy/handler.go`
  - Added `encoding/json` import
  - Added `handlePagination()` method
  - Modified `ServeHTTP()` to call pagination handler

### Key Code Sections

**Pagination Trigger (line ~168):**
```go
if r.Method == "GET" && resp.StatusCode == 200 && strings.Contains(path, "/records") {
    body, err = p.handlePagination(body, targetURL)
    // ...
}
```

**Pagination Loop (line ~232):**
```go
for currentNextURL != "" {
    // Fetch next page
    // Parse response
    // Append records
    // Check for next URL
}
```

**Response Combination (line ~295):**
```go
response["records"] = allRecords
response["next"] = nil
combinedBody, err := json.Marshal(response)
```
