package core

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// A localSource is a first-party widget data source served in-process by
// core instead of a proxied channel service (ADR-0002). Each fold
// (finance, sports, rss, predictions) registers one entry in
// localSources; fantasy stays a discovered channel service. Discovered
// channels whose name matches a local source are skipped by the /health
// and /dashboard aggregators so a still-registered legacy service can't
// double-report during the cutover window.
type localSource struct {
	// dashboard contributes this source's section(s) to /dashboard for
	// one user. Returned keys merge into DashboardResponse.Data.
	dashboard func(ctx context.Context, userSub string) map[string]interface{}

	// health reports the source's ingestion status for /health. The
	// string lands in HealthResponse.Services[name]; healthy=false marks
	// the whole response degraded — the same semantics the proxied
	// /internal/health probe had.
	health func(ctx context.Context) (status string, healthy bool)

	// invalidateUser drops the source's per-user caches after a channel
	// config change — for most sources the only live behavior of the
	// retired HTTP lifecycle contract (ADR-0002 Appendix A).
	invalidateUser func(userSub string)

	// lifecycle, when set, receives the full channel lifecycle event and
	// takes precedence over invalidateUser. Only rss needs it — its
	// lifecycle syncs the user's custom feeds into the polling-target
	// tables in addition to cache invalidation.
	lifecycle func(event, userSub string, config, oldConfig map[string]interface{}, enabled bool)
}

// localSources is keyed by data-source name (the values returned by
// DataSourceForWidget).
var localSources = map[string]localSource{
	"finance":     financeSource,
	"sports":      sportsSource,
	"predictions": predictionsSource,
	"rss":         rssSource,
}

// isLocalSource reports whether a discovered channel name is served
// in-process and should be excluded from HTTP aggregation.
func isLocalSource(name string) bool {
	_, ok := localSources[name]
	return ok
}

// --- Ingestion-probe plumbing shared by local sources ---

// ingestionProbeTimeout is the HTTP timeout for probing a Rust ingestion
// service's health endpoint.
const ingestionProbeTimeout = 5 * time.Second

// maxHealthResponseBytes limits the body size read from internal health
// endpoints.
const maxHealthResponseBytes = 1 << 20 // 1 MB

// buildReadyURL returns the /health/ready endpoint on the given base URL.
// Idempotent for trailing slashes and pre-existing /health or /health/ready.
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

// probeIngestion checks a Rust ingestion service's /health/ready endpoint
// and returns the HTTP status code it emitted (200 when ready, 503 when
// starting/failed/stale). An empty URL is a no-op returning (0, nil).
func probeIngestion(ctx context.Context, internalURL string) (int, error) {
	if internalURL == "" {
		return 0, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, buildReadyURL(internalURL), nil)
	if err != nil {
		return 0, err
	}
	httpClient := &http.Client{Timeout: ingestionProbeTimeout}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// proxyIngestionHealth proxies a health check to an ingestion service URL.
// Used by the public /{source}/health endpoints so operators can curl the
// full Rust-side payload without having to exec into the cluster.
func proxyIngestionHealth(c *fiber.Ctx, internalURL string) error {
	if internalURL == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "unknown",
			Error:  "Internal URL not configured",
		})
	}

	httpClient := &http.Client{Timeout: ingestionProbeTimeout}
	resp, err := httpClient.Get(buildReadyURL(internalURL))
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "down",
			Error:  err.Error(),
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHealthResponseBytes))
	if err != nil {
		log.Printf("[Sources] Failed to read health response body: %v", err)
	}
	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}

// --- Small JSON cache helpers shared by local sources ---

// cacheGetJSON retrieves and deserializes a value from Redis. Returns
// true on a usable hit.
func cacheGetJSON(ctx context.Context, key string, target interface{}) bool {
	val, err := Rdb.Get(ctx, key).Result()
	if err != nil {
		return false
	}
	return json.Unmarshal([]byte(val), target) == nil
}

// cacheSetJSON serializes and stores a value in Redis with an expiration.
func cacheSetJSON(ctx context.Context, key string, value interface{}, expiration time.Duration) {
	data, err := json.Marshal(value)
	if err != nil {
		log.Printf("[Sources] Failed to marshal cache data for %s: %v", key, err)
		return
	}
	if err := Rdb.Set(ctx, key, data, expiration).Err(); err != nil {
		log.Printf("[Sources] Failed to set cache for %s: %v", key, err)
	}
}
