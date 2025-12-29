import { getToken, safeJsonParse, logout } from './api';

const API_BASE_URL = typeof window !== 'undefined' 
  ? `http://${window.location.hostname}:8080` 
  : 'http://localhost:8080';

/**
 * Quote details structure returned by this module
 */
export interface QuoteDetails {
  quoteId: number;
  account: {
    name: string | null;
  };
  products: Array<{
    name: string;
    price?: number;
  }>;
}

/**
 * NocoDB record structure for linked data
 */
interface LinkedRecord {
  id: number;
  fields: {
    [key: string]: any;
  };
}

/**
 * Response structure from link endpoints
 */
interface LinkResponse {
  list?: LinkedRecord[];
  records?: LinkedRecord[];
}

/**
 * Fetch linked account for a quote
 * Uses the same alias-based routing as quote creation flow
 * 
 * Route: GET /proxy/quotes/links/accounts_copy/{quoteId}
 * - 'accounts_copy' is a frontend alias
 * - Proxy resolves this to the actual NocoDB link field ID
 * - Returns the account linked to this quote via the junction table
 */
async function fetchLinkedAccount(quoteId: number, token: string): Promise<{ name: string | null }> {
  try {
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

    if (response.status === 401) {
      logout();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      console.warn(`Failed to fetch linked account for quote ${quoteId}`);
      return { name: null };
    }

    const data: LinkResponse = await safeJsonParse(response);
    
    // Handle both possible response structures (list or records array)
    const records = data.list || data.records || [];
    
    // Return first account if exists (quotes typically have one account)
    if (records.length > 0) {
      return {
        name: records[0].fields['Account Name'] || null
      };
    }

    return { name: null };
  } catch (error) {
    console.error('Error fetching linked account:', error);
    return { name: null };
  }
}

/**
 * Fetch linked products for a quote
 * Uses the same alias-based routing as quote creation flow
 * 
 * Route: GET /proxy/quotes/links/products/{quoteId}
 * - 'products' is a frontend alias
 * - Proxy resolves this to the actual NocoDB link field ID
 * - Returns all products linked to this quote
 */
async function fetchLinkedProducts(
  quoteId: number,
  token: string
): Promise<Array<{ name: string; price?: number }>> {
  try {
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

    if (response.status === 401) {
      logout();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      console.warn(`Failed to fetch linked products for quote ${quoteId}`);
      return [];
    }

    const data: LinkResponse = await safeJsonParse(response);
    
    // Handle both possible response structures (list or records array)
    const records = data.list || data.records || [];
    
    // Map to clean product structure
    return records.map(record => ({
      name: record.fields['Product Name'] || 'Unnamed Product',
      price: record.fields['Unit Price'] 
        ? parseFloat(String(record.fields['Unit Price'])) 
        : undefined
    }));
  } catch (error) {
    console.error('Error fetching linked products:', error);
    return [];
  }
}

/**
 * Fetch complete quote details including linked account and products
 * 
 * This function mirrors the quote creation flow:
 * 1. During creation: POST quote → Link account → Link products
 * 2. During reading: GET quote → GET linked account → GET linked products
 * 
 * Uses the same proxy link routes with frontend aliases:
 * - /proxy/quotes/links/accounts_copy/{quoteId}
 * - /proxy/quotes/links/products/{quoteId}
 * 
 * The proxy internally resolves these aliases to actual NocoDB link field IDs,
 * maintaining consistency with the creation flow without hardcoding IDs.
 * 
 * @param quoteId - The ID of the quote to fetch details for
 * @returns Promise<QuoteDetails> - Complete quote details with account and products
 * @throws Error if authentication fails or quote doesn't exist
 */
export async function getQuoteDetails(quoteId: number): Promise<QuoteDetails> {
  const token = getToken();
  
  if (!token) {
    throw new Error('No authentication token found');
  }

  // Fetch account and products in parallel for better performance
  // Both requests are independent and can be executed simultaneously
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
