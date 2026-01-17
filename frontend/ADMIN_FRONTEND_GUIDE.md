# Admin Section Frontend Implementation Guide

## Overview
Complete admin section for user management with temporary password creation and forced password change on first login. Built with Astro, TypeScript, and Tailwind CSS.

## Files Created

### 1. JWT Utilities (`src/utils/jwt.ts`)
**Purpose:** Decode and validate JWT tokens client-side

**Key Functions:**
- `decodeJWT(token)` - Decode JWT without verification
- `getTokenClaims()` - Get claims from stored token
- `isAuthenticated()` - Check if user is logged in
- `isAdmin()` - Check if user has admin role
- `mustChangePassword()` - Check if password change required
- `requireAuth()` - Redirect to login if not authenticated
- `requireAdmin()` - Redirect if not admin
- `checkPasswordChangeRequired()` - Auto-redirect to change-password page

### 2. Admin Layout (`src/layouts/AdminLayout.astro`)
**Purpose:** Consistent layout for all admin pages

**Features:**
- Purple-themed sidebar navigation
- Admin badge in header
- Navigation sections: Admin (Dashboard, Users) and Application (Quotes, Products, Contacts)
- User profile with email and initials
- Mobile responsive with hamburger menu
- Auto-checks admin role on load

### 3. Change Password Page (`src/pages/change-password.astro`)
**Purpose:** Force password change for users with temporary passwords

**Features:**
- Clean centered card layout
- Three password fields: Current, New, Confirm
- Client-side validation:
  - Minimum 8 characters
  - Passwords must match
  - New password must differ from old
- Success message with auto-redirect
- Yellow warning icon to indicate required action

**Flow:**
1. User logs in with temporary password
2. JWT contains `must_change_password: true`
3. Redirected to `/change-password`
4. Must enter old password and new password
5. On success, receives new JWT without flag
6. Redirected to `/quotes` dashboard

### 4. Admin Dashboard (`src/pages/admin/index.astro`)
**Purpose:** Admin landing page with stats and quick actions

**Features:**
- Stats cards: Total Users, System Status, Total Quotes, Total Products
- Quick action cards with hover effects
- System info banner
- Loads real quote/product counts from API

### 5. User Management Page (`src/pages/admin/users.astro`)
**Purpose:** Create new user accounts with temporary passwords

**Features:**
- Create user form with fields:
  - Email (required)
  - Name (optional)
  - Role (user/admin dropdown)
- Success card that appears after creation showing:
  - Created email
  - Temporary password with copy button
  - Role badge
  - Security warnings
- Copy to clipboard functionality
- Form validation and error handling
- "Create Another User" button to reset

**Security Notices:**
- Password shown only once
- Warning to share securely
- User must change on first login
- Don't store in plain text

### 6. Updated API Functions (`src/lib/api.ts`)
**New Endpoints:**

```typescript
// Create user (admin only)
createUser(data: CreateUserRequest): Promise<CreateUserResponse>

// Change password
changePassword(data: ChangePasswordRequest): Promise<ChangePasswordResponse>
```

### 7. Updated Login Page (`src/pages/login.astro`)
**Changes:**
- Imports `decodeJWT` from utils
- After successful login, decodes JWT
- Checks `must_change_password` claim
- Redirects to `/change-password` if true
- Otherwise redirects to `/quotes`

### 8. Updated Dashboard Layout (`src/layouts/DashboardLayout.astro`)
**Changes:**
- Imports `checkPasswordChangeRequired`
- Runs check on every page load
- Auto-redirects if password change needed

## User Flows

### Flow 1: Admin Creates User
1. Admin navigates to `/admin/users`
2. Fills out form: email, name, role
3. Clicks "Create User"
4. Success card appears with temporary password
5. Admin copies password and shares securely with user

### Flow 2: New User First Login
1. User receives temporary password from admin
2. User goes to `/login`
3. Enters email and temporary password
4. JWT returned with `must_change_password: true`
5. Automatically redirected to `/change-password`
6. User enters old (temporary) password and new password
7. New JWT issued without flag
8. Redirected to `/quotes` dashboard

### Flow 3: Admin Access
1. User with `role: "admin"` logs in
2. Can access `/admin` routes
3. Non-admin users redirected to `/quotes` if they try to access `/admin`

## Styling & Design

