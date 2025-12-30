package middleware

import (
	"fmt"
	"net/http"
	"time"

	"github.com/grove/generic-proxy/internal/logger"
)

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    int64
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.written += int64(n)
	return n, err
}

// RequestLoggerMiddleware logs detailed information about every HTTP request
func RequestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startTime := time.Now()

		// Extract client IP (handle proxies)
		clientIP := r.RemoteAddr
		if forwardedFor := r.Header.Get("X-Forwarded-For"); forwardedFor != "" {
			clientIP = forwardedFor
		} else if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
			clientIP = realIP
		}

		// Wrap response writer to capture status code
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK, // Default status
		}

		// Log incoming request
		logger.Info("[REQUEST] %s %s from %s | User-Agent: %s",
			r.Method,
			r.URL.Path,
			clientIP,
			r.Header.Get("User-Agent"),
		)

		// Log query parameters if present
		if r.URL.RawQuery != "" {
			logger.Info("[REQUEST] Query: %s", r.URL.RawQuery)
		}

		// Log authorization header presence (not the actual token)
		if authHeader := r.Header.Get("Authorization"); authHeader != "" {
			logger.Info("[REQUEST] Authorization: Bearer token present")
		} else {
			logger.Info("[REQUEST] Authorization: No token")
		}

		// Call next handler
		next.ServeHTTP(wrapped, r)

		// Calculate request duration
		duration := time.Since(startTime)

		// Log response details
		if wrapped.statusCode >= 200 && wrapped.statusCode < 300 {
			logger.Info("[RESPONSE] %s %s | Status: %d | Duration: %v | Bytes: %d | IP: %s",
				r.Method,
				r.URL.Path,
				wrapped.statusCode,
				duration,
				wrapped.written,
				clientIP,
			)
		} else if wrapped.statusCode >= 400 && wrapped.statusCode < 500 {
			logger.Error("[RESPONSE] %s %s | Status: %d (Client Error) | Duration: %v | IP: %s",
				r.Method,
				r.URL.Path,
				wrapped.statusCode,
				duration,
				clientIP,
			)
		} else if wrapped.statusCode >= 500 {
			logger.Error("[RESPONSE] %s %s | Status: %d (Server Error) | Duration: %v | IP: %s",
				r.Method,
				r.URL.Path,
				wrapped.statusCode,
				duration,
				clientIP,
			)
		}

		// Log slow requests (> 1 second)
		if duration > time.Second {
			logger.Error("[SLOW REQUEST] %s %s took %v | IP: %s",
				r.Method,
				r.URL.Path,
				duration,
				clientIP,
			)
		}
	})
}

// ErrorLoggerMiddleware wraps handlers to catch and log panics
func ErrorLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger.Error("[PANIC] %s %s | Error: %v | IP: %s",
					r.Method,
					r.URL.Path,
					err,
					r.RemoteAddr,
				)

				http.Error(w, fmt.Sprintf("Internal Server Error: %v", err), http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(w, r)
	})
}
