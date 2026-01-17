# Quote Operations - API Request Timeline

## 1. Create New Quote

**Sequence:**
```
POST /proxy/quotes/records
  ↓
POST /proxy/quotes/links/accounts_copy/{quoteId}
  ↓
POST /proxy/quotes/links/products/{quoteId}
  ↓
POST /proxy/products_for_quotes/records (for each product)
```

**Details:**
1. **Create Quote Record**
   - `POST /proxy/quotes/records`
   - Body: `{ fields: { Subject, Quote Status, Quote Version, Quote Date, Valid Until, Total Amount, Notes, Quote Created By } }`
   - Returns: `quoteId`

2. **Link Account to Quote**
   - `POST /proxy/quotes/links/accounts_copy/{quoteId}`
   - Body: `[{ id: accountId }]`

3. **Link Products to Quote**
   - `POST /proxy/quotes/links/products/{quoteId}`
   - Body: `[{ id: productId1 }, { id: productId2 }, ...]`

4. **Create Junction Records (Custom Pricing)**
   - `POST /proxy/products_for_quotes/records` (repeated for each product)
   - Body: `{ fields: { Quotes: quoteId, Products: productId, Quantity: qty, Custom Unit Price: price } }`

---

## 2. Quote Detail Page Load

**Sequence:**
```
GET /proxy/quotes/records/{quoteId}
  ↓
GET /proxy/quotes/links/accounts_copy/{quoteId}
  ↓
GET /proxy/quotes/links/products/{quoteId}
  ↓
GET /proxy/products_for_quotes/records?where=(nc_76_d___Quotes_id,eq,{quoteId})
```

**Details:**
1. **Fetch Quote Details**
   - `GET /proxy/quotes/records/{quoteId}`
   - Returns: Quote fields (Subject, Status, Date, Total Amount, etc.)

2. **Fetch Linked Account**
   - `GET /proxy/quotes/links/accounts_copy/{quoteId}?fields=Account Name,Phone,Billing Street,Billing City`
   - Returns: Account details

3. **Fetch Linked Products (Catalog Data)**
   - `GET /proxy/quotes/links/products/{quoteId}?fields=Id,Product Name,Brand,HSN Code,Model,Product Code,Tax,Description`
   - Returns: Product catalog information **WITHOUT Unit Price**

4. **Fetch Custom Pricing (Junction Data)**
   - `GET /proxy/products_for_quotes/records?where=(nc_76_d___Quotes_id,eq,{quoteId})&fields=Id,Quantity,Custom Unit Price,nc_76_d__Products_id`
   - Returns: Junction records with custom prices and quantities
   - Frontend merges this with catalog data by product ID

---

## 3. Edit Custom Unit Price

**Sequence:**
```
PATCH /proxy/products_for_quotes/records
  ↓
PATCH /proxy/quotes/records
  ↓
GET /proxy/quotes/records/{quoteId}
  ↓
GET /proxy/quotes/links/accounts_copy/{quoteId}
  ↓
GET /proxy/quotes/links/products/{quoteId}
  ↓
GET /proxy/products_for_quotes/records?where=(nc_76_d___Quotes_id,eq,{quoteId})
```

**Details:**
1. **Update Junction Record (Custom Price)**
   - `PATCH /proxy/products_for_quotes/records`
   - Body: `{ id: junctionId, fields: { Custom Unit Price: newPrice } }`
   - Updates the custom price for that product in the junction table

2. **Update Quote Total**
   - `PATCH /proxy/quotes/records`
   - Body: `{ id: quoteId, fields: { Total Amount: newTotal } }`
   - Recalculates and updates the quote's total amount

3. **Reload Quote Details** (steps 1-4 from "Quote Detail Page Load")
   - Fetches fresh data to display updated values

---

## 4. Edit Quantity

**Sequence:** (Same as Edit Custom Unit Price)
```
PATCH /proxy/products_for_quotes/records
  ↓
PATCH /proxy/quotes/records
  ↓
(Reload sequence)
```

**Details:**
1. **Update Junction Record (Quantity)**
   - `PATCH /proxy/products_for_quotes/records`
   - Body: `{ id: junctionId, fields: { Quantity: newQty } }`

2. **Update Quote Total**
   - `PATCH /proxy/quotes/records`
   - Body: `{ id: quoteId, fields: { Total Amount: newTotal } }`

3. **Reload Quote Details**

---

## Key Observations from Logs

### Successful Flow (from your logs):
```
15:08:40 - GET /proxy/quotes/records/53 (380 bytes)
15:08:40 - GET /proxy/quotes/links/accounts_copy/53 (304 Not Modified - cached)
15:08:40 - GET /proxy/quotes/links/products/53 (304 Not Modified - cached)
15:08:41 - GET /proxy/products_for_quotes/records (203 bytes, 2 records)

15:09:09 - PATCH /proxy/products_for_quotes/records (update price to 40638)
15:09:09 - PATCH /proxy/quotes/records (update total to 160052.84)

15:09:10 - GET /proxy/quotes/records/53 (reload)
15:09:10 - GET /proxy/quotes/links/accounts_copy/53 (304 cached)
15:09:10 - GET /proxy/quotes/links/products/53 (304 cached)
15:09:10 - GET /proxy/products_for_quotes/records (203 bytes, updated data)
```

### Timing:
- Initial page load: ~454ms (quote) + ~207ms (junction) = **~661ms total**
- Price update: ~388ms (junction) + ~128ms (quote) = **~516ms total**
- Reload after update: ~101ms (quote) + ~92ms (junction) = **~193ms total** (faster due to caching)

---

## Data Flow Architecture

### Old Method (Deprecated):
```
Quotes Table ←→ Products Table (with Unit Price from catalog)
```
- Problem: Can't have different prices per quote

### New Method (Current):
```
Quotes Table ←→ ProductsForQuotes Junction ←→ Products Table
                 (Custom Unit Price)           (Catalog data)
```
- Junction stores: Quotes link, Products link, Quantity, Custom Unit Price
- Catalog stores: Product Name, Brand, HSN, Model, Tax, Description
- Frontend merges by product ID

---

## Request Count Summary

| Operation | Total Requests | Write Requests | Read Requests |
|-----------|----------------|----------------|---------------|
| Create Quote | 4+ | 4+ (1 quote + 1 link account + 1 link products + N junction records) | 0 |
| Load Quote Detail | 4 | 0 | 4 (quote + account + products + junction) |
| Edit Price/Qty | 6 | 2 (junction + quote total) | 4 (reload) |

---

## Pagination Handling

**Automatic in Proxy Layer:**
- Any `GET /records` request with paginated response
- Proxy detects `next` key in JSON
- Automatically fetches all pages
- Returns combined records to frontend
- Frontend sees single response with all data

**Example from logs:**
```
[PAGINATION] Detected paginated response, initial records: 25
[PAGINATION] Fetching page 2 from: ...?page=2
[PAGINATION] Page 2 fetched: 6 records
[PAGINATION] Complete: fetched 2 pages with 31 total records
```

---

## HTTP Status Codes

- **200 OK** - Successful request with data
- **304 Not Modified** - Browser cache hit (no data transfer needed)
- **403 Forbidden** - Validation failed (operation not allowed)
- **502 Bad Gateway** - Proxy couldn't reach NocoDB

---

## Config Requirements

**proxy.yaml:**
```yaml
products_for_quotes:
  name: "ProductsForQuotes"
  operations: [read, update, create, link]  # 'update' required for price edits
```