### Color Scheme
- **Admin theme:** Purple/pink gradients (`from-purple-500 to-pink-600`)
- **Primary actions:** Blue (`bg-blue-600`)
- **Success:** Green (`bg-green-600`)
- **Warning:** Yellow (`bg-yellow-50`)
- **Error:** Red (`bg-red-50`)

### Components
- **Cards:** White background, rounded-xl, border-slate-200
- **Buttons:** Rounded-lg, font-medium, hover effects
- **Inputs:** Border-slate-300, focus:ring-2 focus:ring-blue-500
- **Badges:** Rounded-full, text-xs, colored backgrounds

### Responsive Design
- Mobile-first approach
- Sidebar collapses on mobile with overlay
- Grid layouts adjust: 1 col mobile → 2-4 cols desktop
- Touch-friendly button sizes (py-2.5)

## Security Features

### Client-Side
- JWT validation before API calls
- Role-based route protection
- Password change enforcement
- Secure password display (shown once)
- Copy to clipboard for passwords

### Server Integration
- All API calls include `Authorization: Bearer <token>`
- 401 responses clear token and redirect to login
- 403 responses show "Admin access required"
- 409 responses show "User already exists"

## Testing Checklist

### Admin User Creation
- [ ] Form validation works (email required)
- [ ] Role dropdown shows user/admin
- [ ] Success card appears after creation
- [ ] Temporary password is displayed
- [ ] Copy button works
- [ ] "Create Another User" resets form

### Password Change Flow
- [ ] Redirects from login if must_change_password=true
- [ ] Validates password length (min 8)
- [ ] Validates passwords match
- [ ] Shows error if old password wrong
- [ ] Updates token after success
- [ ] Redirects to dashboard after change

### Admin Access Control
- [ ] Non-admin cannot access /admin routes
- [ ] Admin can access all routes
- [ ] Sidebar shows correct navigation
- [ ] User info displays correctly

### Mobile Responsiveness
- [ ] Sidebar works on mobile
- [ ] Forms are usable on small screens
- [ ] Cards stack properly
- [ ] Buttons are touch-friendly

## API Endpoints Used

```
POST /login
- Returns: { token, user_id, role }
- JWT may contain must_change_password claim

POST /api/admin/users
- Headers: Authorization: Bearer <token>
- Body: { email, name, role }
- Returns: { message, email, user_id, role, temporary_password }

POST /api/auth/change-password
- Headers: Authorization: Bearer <token>
- Body: { old_password, new_password }
- Returns: { message, token }
```

## Environment Variables
No additional environment variables needed. Uses existing:
- `PUBLIC_API_BASE_URL` (optional, defaults to `http://localhost:8080`)

## Browser Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- Uses ES6+ features (arrow functions, async/await)
- Uses Clipboard API for copy functionality

## Future Enhancements
Potential improvements not yet implemented:
- User list/table showing all users
- Edit user functionality
- Delete/deactivate user
- Password reset by admin
- Bulk user import
- Audit log of admin actions
- User activity tracking
- Email notifications
- Two-factor authentication

## Troubleshooting

### Issue: "Admin access required" error
**Solution:** Ensure JWT has `role: "admin"` claim. Check backend admin assignment logic.

### Issue: Password change not working
**Solution:** Check that old password is correct. Verify backend endpoint is `/api/auth/change-password`.

### Issue: Temporary password not showing
**Solution:** Check browser console for API errors. Verify backend returns `temporary_password` field.

### Issue: Redirect loop on login
**Solution:** Clear localStorage and cookies. Check JWT expiration. Verify `must_change_password` flag is cleared after password change.

## Code Snippets

### Check if user is admin (any page)
```typescript
import { isAdmin } from '../utils/jwt';

if (isAdmin()) {
  // Show admin features
}
```

### Manually trigger password change check
```typescript
import { checkPasswordChangeRequired } from '../utils/jwt';

checkPasswordChangeRequired(); // Redirects if needed
```

### Get current user info from JWT
```typescript
import { getTokenClaims } from '../utils/jwt';

const claims = getTokenClaims();
if (claims) {
  console.log('User ID:', claims.user_id);
  console.log('Role:', claims.role);
  console.log('Email:', claims.email);
}
```

## Summary
Complete admin section with:
✅ User creation with temporary passwords  
✅ Forced password change on first login  
✅ Admin-only access control  
✅ Clean, professional UI matching existing design  
✅ Mobile responsive  
✅ Security best practices  
✅ Error handling and validation  
✅ Copy to clipboard functionality  
✅ Success/error feedback  
