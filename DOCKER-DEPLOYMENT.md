# Grove Systems - Docker Deployment Guide

This guide explains how to deploy the Grove Systems application using Docker with persistent data storage for logs and SQLite database.

## 📋 Prerequisites

- Docker Engine 20.10 or higher
- Docker Compose 2.0 or higher
- At least 2GB of available disk space
- Network access to your NocoDB instance

## 🚀 Quick Start

### 1. Clone and Navigate to Project

```bash
cd "d:\GROVE SYSTEMS\working proxy"
```

### 2. Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` file with your actual values:

```env
# NocoDB Configuration (Required)
NOCODB_URL=https://your-nocodb-instance.com
NOCODB_TOKEN=your-nocodb-api-token
NOCODB_BASE_ID=your-base-id

# JWT Configuration (Required - Change these!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_SECRET=your-super-secret-session-key-change-this-in-production

# Google OAuth (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://your-server-ip:8080/auth/google/callback

# GitHub OAuth (Optional)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://your-server-ip:8080/auth/github/callback
```

### 3. Build and Start Services

```bash
docker-compose up -d --build
```

This will:
- Build the backend (Go) and frontend (Astro) containers
- Create persistent volumes for database and logs
- Start both services in detached mode

### 4. Verify Deployment

Check if services are running:

```bash
docker-compose ps
```

Check logs:

```bash
# View all logs
docker-compose logs

# View backend logs
docker-compose logs backend

# View frontend logs
docker-compose logs frontend

# Follow logs in real-time
docker-compose logs -f
```

### 5. Access the Application

- **Frontend**: http://localhost:4321 or http://your-server-ip:4321
- **Backend API**: http://localhost:8080 or http://your-server-ip:8080
- **Health Check**: http://localhost:8080/health

## 📁 Persistent Data

The application uses Docker volumes to persist data across container restarts:

### Database Location
- **Host Path**: `./data/db/users.db`
- **Container Path**: `/app/data/users.db`
- **Purpose**: Stores user accounts, authentication data

### Logs Location
- **Host Path**: `./data/logs/`
- **Container Path**: `/app/logs/`
- **Purpose**: Application logs with daily rotation
- **Format**: `app-YYYY-MM-DD.log`

### Accessing Persistent Data

```bash
# View database file
ls -lh ./data/db/

# View logs
ls -lh ./data/logs/

# Read latest log file
tail -f ./data/logs/app-$(date +%Y-%m-%d).log

# View all logs
cat ./data/logs/*.log
```

## 🔧 Management Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### Restart Services
```bash
docker-compose restart
```

### Rebuild After Code Changes
```bash
docker-compose down
docker-compose up -d --build
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend

# Last 100 lines
docker-compose logs --tail=100
```

### Execute Commands in Container
```bash
# Access backend shell
docker-compose exec backend sh

# Access frontend shell
docker-compose exec frontend sh
```

### Check Service Health
```bash
# Backend health
curl http://localhost:8080/health

# Frontend health
curl http://localhost:4321
```

## 🗄️ Database Management

### Backup Database

```bash
# Create backup directory
mkdir -p backups

# Backup database
cp ./data/db/users.db ./backups/users-$(date +%Y%m%d-%H%M%S).db

# Or use Docker
docker-compose exec backend cp /app/data/users.db /app/data/users-backup.db
```

### Restore Database

```bash
# Stop services
docker-compose down

# Restore from backup
cp ./backups/users-YYYYMMDD-HHMMSS.db ./data/db/users.db

# Start services
docker-compose up -d
```

### View Database Contents

```bash
# Install sqlite3 if not available
# On Ubuntu/Debian: sudo apt-get install sqlite3
# On macOS: brew install sqlite3

# Query database
sqlite3 ./data/db/users.db "SELECT * FROM users;"
```

## 📊 Log Management

### View Recent Logs

```bash
# Today's application log
tail -f ./data/logs/app-$(date +%Y-%m-%d).log

# Docker container logs
docker-compose logs -f backend
```

### Search Logs

```bash
# Search for errors
grep "ERROR" ./data/logs/*.log

# Search for specific user activity
grep "admin@example.com" ./data/logs/*.log

# Search for login attempts
grep "LOGIN" ./data/logs/*.log
```

### Clean Old Logs

```bash
# Remove logs older than 30 days
find ./data/logs -name "app-*.log" -mtime +30 -delete

# Archive old logs
tar -czf logs-archive-$(date +%Y%m%d).tar.gz ./data/logs/app-*.log
```

## 🔒 Security Considerations

1. **Change Default Secrets**: Always change `JWT_SECRET` and `SESSION_SECRET` in production
2. **Use HTTPS**: Configure a reverse proxy (nginx/traefik) with SSL certificates
3. **Firewall**: Restrict access to ports 4321 and 8080
4. **Database Backups**: Regularly backup the SQLite database
5. **Log Rotation**: Monitor log file sizes and implement rotation
6. **Environment Variables**: Never commit `.env` file to version control

## 🌐 Production Deployment

### Using Reverse Proxy (Nginx)

Create nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:4321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /proxy/ {
        proxy_pass http://localhost:8080/proxy/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
```

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs

# Check if ports are already in use
netstat -tulpn | grep -E '4321|8080'

# Remove old containers and rebuild
docker-compose down -v
docker-compose up -d --build
```

### Database Locked Error

```bash
# Stop all services
docker-compose down

# Remove lock files
rm -f ./data/db/*.db-shm ./data/db/*.db-wal

# Restart services
docker-compose up -d
```

### Cannot Access Application

```bash
# Check if services are running
docker-compose ps

# Check network connectivity
curl http://localhost:8080/health
curl http://localhost:4321

# Check firewall rules
sudo ufw status

# Check Docker network
docker network inspect working-proxy_grove-network
```

### Logs Not Persisting

```bash
# Check volume mounts
docker-compose exec backend ls -la /app/logs

# Check permissions
ls -la ./data/logs/

# Fix permissions if needed
sudo chown -R $USER:$USER ./data/logs/
```

## 📈 Monitoring

### Resource Usage

```bash
# View resource usage
docker stats

# View specific container
docker stats grove-backend grove-frontend
```

### Disk Usage

```bash
# Check Docker disk usage
docker system df

# Check persistent data size
du -sh ./data/
```

## 🔄 Updates and Maintenance

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Clean Up

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes (careful!)
docker volume prune

# Complete cleanup
docker system prune -a --volumes
```

## 📞 Support

For issues or questions:
1. Check logs: `docker-compose logs`
2. Review this documentation
3. Check persistent data: `./data/db/` and `./data/logs/`
4. Verify environment variables in `.env`

## 📝 Default Credentials

**Admin User** (for testing):
- Email: `admin@example.com`
- Password: `admin123`

**Note**: Change or remove demo users in production!
