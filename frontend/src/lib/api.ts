const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL || 'http://localhost:8080';

interface LoginResponse {
  token: string;
  user_id: string;
  role: string;
}

interface Quote {
  id: number;
  customer: string;
  amount: number;
  created_by?: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  tax?: number;
  brand?: string;
  category?: string;
  active?: boolean;
  created_by?: string;
}

// NocoDB raw response structure
interface NocoDBRecord {
  id: number;
  fields: {
    'Product Name'?: string;
    'Unit Price'?: string | number;
    'Tax'?: string | number;
    'Brand'?: string;
    'Product Category'?: string;
    'Active'?: boolean;
    [key: string]: any;
  };
}

interface NocoDBResponse {
  records: NocoDBRecord[];
}

interface RecordsResponse<T> {
  list: T[];
  pageInfo: {
    totalRows: number;
    page: number;
    pageSize: number;
  };
}

/**
 * Safely parse JSON response with error handling
 * Prevents "Unexpected non-whitespace character" errors
 * Handles HTTP 304 Not Modified responses explicitly
 */
export async function safeJsonParse<T = any>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');
  
  // HTTP 304 Not Modified: Resource hasn't changed, no body to parse
  // Return null to indicate cached data should be used
  if (response.status === 304) {
    console.log('[HTTP 304] Not Modified - using cached data');
    return null as T;
  }
  
  if (!response.ok) {
    const text = await response.text();
    
    // Try to parse as JSON for error messages
    try {
      const errorData = JSON.parse(text);
      throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
    } catch (e) {
      // If not JSON, throw with status and text
      if (response.status === 404) {
        throw new Error('API endpoint not found — backend proxy route mismatch');
      }
      throw new Error(`Request failed (${response.status}): ${text.substring(0, 200)}`);
    }
  }
  
  // Read response as text first
  const text = await response.text();
  
  // Check if response is empty (but not 304 which we already handled)
  if (!text || text.trim() === '') {
    throw new Error('Empty response from server');
  }
  
  // Check if content type indicates JSON
  if (contentType && !contentType.includes('application/json')) {
    console.warn(`Expected JSON but got ${contentType}`);
    throw new Error(`Server returned ${contentType} instead of JSON. Response: ${text.substring(0, 200)}`);
  }
  
  // Try to parse as JSON
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('[JSON Parse Error] Raw response:', text.substring(0, 500));
    throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

interface QuotesResponse {
  list: Quote[];
  pageInfo: {
    totalRows: number;
    page: number;
    pageSize: number;
  };
}

// Store JWT in localStorage
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jwt_token');
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('jwt_token', token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('jwt_token');
}

export function getUserInfo(): { user_id: string; role: string } | null {
  if (typeof window === 'undefined') return null;
  const userInfo = localStorage.getItem('user_info');
  return userInfo ? JSON.parse(userInfo) : null;
}

export function setUserInfo(user_id: string, role: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('user_info', JSON.stringify({ user_id, role }));
}

export function clearUserInfo(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('user_info');
}

// Login user and store JWT
export async function loginUser(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data: LoginResponse = await safeJsonParse<LoginResponse>(response);
  setToken(data.token);
  setUserInfo(data.user_id, data.role);
  return data;
}

// Generic function to fetch records from any table
export async function fetchRecords<T>(tableName: string): Promise<T[]> {
  const token = getToken();
  if (!token) {
    throw new Error('No authentication token found');
  }

  const response = await fetch(`${API_BASE_URL}/proxy/${tableName}/records`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    clearToken();
    clearUserInfo();
    throw new Error('Unauthorized - please login again');
  }

  const data: RecordsResponse<T> = await safeJsonParse<RecordsResponse<T>>(response);
  return data.list || [];
}

// Fetch quotes with authentication
export async function fetchQuotes(): Promise<Quote[]> {
  return fetchRecords<Quote>('quotes');
}

// Fetch products with authentication and normalize NocoDB response
export async function fetchProducts(): Promise<Product[]> {
  const token = getToken();
  if (!token) {
    throw new Error('No authentication token found');
  }

  const response = await fetch(`${API_BASE_URL}/proxy/products/records`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    clearToken();
    clearUserInfo();
    throw new Error('Unauthorized - please login again');
  }

  const data: NocoDBResponse = await safeJsonParse<NocoDBResponse>(response);
  
  // Normalize NocoDB response structure
  const normalizedProducts: Product[] = (data.records || []).map(record => ({
    id: record.id,
    name: record.fields['Product Name'] || '',
    price: parseFloat(String(record.fields['Unit Price'] || 0)),
    tax: record.fields['Tax'] ? parseFloat(String(record.fields['Tax'])) : undefined,
    brand: record.fields['Brand'],
    category: record.fields['Product Category'],
    active: record.fields['Active'],
  }));

  console.log('[DEBUG] Normalized products:', normalizedProducts);
  
  return normalizedProducts;
}

// Logout user
export function logout(): void {
  clearToken();
  clearUserInfo();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}
