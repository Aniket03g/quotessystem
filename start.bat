@echo off
REM Grove Systems - Docker Deployment Script for Windows
REM This script helps you deploy the application with Docker

echo ==========================================
echo Grove Systems - Docker Deployment
echo ==========================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo Error: Docker is not installed
    echo Please install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo Error: Docker Compose is not installed
    echo Please install Docker Desktop which includes Docker Compose
    pause
    exit /b 1
)

echo Docker and Docker Compose are installed
echo.

REM Check if .env file exists
if not exist .env (
    echo .env file not found
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo IMPORTANT: Please edit .env file with your actual configuration!
    echo Required variables:
    echo   - NOCODB_URL
    echo   - NOCODB_TOKEN
    echo   - NOCODB_BASE_ID
    echo   - JWT_SECRET ^(change the default!^)
    echo   - SESSION_SECRET ^(change the default!^)
    echo.
    pause
)

REM Create data directories
echo Creating persistent data directories...
if not exist data\db mkdir data\db
if not exist data\logs mkdir data\logs
echo Directories created: .\data\db and .\data\logs
echo.

REM Build and start services
echo Building Docker images...
docker-compose build

echo.
echo Starting services...
docker-compose up -d

echo.
echo Waiting for services to be ready...
timeout /t 5 /nobreak >nul

REM Check service health
echo.
echo Checking service health...

curl -s http://localhost:8080/health >nul 2>&1
if errorlevel 1 (
    echo Backend health check failed ^(may still be starting up^)
) else (
    echo Backend is running on http://localhost:8080
)

curl -s http://localhost:4321 >nul 2>&1
if errorlevel 1 (
    echo Frontend health check failed ^(may still be starting up^)
) else (
    echo Frontend is running on http://localhost:4321
)

echo.
echo ==========================================
echo Deployment Complete!
echo ==========================================
echo.
echo Access your application:
echo   Frontend: http://localhost:4321
echo   Backend:  http://localhost:8080
echo.
echo Persistent data locations:
echo   Database: .\data\db\users.db
echo   Logs:     .\data\logs\
echo.
echo Useful commands:
echo   View logs:        docker-compose logs -f
echo   Stop services:    docker-compose down
echo   Restart services: docker-compose restart
echo.
echo Default admin credentials:
echo   Email:    admin@example.com
echo   Password: admin123
echo.
echo For more information, see DOCKER-DEPLOYMENT.md
echo ==========================================
echo.
pause
