package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port string

	// NocoDB
	NocoDBURL    string
	NocoDBToken  string
	NocoDBBaseID string

	// JWT
	JWTSecret string

	// OAuth - Google
	GoogleClientID     string
	GoogleClientSecret string
	GoogleCallbackURL  string

	// OAuth - GitHub
	GitHubClientID     string
	GitHubClientSecret string
	GitHubCallbackURL  string

	// Database
	DatabasePath string

	// Session
	SessionSecret string
}

func Load() *Config {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		log.Println("[CONFIG WARN] .env file not found or could not be loaded - using defaults")
	} else {
		log.Println("[CONFIG] .env file loaded successfully")
	}

	return &Config{
		// Server
		Port: getEnv("PORT", "8080"),

		// NocoDB
		NocoDBURL:    getEnv("NOCODB_URL", "http://localhost:8090/api/v3/data/project/"),
		NocoDBToken:  getEnv("NOCODB_TOKEN", "secret123"),
		NocoDBBaseID: getEnv("NOCODB_BASE_ID", ""),

		// JWT
		JWTSecret: getEnv("JWT_SECRET", "myjwtsecret"),

		// OAuth - Google
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleCallbackURL:  getEnv("GOOGLE_CALLBACK_URL", "http://localhost:8080/auth/google/callback"),

		// OAuth - GitHub
		GitHubClientID:     getEnv("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: getEnv("GITHUB_CLIENT_SECRET", ""),
		GitHubCallbackURL:  getEnv("GITHUB_CALLBACK_URL", "http://localhost:8080/auth/github/callback"),

		// Database
		DatabasePath: getEnv("DATABASE_PATH", "./users.db"),

		// Session
		SessionSecret: getEnv("SESSION_SECRET", "session-secret-key"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) MaskSecret(secret string) string {
	if len(secret) <= 8 {
		return "****"
	}
	return secret[:4] + "****" + secret[len(secret)-4:]
}
