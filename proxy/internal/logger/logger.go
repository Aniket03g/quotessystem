package logger

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
)

type Logger struct {
	infoLogger  *log.Logger
	errorLogger *log.Logger
	logDir      string
	logFile     *os.File
}

var globalLogger *Logger

// Initialize sets up the global logger with file output
func Initialize(logDir string) error {
	if logDir == "" {
		logDir = "./logs"
	}

	// Create logs directory if it doesn't exist
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %v", err)
	}

	// Create log file with timestamp
	timestamp := time.Now().Format("2006-01-02")
	logFileName := filepath.Join(logDir, fmt.Sprintf("app-%s.log", timestamp))

	logFile, err := os.OpenFile(logFileName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %v", err)
	}

	// Create multi-writer to write to both file and stdout
	multiWriter := io.MultiWriter(os.Stdout, logFile)

	globalLogger = &Logger{
		infoLogger:  log.New(multiWriter, "[INFO] ", log.LstdFlags|log.Lshortfile),
		errorLogger: log.New(multiWriter, "[ERROR] ", log.LstdFlags|log.Lshortfile),
		logDir:      logDir,
		logFile:     logFile,
	}

	Info("Logger initialized successfully")
	Info("Log directory: %s", logDir)
	Info("Log file: %s", logFileName)

	return nil
}

// Info logs an informational message
func Info(format string, v ...interface{}) {
	if globalLogger != nil {
		globalLogger.infoLogger.Output(2, fmt.Sprintf(format, v...))
	} else {
		log.Printf("[INFO] "+format, v...)
	}
}

// Error logs an error message
func Error(format string, v ...interface{}) {
	if globalLogger != nil {
		globalLogger.errorLogger.Output(2, fmt.Sprintf(format, v...))
	} else {
		log.Printf("[ERROR] "+format, v...)
	}
}

// Fatal logs a fatal error and exits
func Fatal(format string, v ...interface{}) {
	if globalLogger != nil {
		globalLogger.errorLogger.Output(2, fmt.Sprintf(format, v...))
		Close()
	} else {
		log.Printf("[FATAL] "+format, v...)
	}
	os.Exit(1)
}

// Close closes the log file
func Close() error {
	if globalLogger != nil && globalLogger.logFile != nil {
		Info("Closing logger")
		return globalLogger.logFile.Close()
	}
	return nil
}

// RotateLogs creates a new log file for the current day
func RotateLogs() error {
	if globalLogger == nil {
		return fmt.Errorf("logger not initialized")
	}

	// Close current log file
	if globalLogger.logFile != nil {
		globalLogger.logFile.Close()
	}

	// Create new log file
	timestamp := time.Now().Format("2006-01-02")
	logFileName := filepath.Join(globalLogger.logDir, fmt.Sprintf("app-%s.log", timestamp))

	logFile, err := os.OpenFile(logFileName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open new log file: %v", err)
	}

	// Update multi-writer
	multiWriter := io.MultiWriter(os.Stdout, logFile)
	globalLogger.infoLogger.SetOutput(multiWriter)
	globalLogger.errorLogger.SetOutput(multiWriter)
	globalLogger.logFile = logFile

	Info("Log file rotated: %s", logFileName)
	return nil
}

// StartAutoRotation starts a goroutine that rotates logs daily
func StartAutoRotation() {
	go func() {
		for {
			// Calculate time until next midnight
			now := time.Now()
			nextMidnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
			duration := nextMidnight.Sub(now)

			// Wait until midnight
			time.Sleep(duration)

			// Rotate logs
			if err := RotateLogs(); err != nil {
				Error("Failed to rotate logs: %v", err)
			}
		}
	}()
	Info("Auto log rotation started")
}
