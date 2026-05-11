package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// CacheKeyRSSPrefix is the Redis key prefix for per-user RSS item caches.
	CacheKeyRSSPrefix = "cache:rss:"

	// CacheKeyRSSCatalog is the Redis key for the cached feed catalog.
	CacheKeyRSSCatalog = "cache:rss:catalog"

	// RSSItemsCacheTTL is how long per-user RSS items are cached.
	RSSItemsCacheTTL = 60 * time.Second

	// RSSCatalogCacheTTL is how long the feed catalog is cached.
	RSSCatalogCacheTTL = 5 * time.Minute

	// DefaultRSSItemsLimit caps the number of RSS items returned for dashboard.
	DefaultRSSItemsLimit = 50

	// MaxConsecutiveFailures is the threshold above which feeds are excluded
	// from the catalog.
	MaxConsecutiveFailures = 3

	// RedisRSSSubscribersPrefix is the Redis key prefix for per-feed-URL
	// subscriber sets.
	RedisRSSSubscribersPrefix = "rss:subscribers:"
)

// =============================================================================
// App
// =============================================================================

// App holds the shared dependencies for all handlers.
type App struct {
	db         *pgxpool.Pool
	rdb        *redis.Client
	httpClient *http.Client
	sfGroup    singleflight.Group
}

// =============================================================================
// Public Routes (proxied by core gateway)
// =============================================================================

