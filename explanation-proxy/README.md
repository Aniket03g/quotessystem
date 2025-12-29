# Proxy Code Explained - A Beginner's Guide

This folder contains beginner-friendly explanations of the actual Go code in the proxy.

## What You'll Learn

- How each file works
- What each function does
- How the pieces fit together
- Why the code is structured this way

## Folder Structure

The proxy code is organized into modules:

```
proxy/
├── main.go                    # Entry point - starts the server
├── main_helpers.go            # Helper functions
├── internal/
│   ├── config/               # Configuration system
│   ├── auth/                 # Authentication & user management
│   ├── proxy/                # Core proxy logic
│   ├── middleware/           # HTTP middleware (CORS, auth)
│   ├── db/                   # SQLite database
│   ├── utils/                # Utilities (JWT)
│   └── introspect/           # Status & schema endpoints
└── config/
    └── proxy.yaml            # Configuration file
```

## Reading Order

1. **[01-main-entry-point.md](./01-main-entry-point.md)** - Where it all begins
2. **[02-config-system.md](./02-config-system.md)** - Configuration loading and resolution
3. **[03-metacache.md](./03-metacache.md)** - The translation dictionary
4. **[04-proxy-handler.md](./04-proxy-handler.md)** - Core request handling
5. **[05-validator.md](./05-validator.md)** - Request validation
6. **[06-auth-system.md](./06-auth-system.md)** - Authentication & JWT
7. **[07-middleware.md](./07-middleware.md)** - CORS and auth middleware
8. **[08-database.md](./08-database.md)** - User storage
9. **[09-putting-it-together.md](./09-putting-it-together.md)** - How everything connects

## Quick Reference

### Key Files and Their Purpose

| File | Purpose |
|------|---------|
| `main.go` | Starts server, initializes components |
| `config/schema.go` | Defines configuration structure |
| `config/loader.go` | Loads YAML configuration |
| `config/resolver.go` | Resolves names to IDs |
| `proxy/metacache.go` | Fetches and caches NocoDB metadata |
| `proxy/handler.go` | Handles HTTP requests to NocoDB |
| `proxy/validator.go` | Validates requests against config |
| `auth/handler.go` | Login, signup, OAuth |
| `auth/middleware.go` | JWT validation |
| `middleware/cors.go` | CORS headers |
| `db/database.go` | User database operations |

## Code Style Notes

The code follows these patterns:

### Logging
Every important action is logged:
```go
log.Printf("[MODULE] What happened")
log.Printf("[MODULE ERROR] What went wrong: %v", err)
```

### Error Handling
Errors are always checked:
```go
result, err := doSomething()
if err != nil {
    log.Printf("[ERROR] Failed: %v", err)
    return err
}
```

### Thread Safety
Shared data uses locks:
```go
m.mu.Lock()
m.data = newData
m.mu.Unlock()
```

## Let's Get Started!

Open [01-main-entry-point.md](./01-main-entry-point.md) to begin understanding the code.
