package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

// HealthProxyTimeout is the HTTP timeout for proxying health checks.
const HealthProxyTimeout = 5 * time.Second

// InternalHealthTimeout is the aggregate timeout for a /internal/health
// request, covering DB ping + Redis ping + ingestion probe. Slightly shorter
// than the k8s readiness probe timeout (default 1s per probe, but we bound it
// here regardless so a slow Redis doesn't stall the pod).
const InternalHealthTimeout = 3 * time.Second

// GetCache attempts to retrieve and deserialize a value from Redis.
// Returns true if the cache hit was successful.
func GetCache(rdb *redis.Client, key string, target interface{}) bool {
	val, err := rdb.Get(context.Background(), key).Result()
	if err != nil {
		return false
	}

	err = json.Unmarshal([]byte(val), target)
	return err == nil
}

// SetCache serializes and stores a value in Redis with an expiration.
func SetCache(rdb *redis.Client, key string, value interface{}, expiration time.Duration) {
	data, err := json.Marshal(value)
	if err != nil {
		log.Printf("[Redis Error] Failed to marshal cache data for %s: %v", key, err)
		return
	}

	err = rdb.Set(context.Background(), key, data, expiration).Err()
	if err != nil {
		log.Printf("[Redis Error] Failed to set cache for %s: %v", key, err)
	}
}

// DeleteCache removes a cached value from Redis.
func DeleteCache(rdb *redis.Client, key string) {
	rdb.Del(context.Background(), key)
}

// GetSubscribers returns all user subs in a Redis subscription set.
func GetSubscribers(rdb *redis.Client, ctx context.Context, setKey string) ([]string, error) {
	return rdb.SMembers(ctx, setKey).Result()
}

// SubscriberSetTTL bounds how long per-league subscriber sets persist in
// Redis without being refreshed. Without a TTL, stale memberships leak
// forever when cleanup is missed. Sets are refreshed on every config
// save, so 7 days is generous.
const SubscriberSetTTL = 7 * 24 * time.Hour

// AddSubscriber adds a user to a Redis subscriber set and (re)sets its TTL.
func AddSubscriber(rdb *redis.Client, ctx context.Context, setKey, userSub string) {
	pipe := rdb.Pipeline()
	pipe.SAdd(ctx, setKey, userSub)
	pipe.Expire(ctx, setKey, SubscriberSetTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("[Redis] Failed to add subscriber %s to %s: %v", userSub, setKey, err)
	}
}

// RemoveSubscriber removes a user from a Redis subscriber set.
func RemoveSubscriber(rdb *redis.Client, ctx context.Context, setKey, userSub string) {
	if err := rdb.SRem(ctx, setKey, userSub).Err(); err != nil {
		log.Printf("[Redis] Failed to remove subscriber %s from %s: %v", userSub, setKey, err)
	}
}

// buildReadyURL ensures the URL ends with /health/ready (the real readiness
// endpoint; returns 503 if the ingestion service is starting, failed, or
// hasn't completed a fresh poll). For back-compat with older services that
// only expose /health, callers should fall back there on 404.
func buildReadyURL(baseURL string) string {
	url := strings.TrimSuffix(baseURL, "/")
	switch {
	case strings.HasSuffix(url, "/health/ready"):
		return url
	case strings.HasSuffix(url, "/health"):
		return url + "/ready"
	default:
		return url + "/health/ready"
	}
}

// probeIngestion checks the downstream Rust ingestion service's
// /health/ready endpoint and returns the HTTP status code the upstream
// emitted (200 when ready, 503 when starting/failed/stale). Used by the
// channel API's own /internal/health to propagate ingestion readiness up
// to Kubernetes.
func probeIngestion(ctx context.Context, internalURL string) (int, error) {
	if internalURL == "" {
		return 0, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, buildReadyURL(internalURL), nil)
	if err != nil {
		return 0, err
	}
	httpClient := &http.Client{Timeout: HealthProxyTimeout}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// maxHealthResponseBytes limits the body size read from internal health endpoints.
const maxHealthResponseBytes = 1 << 20 // 1 MB

// ProxyInternalHealth proxies a health check to an internal service URL.
// Used by the public /sports/health endpoint so operators can curl the full
// Rust-side payload without having to exec into the cluster.
func ProxyInternalHealth(c *fiber.Ctx, internalURL string) error {
	if internalURL == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "unknown",
			Error:  "Internal URL not configured",
		})
	}

	targetURL := buildReadyURL(internalURL)
	httpClient := &http.Client{Timeout: HealthProxyTimeout}
	resp, err := httpClient.Get(targetURL)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "down",
			Error:  err.Error(),
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHealthResponseBytes))
	if err != nil {
		log.Printf("[Sports] Failed to read health response body: %v", err)
	}
	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}