// getRSSFeedCatalog returns the per-user feed catalog used by the
// desktop UI's "add feeds" picker.
//
// The catalog is the union of:
//   - Curated default feeds (tracked_feeds.is_default = true) — same for
//     every user
//   - The requesting user's own custom feeds (user_custom_feeds.logto_sub
//     = X-User-Sub) — joined to tracked_feeds for health metadata
//
// User A's custom feeds are NOT included in user B's catalog. This is
// the multi-tenancy guarantee that the pre-isolation catalog endpoint
// (which returned ALL tracked_feeds rows globally) violated.
//
// Health filters in default mode:
//   - is_enabled = true (operator-disabled curated feeds are hidden)
//   - consecutive_failures < MaxConsecutiveFailures (3, ~15 min of failures)
//   - last_success_at within 7 days OR feed was added < 24 hours ago (grace
//     for newly-added custom feeds whose first poll hasn't completed)
//
// include_failing=true bypasses the health filters so the desktop's My
// Feeds view can compute health badges for already-subscribed feeds.
//
// X-User-Sub is required (the route is now Auth: true on the gateway —
// see main.go discovery payload). Returns 401 if absent.
func (a *App) getRSSFeedCatalog(c *fiber.Ctx) error {
	ctx := c.Context()
	includeFailing := c.Query("include_failing") == "true"

	userSub := c.Get("X-User-Sub")
	if userSub == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	// Per-user cache key. The catalog content depends on which custom
	// feeds the user owns, so user A and user B can't share an entry.
	cacheKey := CacheKeyRSSCatalog + ":" + userSub
	if includeFailing {
		cacheKey += ":all"
	}

	var catalog []TrackedFeed
	if GetCache(a.rdb, ctx, cacheKey, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	// Singleflight: collapse concurrent cache-miss requests into one DB query
	result, err, _ := a.sfGroup.Do(cacheKey, func() (interface{}, error) {
		feeds, qErr := a.queryUserCatalog(ctx, userSub, includeFailing)
		if qErr != nil {
			return nil, qErr
		}
		return feeds, nil
	})
	if err != nil {
		log.Printf("[RSS] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch feed catalog",
		})
	}
	catalog = result.([]TrackedFeed)
	if catalog == nil {
		catalog = make([]TrackedFeed, 0)
	}

	SetCache(a.rdb, ctx, cacheKey, catalog, RSSCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// queryUserCatalog runs the actual UNION query that backs the catalog
// endpoint. Split out so it's testable independent of the HTTP wrapper.
//
// The query is a UNION ALL of two halves:
//
//  1. Curated defaults — pulled by every user identically. Health
//     filters apply (when !includeFailing).
//
//  2. The requesting user's custom feeds — joined to tracked_feeds for
//     health metadata via LEFT JOIN. Some custom feeds may not yet
//     have a tracked_feeds row at the moment of the query (rare race
//     between user_custom_feeds insert and tracked_feeds insert in
//     syncRSSFeedsToTracked); in that case the LEFT JOIN yields NULL
//     health columns, treated as healthy by the COALESCE logic below.
//
// Both halves apply the same staleness threshold:
//
//	last_success_at IS NULL  -- never polled OR
//	last_success_at > NOW() - 7 days  -- recently successful OR
//	created_at > NOW() - 24 hours  -- 24h grace for newly-added
//
// This filters out feeds that "look healthy" (consecutive_failures = 0)
// but haven't actually returned valid content in weeks (e.g. a feed that
// returns 200 with empty body — the failure counter resets on each
// "successful" empty response).
func (a *App) queryUserCatalog(ctx context.Context, userSub string, includeFailing bool) ([]TrackedFeed, error) {
	const healthFilter = `
		AND consecutive_failures < $2
		AND (
			last_success_at IS NULL
			OR last_success_at > NOW() - INTERVAL '7 days'
			OR created_at > NOW() - INTERVAL '24 hours'
		)
	`
	const customFeedHealthFilter = `
		AND (tf.consecutive_failures IS NULL OR tf.consecutive_failures < $2)
		AND (
			tf.last_success_at IS NULL
			OR tf.last_success_at > NOW() - INTERVAL '7 days'
			OR ucf.created_at > NOW() - INTERVAL '24 hours'
		)
	`

	curatedClauses := "WHERE is_default = true AND is_enabled = true"
	// Safety net: even if user_custom_feeds contains a row for a URL that's
	// also a curated default (from the pre-fix bug, or any other path), we
	// exclude it here so the UNION never returns the same URL twice. The
	// runtime guard in syncRSSFeedsToTracked prevents new pollution; the
	// 130000000002 cleanup migration drops historical pollution; this filter
	// is defense in depth.
	customClauses := "WHERE ucf.logto_sub = $1 AND (tf.is_enabled IS NULL OR tf.is_enabled = true) AND NOT EXISTS (SELECT 1 FROM tracked_feeds tf2 WHERE tf2.url = ucf.url AND tf2.is_default = true)"
	if !includeFailing {
		curatedClauses += healthFilter
		customClauses += customFeedHealthFilter
	}

	// $1 = userSub (used in the custom-feeds half)
	// $2 = MaxConsecutiveFailures (used by both halves when !includeFailing)
	query := `
		SELECT url, name, category, is_default, consecutive_failures, last_error, last_success_at
		FROM tracked_feeds
		` + curatedClauses + `

		UNION ALL

		SELECT
			ucf.url,
			ucf.name,
			ucf.category,
			false AS is_default,
			COALESCE(tf.consecutive_failures, 0) AS consecutive_failures,
			tf.last_error,
			tf.last_success_at
		FROM user_custom_feeds ucf
		LEFT JOIN tracked_feeds tf ON tf.url = ucf.url
		` + customClauses + `

		ORDER BY is_default DESC, category, name
	`

	var rows pgx.Rows
	var qErr error
	if includeFailing {
		rows, qErr = a.db.Query(ctx, query, userSub, MaxConsecutiveFailures)
	} else {
		rows, qErr = a.db.Query(ctx, query, userSub, MaxConsecutiveFailures)
	}
	if qErr != nil {
		return nil, qErr
	}
	defer rows.Close()

	var feeds []TrackedFeed
	for rows.Next() {
		var f TrackedFeed
		if err := rows.Scan(&f.URL, &f.Name, &f.Category, &f.IsDefault, &f.ConsecutiveFailures, &f.LastError, &f.LastSuccessAt); err != nil {
			log.Printf("[RSS] Catalog scan error: %v", err)
			continue
		}
		feeds = append(feeds, f)
	}
	return feeds, nil
}

// invalidateUserCatalogCache drops the per-user catalog cache entries so
// the next read sees fresh data. Called after any operation that mutates
// the user's custom-feed set (add, delete, janitor cleanup).
func (a *App) invalidateUserCatalogCache(ctx context.Context, userSub string) {
	if userSub == "" {
		return
	}
	a.rdb.Del(ctx, CacheKeyRSSCatalog+":"+userSub)
	a.rdb.Del(ctx, CacheKeyRSSCatalog+":"+userSub+":all")
}

// invalidateAllCatalogCaches drops every per-user cache entry. Used on
// curated-feed mutations (rare — operator action) or the broad janitor
// cleanup. Implemented as a SCAN+DEL so we don't rely on knowing which
// users currently have cached entries.
func (a *App) invalidateAllCatalogCaches(ctx context.Context) {
	prefix := CacheKeyRSSCatalog + ":"
	// SCAN with a match pattern. Cursor-based to avoid blocking Redis.
	iter := a.rdb.Scan(ctx, 0, prefix+"*", 0).Iterator()
	for iter.Next(ctx) {
		a.rdb.Del(ctx, iter.Val())
	}
	if err := iter.Err(); err != nil {
		log.Printf("[RSS] catalog cache scan-delete failed: %v", err)
	}
}

// deleteCustomFeed removes a custom feed for the requesting user.
// The core gateway sets X-User-Sub header for authenticated requests.
//
// Behavior:
//   - Drops the (logto_sub, url) row from user_custom_feeds. After this
//     the feed no longer appears in the user's catalog.
//   - If no other user still subscribes to this URL via user_custom_feeds
//     AND the URL is not a curated default, also drops the tracked_feeds
//     row and the rss_items it owned. Rust ingestion stops polling.
//   - If other users still subscribe (or it's a curated default), the
//     tracked_feeds row stays — only the requesting user's tenancy row
//     is removed.
//
// This is the architecturally-correct multi-tenant deletion: per-user
// removal of the user's own subscription, with global cleanup only when
// the last subscriber is gone.
func (a *App) deleteCustomFeed(c *fiber.Ctx) error {
	ctx := c.Context()

	userSub := c.Get("X-User-Sub")
	if userSub == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&req); err != nil || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Request body must include a non-empty 'url' field",
		})
	}

	// Don't allow deletion of curated defaults — those are operator-owned.
	var isDefault bool
	if err := a.db.QueryRow(ctx,
		"SELECT is_default FROM tracked_feeds WHERE url = $1", req.URL).Scan(&isDefault); err == nil {
		if isDefault {
			return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{
				Status: "error",
				Error:  "Cannot delete a built-in default feed",
			})
		}
	}
	// Note: we don't 404 if the URL isn't in tracked_feeds — the user_custom_feeds
	// row could exist without a corresponding tracked_feeds row in rare race
	// scenarios. Proceed to the user-scoped delete.

	tx, err := a.db.Begin(ctx)
	if err != nil {
		log.Printf("[RSS] Failed to begin delete transaction for feed %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}
	defer tx.Rollback(ctx)

	// 1. Remove the requesting user's tenancy row. If the user wasn't
	//    subscribed in the first place, this is a no-op (0 rows affected,
	//    not an error — caller may be retrying).
	cmd, err := tx.Exec(ctx,
		"DELETE FROM user_custom_feeds WHERE logto_sub = $1 AND url = $2",
		userSub, req.URL)
	if err != nil {
		log.Printf("[RSS] Failed to delete user_custom_feeds row (%s, %s): %v", userSub, req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}
	rowsAffected := cmd.RowsAffected()

	// 2. Check whether ANY user still subscribes to this URL. If yes,
	//    keep tracked_feeds + rss_items intact (some other user is
	//    reading this feed). If no, this URL is now orphaned — drop
	//    tracked_feeds (which cascades to rss_items via FK).
	var otherSubscribers int
	if err := tx.QueryRow(ctx,
		"SELECT COUNT(*) FROM user_custom_feeds WHERE url = $1",
		req.URL).Scan(&otherSubscribers); err != nil {
		log.Printf("[RSS] Failed to count remaining subscribers for %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}

	orphaned := otherSubscribers == 0
	if orphaned {
		// rss_items has FK on tracked_feeds.url with ON DELETE CASCADE,
		// so dropping tracked_feeds cleans up rss_items in the same statement.
		if _, err := tx.Exec(ctx,
			"DELETE FROM tracked_feeds WHERE url = $1 AND is_default = false",
			req.URL); err != nil {
			log.Printf("[RSS] Failed to delete orphaned tracked_feeds row %s: %v", req.URL, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "Failed to delete feed",
			})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[RSS] Failed to commit delete transaction for feed %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}

	// Cache invalidation: drop the requesting user's catalog cache, and
	// drop the per-feed-URL subscriber set if the URL was orphaned.
	a.invalidateUserCatalogCache(ctx, userSub)
	if orphaned {
		a.rdb.Del(ctx, RedisRSSSubscribersPrefix+req.URL)
	}

	log.Printf("[RSS] User %s deleted custom feed %s (rows=%d, orphaned=%t)",
		userSub, req.URL, rowsAffected, orphaned)
	return c.JSON(fiber.Map{
		"status":   "ok",
		"message":  "Custom feed deleted",
		"orphaned": orphaned,
	})
}

// healthHandler proxies a health check to the internal Rust RSS ingestion service.
func (a *App) healthHandler(c *fiber.Ctx) error {
	return ProxyInternalHealth(c, a.httpClient, os.Getenv("INTERNAL_RSS_URL"))
}

// =============================================================================
// Internal Routes (called by core gateway)
// =============================================================================

// handleInternalCDC receives CDC records from the core gateway and returns the
// list of users who should receive these records.
//
// RSS uses per-feed-URL routing: for each CDC record, we extract the feed_url
// field and look up which users are subscribed to that specific feed via the
// Redis set rss:subscribers:{feed_url}. The returned user list is the union
// of all subscribers across all feed URLs in the batch.
func (a *App) handleInternalCDC(c *fiber.Ctx) error {
	var req struct {
		Records []CDCRecord `json:"records"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	ctx := c.Context()

	// Collect unique feed URLs first
	urlSet := make(map[string]struct{})
	for _, rec := range req.Records {
		feedURL, ok := rec.Record["feed_url"].(string)
		if !ok || feedURL == "" {
			continue
		}
		urlSet[feedURL] = struct{}{}
	}

	if len(urlSet) == 0 {
		return c.JSON(fiber.Map{"users": []string{}})
	}

	// Pipeline all SMEMBERS calls into a single Redis round-trip
	pipe := a.rdb.Pipeline()
	cmds := make(map[string]*redis.StringSliceCmd, len(urlSet))
	for feedURL := range urlSet {
		cmds[feedURL] = pipe.SMembers(ctx, RedisRSSSubscribersPrefix+feedURL)
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		log.Printf("[RSS CDC] Redis pipeline failed: %v", err)
	}

	userSet := make(map[string]bool)
	for feedURL, cmd := range cmds {
		subs, err := cmd.Result()
		if err != nil {
			log.Printf("[RSS CDC] Failed to get subscribers for %s: %v", feedURL, err)
			continue
		}
		for _, sub := range subs {
			userSet[sub] = true
		}
	}

	users := make([]string, 0, len(userSet))
	for sub := range userSet {
		users = append(users, sub)
	}

	return c.JSON(fiber.Map{"users": users})
}

// handleInternalDashboard returns RSS items for a user's dashboard.
// Query param: user={logto_sub}
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	ctx := c.Context()

	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{"rss": []RssItem{}})
	}

	// Check per-user cache first
	cacheKey := CacheKeyRSSPrefix + userSub
	var items []RssItem
	if GetCache(a.rdb, ctx, cacheKey, &items) {
		return c.JSON(fiber.Map{"rss": items})
	}

	// Get user's RSS feed URLs from their channel config
	feedURLs := a.getUserRSSFeedURLs(ctx, userSub)
	if len(feedURLs) == 0 {
		return c.JSON(fiber.Map{"rss": []RssItem{}})
	}

	items = a.queryRSSItems(ctx, feedURLs)
	if items == nil {
		items = make([]RssItem, 0)
	}

	SetCache(a.rdb, ctx, cacheKey, items, RSSItemsCacheTTL)
	return c.JSON(fiber.Map{"rss": items})
}

// handleInternalHealth is the endpoint the core gateway and k8s probes hit.
//
// It verifies that this API's own dependencies (Postgres, Redis) are reachable
// and that the downstream Rust ingestion service's /health/ready returns 200.
// Any failure returns HTTP 503 so the k8s readinessProbe can mark the pod
// NotReady. Previously returned a static `{"status":"healthy"}` no matter what.
func (a *App) handleInternalHealth(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), InternalHealthTimeout)
	defer cancel()

	result := fiber.Map{"status": "healthy"}
	degraded := false

	if err := a.db.Ping(ctx); err != nil {
		result["database"] = "unhealthy: " + err.Error()
		degraded = true
	} else {
		result["database"] = "healthy"
	}

	if err := a.rdb.Ping(ctx).Err(); err != nil {
		result["redis"] = "unhealthy: " + err.Error()
		degraded = true
	} else {
		result["redis"] = "healthy"
	}

	if internalURL := os.Getenv("INTERNAL_RSS_URL"); internalURL != "" {
		code, ingestErr := probeIngestion(ctx, internalURL)
		result["ingestion_http_status"] = code
		if ingestErr != nil {
			result["ingestion"] = "unreachable: " + ingestErr.Error()
			degraded = true
		} else if code != fiber.StatusOK {
			result["ingestion"] = fmt.Sprintf("not ready: HTTP %d", code)
			degraded = true
		} else {
			result["ingestion"] = "healthy"
		}
	}

	if degraded {
		result["status"] = "degraded"
		return c.Status(fiber.StatusServiceUnavailable).JSON(result)
	}
	return c.JSON(result)
}

// =============================================================================
// Channel Lifecycle (RSS is the ONLY channel that implements this)
// =============================================================================

// handleChannelLifecycle handles channel lifecycle events dispatched by the core
// gateway. Events: created, updated, deleted, sync.
func (a *App) handleChannelLifecycle(c *fiber.Ctx) error {
	var req struct {
		Event     string                 `json:"event"`
		User      string                 `json:"user"`
		Config    map[string]interface{} `json:"config"`
		OldConfig map[string]interface{} `json:"old_config"`
		Enabled   bool                   `json:"enabled"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	ctx := c.Context()

	switch req.Event {
	case "created":
		a.onChannelCreated(req.User, req.Config)

	case "updated":
		a.onChannelUpdated(ctx, req.User, req.OldConfig, req.Config)

	case "deleted":
		a.onChannelDeleted(ctx, req.User, req.Config)

	case "sync":
		a.onSyncSubscriptions(ctx, req.User, req.Config, req.Enabled)

	default:
		log.Printf("[RSS Lifecycle] Unknown event: %s", req.Event)
	}

	return c.JSON(fiber.Map{"ok": true})
}

// onChannelCreated syncs feeds to tracked_feeds table when a new RSS channel
// is created. Runs in a goroutine so it doesn't block the response.
func (a *App) onChannelCreated(userSub string, config map[string]interface{}) {
	go a.syncRSSFeedsToTracked(userSub, config)
}

// onChannelUpdated handles feed list changes when a channel is updated.
// 1. Diffs old vs new feed URLs, removes user from stale subscriber sets
// 2. Invalidates per-user cache
// 3. Syncs new feeds to tracked_feeds
func (a *App) onChannelUpdated(ctx context.Context, userSub string, oldConfig, newConfig map[string]interface{}) {
	if newConfig == nil {
		return
	}

	// Diff old vs new feed URLs and remove user from stale subscriber sets
	oldFeedURLs := extractFeedURLsFromChannelConfig(oldConfig)
	newFeedURLs := extractFeedURLsFromChannelConfig(newConfig)
	newURLSet := make(map[string]bool, len(newFeedURLs))
	for _, u := range newFeedURLs {
		newURLSet[u] = true
	}
	for _, u := range oldFeedURLs {
		if !newURLSet[u] {
			RemoveSubscriber(a.rdb, ctx, RedisRSSSubscribersPrefix+u, userSub)
		}
	}

	// Invalidate per-user RSS cache
	a.rdb.Del(ctx, CacheKeyRSSPrefix+userSub)

	// Sync new feed URLs to tracked_feeds
	go a.syncRSSFeedsToTracked(userSub, newConfig)
}

// onChannelDeleted removes the user from all per-feed-URL subscriber sets and
// invalidates per-user cache when a channel is removed.
func (a *App) onChannelDeleted(ctx context.Context, userSub string, config map[string]interface{}) {
	feedURLs := extractFeedURLsFromChannelConfig(config)
	for _, url := range feedURLs {
		RemoveSubscriber(a.rdb, ctx, RedisRSSSubscribersPrefix+url, userSub)
	}
	a.rdb.Del(ctx, CacheKeyRSSPrefix+userSub)
}

// onSyncSubscriptions adds or removes the user from per-feed-URL subscriber
// sets based on the enabled flag. Called on dashboard load to warm sets.
func (a *App) onSyncSubscriptions(ctx context.Context, userSub string, config map[string]interface{}, enabled bool) {
	feedURLs := extractFeedURLsFromChannelConfig(config)
	for _, url := range feedURLs {
		if enabled {
			AddSubscriber(a.rdb, ctx, RedisRSSSubscribersPrefix+url, userSub)
		} else {
			RemoveSubscriber(a.rdb, ctx, RedisRSSSubscribersPrefix+url, userSub)
		}
	}
}

// =============================================================================
// Database Helpers
// =============================================================================

// getUserRSSFeedURLs extracts the feed URLs from a user's RSS channel config.
func (a *App) getUserRSSFeedURLs(ctx context.Context, logtoSub string) []string {
	var configJSON []byte
	err := a.db.QueryRow(ctx, `
		SELECT config FROM user_channels
		WHERE logto_sub = $1 AND channel_type = 'rss'
	`, logtoSub).Scan(&configJSON)
	if err != nil {
		return nil
	}
	return extractFeedURLsFromConfig(configJSON)
}

// queryRSSItems fetches the latest RSS items for the given feed URLs.
func (a *App) queryRSSItems(ctx context.Context, feedURLs []string) []RssItem {
	if len(feedURLs) == 0 {
		return nil
	}

	rows, err := a.db.Query(ctx, `
		SELECT id, feed_url, guid, title, link, description, source_name, published_at, created_at, updated_at
		FROM rss_items
		WHERE feed_url = ANY($1)
		ORDER BY published_at DESC NULLS LAST
		LIMIT $2
	`, feedURLs, DefaultRSSItemsLimit)
	if err != nil {
		log.Printf("[RSS] Items query failed: %v", err)
		return nil
	}
	defer rows.Close()

	items := make([]RssItem, 0, DefaultRSSItemsLimit)
	for rows.Next() {
		var item RssItem
		if err := rows.Scan(
			&item.ID, &item.FeedURL, &item.GUID, &item.Title, &item.Link,
			&item.Description, &item.SourceName, &item.PublishedAt,
			&item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			log.Printf("[RSS] Items scan error: %v", err)
			continue
		}
		items = append(items, item)
	}
	return items
}

// syncRSSFeedsToTracked upserts feed URLs from a user's RSS channel config
// into the tracked_feeds table so the RSS ingestion service discovers and
// fetches them.
func (a *App) syncRSSFeedsToTracked(userSub string, config map[string]interface{}) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RSS] PANIC in syncRSSFeedsToTracked for user %s: %v", userSub, r)
		}
	}()

	// Use a dedicated timeout context since this runs in a background goroutine
	// (not tied to any HTTP request lifecycle).
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	configJSON, err := json.Marshal(config)
	if err != nil {
		log.Printf("[RSS] Failed to marshal config for sync: %v", err)
		return
	}

	var parsed struct {
		Feeds []struct {
			URL  string `json:"url"`
			Name string `json:"name"`
		} `json:"feeds"`
	}
	if err := json.Unmarshal(configJSON, &parsed); err != nil {
		log.Printf("[RSS] Failed to parse feeds from config: %v", err)
		return
	}

	// Preload the set of curated default URLs so we can skip writing
	// duplicates into user_custom_feeds. Curated feeds already live in
	// tracked_feeds with is_default=true and are visible to every user
	// via the catalog UNION — writing them into user_custom_feeds would
	// re-label them under "Custom" (the bug we're fixing).
	curatedURLs := make(map[string]struct{})
	curatedRows, curErr := a.db.Query(ctx, `SELECT url FROM tracked_feeds WHERE is_default = true`)
	if curErr != nil {
		log.Printf("[RSS] Failed to load curated URLs for sync (continuing without dedup): %v", curErr)
	} else {
		for curatedRows.Next() {
			var u string
			if scanErr := curatedRows.Scan(&u); scanErr == nil {
				curatedURLs[u] = struct{}{}
			}
		}
		curatedRows.Close()
	}

	for _, feed := range parsed.Feeds {
		if feed.URL == "" {
			continue
		}
		name := feed.Name
		if name == "" {
			name = feed.URL
		}

		// Insert into the global tracked_feeds (the polling-target
		// table). We deduplicate on URL — two users adding the same
		// URL still get one row here, which is correct: the Rust
		// service polls each unique URL once. The added_by column
		// records whoever was first, kept for backwards-compat with
		// the legacy DELETE auth check; the user-tenancy concern is
		// now solved by the user_custom_feeds row below.
		_, err := a.db.Exec(ctx, `
			INSERT INTO tracked_feeds (url, name, category, is_default, is_enabled, added_by)
			VALUES ($1, $2, 'Custom', false, true, $3)
			ON CONFLICT (url) DO NOTHING
		`, feed.URL, name, userSub)
		if err != nil {
			log.Printf("[RSS] Failed to sync feed %s to tracked_feeds: %v", feed.URL, err)
			continue
		}

		// Skip the user_custom_feeds insert for URLs that are already
		// curated defaults. Curated feeds are surfaced to every user
		// via the catalog's curated half of the UNION; writing them
		// here would cause queryUserCatalog to return the URL twice
		// and FeedTab to re-label the row as "Custom".
		if _, isCurated := curatedURLs[feed.URL]; isCurated {
			continue
		}

		// Insert into the per-user user_custom_feeds. This is the
		// per-user-visibility row that the catalog endpoint reads.
		// Each user owns their own (name, category) for a given URL —
		// user A and user B can have different display names for the
		// same URL. ON CONFLICT updates the name to handle the case
		// where the user is renaming a feed they already added.
		_, err = a.db.Exec(ctx, `
			INSERT INTO user_custom_feeds (logto_sub, url, name, category)
			VALUES ($1, $2, $3, 'Custom')
			ON CONFLICT (logto_sub, url) DO UPDATE SET name = EXCLUDED.name
		`, userSub, feed.URL, name)
		if err != nil {
			log.Printf("[RSS] Failed to sync feed %s to user_custom_feeds for %s: %v", feed.URL, userSub, err)
		}
	}

	// Invalidate this user's catalog cache so their new custom feeds
	// appear immediately. Other users' caches are untouched (they
	// shouldn't have been seeing this user's feeds anyway after the
	// per-user split).
	a.invalidateUserCatalogCache(ctx, userSub)
}

// =============================================================================
// Config Parsing Helpers
// =============================================================================

// extractFeedURLsFromChannelConfig extracts feed URLs from a channel's config
// map by walking it directly (avoids a marshal→unmarshal round-trip).
func extractFeedURLsFromChannelConfig(config map[string]interface{}) []string {
	if config == nil {
		return nil
	}

	feedsRaw, ok := config["feeds"]
	if !ok {
		return nil
	}
	feedsSlice, ok := feedsRaw.([]interface{})
	if !ok {
		return nil
	}

	urls := make([]string, 0, len(feedsSlice))
	for _, item := range feedsSlice {
		feedMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if u, ok := feedMap["url"].(string); ok && u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

// extractFeedURLsFromConfig parses a config JSONB blob and returns feed URLs.
func extractFeedURLsFromConfig(configJSON []byte) []string {
	var config struct {
		Feeds []struct {
			URL string `json:"url"`
		} `json:"feeds"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}

	urls := make([]string, 0, len(config.Feeds))
	for _, f := range config.Feeds {
		if f.URL != "" {
			urls = append(urls, f.URL)
		}
	}
	return urls
}
