# Backend Dockerfile for Go application
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev sqlite-dev

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o main .

# Production stage
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates sqlite-libs

# Copy binary from builder
COPY --from=builder /app/main .

# Copy config directory if exists
COPY --from=builder /app/config ./config 2>/dev/null || true

# Create directories for persistent data
RUN mkdir -p /app/data /app/logs

# Expose port
EXPOSE 8080

# Set environment variables for persistent paths
ENV DATABASE_PATH=/app/data/users.db
ENV LOG_DIR=/app/logs

# Start the application
CMD ["./main"]
