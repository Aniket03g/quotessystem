# Custom Unit Price Implementation Guide

## Overview
This system allows per-quote custom pricing using the `ProductsForQuotes` junction table, enabling price overrides without modifying the Products catalog.

---

## NocoDB Field Name Convention

### Important: Two Different Naming Contexts

1. **POST/PATCH Operations (Creating/Updating Records)**
   - Use friendly field names: `Quotes`, `Products`, `Quantity`, `Custom Unit Price`
   - NocoDB accepts display names in the `fields` object

2. **GET Operations with WHERE Clauses (Querying Records)**
   - Use internal link field IDs: `nc_76_d___Quotes_id`, `nc_76_d__Products_id`
   - Note the underscore difference:
     - `nc_76_d___Quotes_id` (3 underscores before Quotes)
     - `nc_76_d__Products_id` (2 underscores before Products)

---

## Complete Flow

### 1. Quote Creation (`quotes.astro`)

**Steps:**
1. Create quote record → returns `quoteId`
2. Link account to quote
3. Link products to quote
4. **Create ProductsForQuotes junction records**

**Code:**
```javascript
// Step 4: Create junction records with custom prices
await createProductsForQuotesRecords(quoteId, [
  { productId: 468, quantity: 1, unitPrice: 90000 },
  { productId: 533, quantity: 1, unitPrice: 30638 }
]);

// Function implementation
async function createProductsForQuotesRecords(quoteId, productData) {
  for (const item of productData) {
    const payload = {
      fields: {
        'Quotes': quoteId,              // Friendly name for POST
        'Products': item.productId,      // Friendly name for POST
        'Quantity': item.quantity,
        'Custom Unit Price': item.unitPrice
      }
    };
    
    await fetch(`${API_BASE_URL}/proxy/products_for_quotes/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
}
```

---

### 2. Quote Detail - Fetching (`quote-detail.astro`)

**Query:**
```javascript
// Fetch junction records using internal field IDs in WHERE clause
const junctionResponse = await fetch(
  `${API_BASE_URL}/proxy/products_for_quotes/records?where=(nc_76_d___Quotes_id,eq,${quoteId})&fields=Id,Quantity,Custom%20Unit%20Price,nc_76_d__Products_id`,
  {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  }
);
```

**Response Example:**
```json
{
  "records": [
    {
      "id": 7,
      "fields": {
        "nc_76_d__Products_id": 468,
        "Quantity": 1,
        "Custom Unit Price": 90000
      }
    },
    {
      "id": 8,
      "fields": {
        "nc_76_d__Products_id": 533,
        "Quantity": 1,
        "Custom Unit Price": 30638
      }
    }
  ]
}
```

**Data Merging:**
```javascript
// For each junction record, fetch product catalog details
const productDetailsPromises = junctionRecords.map(async (junctionRecord) => {
  const productId = junctionRecord.fields['nc_76_d__Products_id']; // Use internal field ID
  
  const productResponse = await fetch(
    `${API_BASE_URL}/proxy/products/records/${productId}?fields=Product Name,Unit Price,Brand,HSN Code,Model,Product Code,Tax,Description`
  );
  
  const productData = await safeJsonParse(productResponse);
  
  return {
    junctionId: junctionRecord.id,
    productId: productId,
    quantity: junctionRecord.fields['Quantity'] || 1,
    customUnitPrice: junctionRecord.fields['Custom Unit Price'],
    catalogUnitPrice: productData.fields['Unit Price'],
    productName: productData.fields['Product Name'],
    brand: productData.fields['Brand'],
    // ... other fields
  };
});

