# Astro Frontend

Minimalist Astro application for the Generic Proxy System.

## Features

- **Login Page** - Email/password authentication
- **My Quotes Page** - Displays user's quotes from NocoDB
- **JWT Storage** - Tokens stored in localStorage
- **Clean UI** - Neutral colors, responsive design
- **Protected Routes** - Automatic redirect if unauthorized

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables (optional):
```bash
cp .env.example .env
```

3. Start development server:
```bash
npm run dev
```

The app will start on `http://localhost:4321`

## Pages

### / (Home)
Landing page with navigation to login and quotes pages.

### /login
Login form with demo user credentials displayed.

**Demo Users:**
- `admin@example.com` / `admin123` (admin role)
- `user@example.com` / `user123` (user role)

### /quotes
Protected page that displays the user's quotes.

**Features:**
- Fetches data from `/proxy/quotes/records`
- Displays in a clean table format
- Shows user info and role
- Logout button
- Redirects to login if unauthorized

## API Integration

All API calls go through the Go proxy backend (`http://localhost:8080`).

### API Helper (`src/lib/api.ts`)

**Functions:**
- `loginUser(email, password)` - Authenticate and store JWT
- `fetchQuotes()` - Fetch user's quotes with JWT
- `logout()` - Clear JWT and redirect to login
- `getToken()` - Get stored JWT from localStorage
- `getUserInfo()` - Get user ID and role

**Example Usage:**
```typescript
import { loginUser, fetchQuotes } from '@/lib/api';

// Login
const response = await loginUser('user@example.com', 'user123');
console.log(response.token);

// Fetch quotes
const quotes = await fetchQuotes();
console.log(quotes);
```

## Project Structure

```
frontend/
├── src/
│   ├── pages/
│   │   ├── index.astro      # Home page
│   │   ├── login.astro      # Login page
│   │   └── quotes.astro     # My Quotes page
│   └── lib/
│       └── api.ts           # API helper functions
├── public/                  # Static assets
├── astro.config.mjs         # Astro configuration
├── package.json             # Dependencies
└── tsconfig.json            # TypeScript config
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Styling

The app uses minimal inline CSS with:
- Clean neutral colors (white, gray, black)
- Responsive table layouts
- Simple form styling
- No heavy CSS frameworks

## Authentication Flow

1. User enters credentials on `/login`
2. Frontend calls `POST /login` on backend
3. Backend returns JWT token
4. Token stored in localStorage
5. All subsequent requests include `Authorization: Bearer <token>`
6. If token invalid/expired, redirect to `/login`

## Development

### Adding New Pages

Create a new `.astro` file in `src/pages/`:

```astro
---
// Page logic here
---

<!DOCTYPE html>
<html>
  <head>
    <title>New Page</title>
  </head>
  <body>
    <!-- Page content -->
  </body>
</html>
```

### Making API Calls

Use the API helper functions from `src/lib/api.ts`:

```typescript
import { fetchQuotes } from '@/lib/api';

const quotes = await fetchQuotes();
```

## Troubleshooting

### CORS Errors
Ensure the backend is running on `http://localhost:8080` and has CORS enabled.

### Authentication Errors
- Check that JWT token is stored in localStorage
- Verify token hasn't expired (24 hour expiry)
- Ensure backend is running

### No Quotes Displayed
- Verify NocoDB is running and has data
- Check that the `quotes` table exists
- Ensure the table has a `created_by` field matching your user ID
