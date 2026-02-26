/**
 * JWT Utilities for decoding and checking claims
 */

export interface JWTClaims {
  user_id: string;
  role: string;
  email?: string;
  must_change_password?: boolean;
  exp: number;
  iat: number;
}

/**
 * Decode JWT token without verification (client-side only)
 * Returns null if token is invalid or expired
 */
export function decodeJWT(token: string): JWTClaims | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (base64url)
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(decoded) as JWTClaims;

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) {
      console.warn('[JWT] Token expired');
      return null;
    }

    return claims;
  } catch (error) {
    console.error('[JWT] Failed to decode token:', error);
    return null;
  }
}

/**
 * Get JWT token from localStorage
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jwt_token');
}

/**
 * Get decoded claims from stored token
 */
export function getTokenClaims(): JWTClaims | null {
  const token = getToken();
  if (!token) return null;
  return decodeJWT(token);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const claims = getTokenClaims();
  return claims !== null;
}

/**
 * Check if user is admin
 */
export function isAdmin(): boolean {
  const claims = getTokenClaims();
  return claims?.role === 'admin';
}

/**
 * Check if user must change password
 */
export function mustChangePassword(): boolean {
  const claims = getTokenClaims();
  return claims?.must_change_password === true;
}

/**
 * Redirect to login if not authenticated
 */
export function requireAuth(): void {
  if (typeof window === 'undefined') return;
  
  if (!isAuthenticated()) {
    window.location.href = '/login';
  }
}

/**
 * Redirect to login if not admin
 */
export function requireAdmin(): void {
  if (typeof window === 'undefined') return;
  
  if (!isAuthenticated()) {
    window.location.href = '/login';
    return;
  }
  
  if (!isAdmin()) {
    window.location.href = '/quotes';
  }
}

/**
 * Check and redirect if password change required
 */
export function checkPasswordChangeRequired(): void {
  if (typeof window === 'undefined') return;
  
  const currentPath = window.location.pathname;
  
  // Skip check on login and change-password pages
  if (currentPath === '/login' || currentPath === '/change-password') {
    return;
  }
  
  if (mustChangePassword()) {
    window.location.href = '/change-password';
  }
}
