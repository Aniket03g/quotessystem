# Grove Systems - CRM Application

A modern CRM application with NocoDB integration, featuring user authentication, quote management, and more.

## 🚀 Quick Start with Docker

The easiest way to deploy this application is using Docker:

### Windows
```bash
start.bat
```

### Linux/Mac
```bash
chmod +x start.sh
./start.sh
```

### Manual Docker Deployment
```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your settings

# 2. Create data directories
mkdir -p data/db data/logs

# 3. Build and start
docker-compose up -d --build

# 4. Access application
# Frontend: http://localhost:4321
# Backend: http://localhost:8080
```

## 📚 Documentation

- **[Docker Deployment Guide](DOCKER-DEPLOYMENT.md)** - Complete Docker deployment instructions
- **[Frontend Context](AI-CONTEXT-FOR-FRONTEND.md)** - Frontend architecture and development

## 🔑 Features

- **User Authentication**: Login/Signup with JWT tokens
- **OAuth Support**: Google and GitHub OAuth integration
- **Quote Management**: Create, view, and manage quotes
- **PDF Generation**: Generate professional quote PDFs
- **Account Management**: Manage customer accounts and contacts
- **Product Catalog**: Maintain product inventory
- **NocoDB Integration**: Seamless integration with NocoDB backend

## 🏗️ Architecture

### Frontend (Astro + TypeScript)
- Modern Astro framework
- TailwindCSS for styling
- PDF generation with PDFKit
- Responsive design

### Backend (Go)
- RESTful API
- JWT authentication
- SQLite database for users
- NocoDB proxy layer
- OAuth 2.0 support

## 📁 Project Structure

```
working proxy/
├── frontend/           # Astro frontend application
│   ├── src/
│   │   ├── pages/     # Page components
│   │   ├── layouts/   # Layout components
│   │   └── lib/       # Utility functions
│   └── Dockerfile
├── proxy/             # Go backend application
│   ├── internal/      # Internal packages
│   │   ├── auth/     # Authentication
│   │   ├── db/       # Database layer
│   │   ├── logger/   # Logging system
│   │   └── proxy/    # NocoDB proxy
│   ├── main.go
│   └── Dockerfile
├── data/              # Persistent data (created on first run)
│   ├── db/           # SQLite database
│   └── logs/         # Application logs
├── docker-compose.yml
└── .env              # Environment configuration
```

## 🔧 Configuration

### Required Environment Variables

```env
# NocoDB Configuration
NOCODB_URL=https://your-nocodb-instance.com
NOCODB_TOKEN=your-api-token
NOCODB_BASE_ID=your-base-id

# Security (CHANGE THESE!)
JWT_SECRET=your-secret-key
SESSION_SECRET=your-session-secret
```

### Optional OAuth Configuration

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_CALLBACK_URL=http://localhost:8080/auth/github/callback
```

## 💾 Persistent Data

All data persists across container restarts:

- **Database**: `./data/db/users.db` - User accounts and authentication
- **Logs**: `./data/logs/` - Application logs with daily rotation

## 📊 Monitoring

### View Logs
```bash
# Real-time logs
docker-compose logs -f

# Application logs (persistent)
tail -f ./data/logs/app-$(date +%Y-%m-%d).log

# Search for errors
grep "ERROR" ./data/logs/*.log
```

### Check Health
```bash
# Backend health
curl http://localhost:8080/health

# Service status
docker-compose ps
```

## 🔐 Default Credentials

**Admin User** (for testing):
- Email: `admin@example.com`
- Password: `admin123`

⚠️ **Important**: Change or remove demo users in production!

## 🛠️ Development

### Local Development (without Docker)

#### Backend
```bash
cd proxy
go mod download
go run main.go
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📦 Backup and Restore

### Backup Database
```bash
# Create backup
cp ./data/db/users.db ./backups/users-$(date +%Y%m%d).db
```

### Restore Database
```bash
# Stop services
docker-compose down

# Restore backup
cp ./backups/users-YYYYMMDD.db ./data/db/users.db

# Start services
docker-compose up -d
```

## 🔄 Updates

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

## 🐛 Troubleshooting

See [DOCKER-DEPLOYMENT.md](DOCKER-DEPLOYMENT.md) for detailed troubleshooting steps.

Common issues:
- **Port conflicts**: Change ports in `docker-compose.yml`
- **Database locked**: Stop services and remove `.db-shm` and `.db-wal` files
- **Services won't start**: Check logs with `docker-compose logs`

## 📞 Support

1. Check logs: `docker-compose logs`
2. Review documentation: `DOCKER-DEPLOYMENT.md`
3. Verify environment variables in `.env`
4. Check persistent data in `./data/`

## 📄 License

Proprietary - Grove Systems

## 🙏 Acknowledgments

- Built with [Astro](https://astro.build/)
- Backend powered by [Go](https://golang.org/)
- Database integration with [NocoDB](https://nocodb.com/)
