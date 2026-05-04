# Server Configuration Guide

## Quick Server Switch

To switch between different NocoDB servers (e.g., `http://100.103.198.65:8090/` or local server), you only need to change the URL in **ONE place**.

### Step 1: Edit the Root `.env` File

Open the `.env` file in the **root directory** of the project:

```
d:\GROVE SYSTEMS\working proxy\.env
```

### Step 2: Change the NOCODB_URL

Find the `NOCODB_URL` line and update it to your desired server:

```bash
# For remote server (100.103.198.65)
NOCODB_URL=http://100.103.198.65:8090/api/v3/data/

# OR for local server
NOCODB_URL=http://localhost:8090/api/v3/data/
```

### Step 3: Restart Your Services

After changing the URL, restart both the backend and frontend:

**Windows (using start.bat):**
```bash
.\start.bat
```

**Linux/Mac (using start.sh):**
```bash
./start.sh
```

**Or manually:**
```bash
# Terminal 1 - Backend
cd proxy
go run main.go

# Terminal 2 - Frontend
cd frontend
npm run dev
```

---

## Configuration Files Structure

Your project now has centralized configuration:

```
working proxy/
├── .env                    ← MAIN CONFIG FILE (edit this to switch servers)
├── .env.example           ← Template with examples
├── proxy/
│   └── .env              ← Backend-specific config (synced with root .env)
└── frontend/
    └── .env              ← Frontend config (points to backend proxy)
```

---

## Environment Variables Explained

### Backend Configuration (proxy/.env)

- **NOCODB_URL**: The NocoDB server URL - **THIS IS WHERE YOU SWITCH SERVERS**
  - Format: `http://[host]:[port]/api/v3/data/`
  - Examples:
    - Remote: `http://100.103.198.65:8090/api/v3/data/`
    - Local: `http://localhost:8090/api/v3/data/`

- **PORT**: The port your backend proxy runs on (default: 8082)
- **NOCODB_BASE_ID**: Your NocoDB base/project ID
- **NOCODB_TOKEN**: Authentication token for NocoDB API

### Frontend Configuration (frontend/.env)

- **PUBLIC_API_BASE_URL**: The backend proxy server URL
  - Default: `http://localhost:8082`
  - Change only if your backend runs on a different host/port

---

## Common Server URLs

### Remote Server
```bash
NOCODB_URL=http://100.103.198.65:8090/api/v3/data/
```

### Local Development
```bash
NOCODB_URL=http://localhost:8090/api/v3/data/
```

### Docker Container
```bash
NOCODB_URL=http://nocodb:8090/api/v3/data/
```

---

## Troubleshooting

### Changes not taking effect?
1. Make sure you saved the `.env` file
2. Restart both backend and frontend servers
3. Clear browser cache if needed

### Connection errors?
1. Verify the NocoDB server is running at the specified URL
2. Check that the port (8090) is correct
3. Ensure the `/api/v3/data/` path is included in the URL

### CORS errors?
- The backend proxy handles CORS automatically
- Make sure `PUBLIC_API_BASE_URL` in `frontend/.env` points to your backend proxy (default: `http://localhost:8082`)

---

## Best Practices

1. **Never commit `.env` files** - They contain sensitive tokens
2. **Use `.env.example`** as a template for new setups
3. **Keep the root `.env` as your single source of truth** for server configuration
4. **Document any custom configurations** in this file

---

## Need Help?

If you need to add more configuration options or have issues:
1. Check that all `.env` files are properly formatted (no spaces around `=`)
2. Verify the NocoDB server is accessible from your machine
3. Check the backend logs for connection errors