const productRecords = await Promise.all(productDetailsPromises);
```

---

### 3. Editing Line Items

**Update Quantity:**
```javascript
async function updateLineItemQuantity(junctionId, newQuantity) {
  await fetch(`${API_BASE_URL}/proxy/products_for_quotes/records`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: junctionId,
      fields: {
        'Quantity': newQuantity  // Friendly name for PATCH
      }
    })
  });
}
```

**Update Custom Price:**
```javascript
async function updateLineItemPrice(junctionId, newPrice) {
  await fetch(`${API_BASE_URL}/proxy/products_for_quotes/records`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: junctionId,
      fields: {
        'Custom Unit Price': newPrice  // Friendly name for PATCH
      }
    })
  });
}
```

**Remove Line Item:**
```javascript
async function removeLineItem(junctionId) {
  await fetch(`${API_BASE_URL}/proxy/products_for_quotes/records/${junctionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
}
```

---

### 4. Adding Products in Edit Mode

```javascript
async function linkProduct(productId) {
  // Step 1: Link product to quote (for compatibility)
  await fetch(`${API_BASE_URL}/proxy/quotes/links/products/${quoteId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([parseInt(productId)])
  });

  // Step 2: Create junction record with custom price
  const junctionPayload = {
    fields: {
      'Quotes': parseInt(quoteId),        // Friendly name
      'Products': parseInt(productId),    // Friendly name
      'Quantity': 1,
      'Custom Unit Price': catalogPrice
    }
  };

  await fetch(`${API_BASE_URL}/proxy/products_for_quotes/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(junctionPayload)
  });
}
```

---

## UI Features

### View Mode
- Displays products with custom prices (or catalog price as fallback)
- Shows: Product Name, Brand, Product Code, HSN Code, Quantity, Unit Price, Tax %, Subtotal

### Edit Mode
- **Quantity**: Editable input with 800ms debounce auto-save
- **Unit Price**: Editable input with 800ms debounce auto-save
- **Subtotal**: Auto-calculates (Quantity × Price × (1 + Tax%/100))
- **Remove Button**: Deletes junction record with confirmation
- **Add Product**: Search and add new products with catalog price as default

---

## Key Implementation Details

### Quote ID Handling
The `quoteId` is obtained from URL query parameter:
```javascript
const urlParams = new URLSearchParams(window.location.search);
const quoteId = urlParams.get('id');
```

This is the same pattern used throughout the application for accessing specific records.

### Total Calculation
```javascript
function calculateTotal() {
  return currentProducts.reduce((sum, product) => {
    const customPrice = Number(product.customUnitPrice);
    const catalogPrice = Number(product.catalogUnitPrice) || 0;
    const unitPrice = customPrice || catalogPrice;  // Use custom if available
    const quantity = Number(product.quantity) || 1;
    const taxRate = Number(product.tax) || 0;
    
    const subtotal = unitPrice * quantity;
    const taxAmount = subtotal * (taxRate / 100);
    return sum + subtotal + taxAmount;
  }, 0);
}
```

### Fallback Mechanism
If the junction table query fails, the system falls back to the old direct links method:
```javascript
if (junctionResponse.ok) {
  // Use junction table data
} else {
  // Fallback to /proxy/quotes/links/products/{quoteId}
}
```

---

## Logging

All operations include comprehensive logging:
- `[QUOTE]` - Quote creation operations
- `[QUOTE DETAIL]` - Quote detail page operations
- `[LINE ITEM]` - Line item update/delete operations
- `[ADD PRODUCT]` - Adding products in edit mode

Example:
```javascript
console.log('[QUOTE DETAIL] Fetching ProductsForQuotes junction records...');
console.log('[QUOTE DETAIL] Junction records fetched:', junctionRecords.length);
console.log('[QUOTE DETAIL] Sample junction record:', junctionRecords[0]);
console.log(`[LINE ITEM] Updating quantity for junction ${junctionId} to ${newQuantity}`);
```

---

## API Endpoints Summary

| Operation | Method | Endpoint | Field Names |
|-----------|--------|----------|-------------|
| Create junction record | POST | `/proxy/products_for_quotes/records` | Friendly names in `fields` |
| Query junction records | GET | `/proxy/products_for_quotes/records?where=(nc_76_d___Quotes_id,eq,{id})` | Internal IDs in `where` |
| Update junction record | PATCH | `/proxy/products_for_quotes/records` | Friendly names in `fields` |
| Delete junction record | DELETE | `/proxy/products_for_quotes/records/{id}` | N/A |
| Get product details | GET | `/proxy/products/records/{id}` | N/A |

---

## Testing Checklist

- [ ] Create new quote with products → Verify junction records created
- [ ] View quote detail → Verify products display with custom prices
- [ ] Edit mode: Update quantity → Verify auto-save and total recalculation
- [ ] Edit mode: Update price → Verify auto-save and total recalculation
- [ ] Edit mode: Remove product → Verify junction record deleted
- [ ] Edit mode: Add product → Verify junction record created with catalog price
- [ ] Verify logging in browser console for all operations
- [ ] Test fallback when junction table unavailable
- [ ] Verify PDF generation still works with merged data
