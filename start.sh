#!/bin/bash

# Grove Systems - Docker Deployment Script
# This script helps you deploy the application with Docker

set -e

echo "=========================================="
echo "Grove Systems - Docker Deployment"
echo "=========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Error: Docker Compose is not installed"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file with your actual configuration!"
    echo "Required variables:"
    echo "  - NOCODB_URL"
    echo "  - NOCODB_TOKEN"
    echo "  - NOCODB_BASE_ID"
    echo "  - JWT_SECRET (change the default!)"
    echo "  - SESSION_SECRET (change the default!)"
    echo ""
    read -p "Press Enter after you've configured .env file..."
fi

# Create data directories
echo "📁 Creating persistent data directories..."
mkdir -p data/db data/logs
echo "✅ Directories created: ./data/db and ./data/logs"
echo ""

# Build and start services
echo "🏗️  Building Docker images..."
docker-compose build

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service health
echo ""
echo "🔍 Checking service health..."

if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ Backend is running on http://localhost:8080"
else
    echo "⚠️  Backend health check failed (may still be starting up)"
fi

if curl -s http://localhost:4321 > /dev/null 2>&1; then
    echo "✅ Frontend is running on http://localhost:4321"
else
    echo "⚠️  Frontend health check failed (may still be starting up)"
fi

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Access your application:"
echo "  Frontend: http://localhost:4321"
echo "  Backend:  http://localhost:8080"
echo ""
echo "Persistent data locations:"
echo "  Database: ./data/db/users.db"
echo "  Logs:     ./data/logs/"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f"
echo "  Stop services:    docker-compose down"
echo "  Restart services: docker-compose restart"
echo ""
echo "Default admin credentials:"
echo "  Email:    admin@example.com"
echo "  Password: admin123"
echo ""
echo "For more information, see DOCKER-DEPLOYMENT.md"
echo "=========================================="
