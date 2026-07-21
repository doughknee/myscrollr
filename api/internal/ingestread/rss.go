package ingestread

// The rss widget source, folded in from channels/rss/api per ADR-0002
// (REL-16) — the last and only fold with real writes. Core now owns the
// feed-target tables (tracked_feeds, user_custom_feeds) that the Rust
// poller (channels/rss/service, unchanged) discovers URLs from, plus the
// auto-cleanup janitor. Route shapes, cache keys, and response bodies
// are identical to the proxied originals.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

const (
	// CacheKeyRSSPrefix is the Redis key prefix for per-user RSS item
	// caches. Must stay in sync with widgetUserCacheKeys (redis.go).
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
)

// RssItem represents an RSS article from the ingestion service.
type RssItem struct {
	ID          int        `json:"id"`
	FeedURL     string     `json:"feed_url"`
	GUID        string     `json:"guid"`
	Title       string     `json:"title"`
	Link        string     `json:"link"`
	Description string     `json:"description"`
	SourceName  string     `json:"source_name"`
	PublishedAt *time.Time `json:"published_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// TrackedFeed represents an RSS feed in the catalog.
type TrackedFeed struct {
	URL                 string     `json:"url"`
	Name                string     `json:"name"`
	Category            string     `json:"category"`
	IsDefault           bool       `json:"is_default"`
	ConsecutiveFailures int        `json:"consecutive_failures"`
	LastError           *string    `json:"last_error,omitempty"`
	LastSuccessAt       *time.Time `json:"last_success_at,omitempty"`
}

var rssCatalogGroup singleflight.Group

var rssSource = localSource{
	dashboard: rssDashboard,
	health:    rssHealth,
	// rss is the one source whose lifecycle does real work beyond cache
	// invalidation: it upserts the user's custom feeds into the
	// feed-target tables the Rust poller reads.
	lifecycle: rssLifecycle,
}

// RegisterRSSRoutes mounts the rss routes natively on core.
func RegisterRSSRoutes(app *fiber.App) {
	app.Get("/rss/feeds", platform.LogtoAuth, handleGetRSSFeedCatalog)
	app.Delete("/rss/feeds", platform.LogtoAuth, handleDeleteCustomFeed)
	app.Get("/rss/health", handleRSSHealth)
}

// handleGetRSSFeedCatalog returns the per-user feed catalog used by the
// desktop UI's "add feeds" picker.
//
// The catalog is the union of:
//   - Curated default feeds (tracked_feeds.is_default = true) — same for
//     every user
//   - The requesting user's own custom feeds (user_custom_feeds) —
//     joined to tracked_feeds for health metadata
//
// User A's custom feeds are NOT included in user B's catalog. Health
// filters apply in default mode; include_failing=true bypasses them so
// the desktop's My Feeds view can compute health badges for
// already-subscribed feeds.
func handleGetRSSFeedCatalog(c *fiber.Ctx) error {
	ctx := c.Context()
	includeFailing := c.Query("include_failing") == "true"

	userSub := platform.GetUserID(c)
	if userSub == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
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
	if cacheGetJSON(ctx, cacheKey, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	// Singleflight: collapse concurrent cache-miss requests into one DB query
	result, err, _ := rssCatalogGroup.Do(cacheKey, func() (interface{}, error) {
		return queryUserCatalog(ctx, userSub, includeFailing)
	})
	if err != nil {
		log.Printf("[RSS] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch feed catalog",
		})
	}
	catalog = result.([]TrackedFeed)
	if catalog == nil {
		catalog = make([]TrackedFeed, 0)
	}

	cacheSetJSON(ctx, cacheKey, catalog, RSSCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// queryUserCatalog runs the UNION query that backs the catalog endpoint:
// curated defaults (identical for every user) plus the requesting user's
// custom feeds LEFT-JOINed to tracked_feeds for health metadata. Both
// halves apply the same staleness threshold when !includeFailing:
// last_success_at within 7 days, or never polled, or added <24h ago
// (grace for newly-added custom feeds whose first poll hasn't completed).
func queryUserCatalog(ctx context.Context, userSub string, includeFailing bool) ([]TrackedFeed, error) {
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
	// also a curated default, exclude it here so the UNION never returns
	// the same URL twice. The runtime guard in syncRSSFeedsToTracked
	// prevents new pollution; this filter is defense in depth.
	customClauses := "WHERE ucf.logto_sub = $1 AND (tf.is_enabled IS NULL OR tf.is_enabled = true) AND NOT EXISTS (SELECT 1 FROM tracked_feeds tf2 WHERE tf2.url = ucf.url AND tf2.is_default = true)"
	if !includeFailing {
		curatedClauses += healthFilter
		customClauses += customFeedHealthFilter
	}

	// $1 = userSub (custom-feeds half), $2 = MaxConsecutiveFailures
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

	rows, qErr := platform.DBPool.Query(ctx, query, userSub, MaxConsecutiveFailures)
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
func invalidateUserCatalogCache(ctx context.Context, userSub string) {
	if userSub == "" {
		return
	}
	platform.Rdb.Del(ctx, CacheKeyRSSCatalog+":"+userSub)
	platform.Rdb.Del(ctx, CacheKeyRSSCatalog+":"+userSub+":all")
}

// invalidateAllCatalogCaches drops every per-user catalog cache entry.
// Used on the broad janitor cleanup. Implemented as a SCAN+DEL so we
// don't rely on knowing which users currently have cached entries.
func invalidateAllCatalogCaches(ctx context.Context) {
	prefix := CacheKeyRSSCatalog + ":"
	iter := platform.Rdb.Scan(ctx, 0, prefix+"*", 0).Iterator()
	for iter.Next(ctx) {
		platform.Rdb.Del(ctx, iter.Val())
	}
	if err := iter.Err(); err != nil {
		log.Printf("[RSS] catalog cache scan-delete failed: %v", err)
	}
}

// handleDeleteCustomFeed removes a custom feed for the requesting user.
//
//   - Drops the (logto_sub, url) row from user_custom_feeds.
//   - If no other user still subscribes to this URL AND it is not a
//     curated default, also drops the tracked_feeds row (rss_items
//     cascades via FK) so the Rust poller stops fetching it.
func handleDeleteCustomFeed(c *fiber.Ctx) error {
	ctx := c.Context()

	userSub := platform.GetUserID(c)
	if userSub == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&req); err != nil || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Request body must include a non-empty 'url' field",
		})
	}

	// Don't allow deletion of curated defaults — those are operator-owned.
	var isDefault bool
	if err := platform.DBPool.QueryRow(ctx,
		"SELECT is_default FROM tracked_feeds WHERE url = $1", req.URL).Scan(&isDefault); err == nil {
		if isDefault {
			return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{
				Status: "error",
				Error:  "Cannot delete a built-in default feed",
			})
		}
	}
	// No 404 if the URL isn't in tracked_feeds — the user_custom_feeds row
	// could exist without one in rare race scenarios. Proceed.

	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		log.Printf("[RSS] Failed to begin delete transaction for feed %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}
	defer tx.Rollback(ctx)

	// 1. Remove the requesting user's tenancy row (no-op if not subscribed).
	cmd, err := tx.Exec(ctx,
		"DELETE FROM user_custom_feeds WHERE logto_sub = $1 AND url = $2",
		userSub, req.URL)
	if err != nil {
		log.Printf("[RSS] Failed to delete user_custom_feeds row (%s, %s): %v", userSub, req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}
	rowsAffected := cmd.RowsAffected()

	// 2. If no user still subscribes, the URL is orphaned — drop
	//    tracked_feeds (cascades rss_items via FK).
	var otherSubscribers int
	if err := tx.QueryRow(ctx,
		"SELECT COUNT(*) FROM user_custom_feeds WHERE url = $1",
		req.URL).Scan(&otherSubscribers); err != nil {
		log.Printf("[RSS] Failed to count remaining subscribers for %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}

	orphaned := otherSubscribers == 0
	if orphaned {
		if _, err := tx.Exec(ctx,
			"DELETE FROM tracked_feeds WHERE url = $1 AND is_default = false",
			req.URL); err != nil {
			log.Printf("[RSS] Failed to delete orphaned tracked_feeds row %s: %v", req.URL, err)
			return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
				Status: "error",
				Error:  "Failed to delete feed",
			})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[RSS] Failed to commit delete transaction for feed %s: %v", req.URL, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to delete feed",
		})
	}

	invalidateUserCatalogCache(ctx, userSub)

	log.Printf("[RSS] User %s deleted custom feed %s (rows=%d, orphaned=%t)",
		userSub, req.URL, rowsAffected, orphaned)
	return c.JSON(fiber.Map{
		"status":   "ok",
		"message":  "Custom feed deleted",
		"orphaned": orphaned,
	})
}

// handleRSSHealth proxies the Rust rss service's full health payload for
// operators.
func handleRSSHealth(c *fiber.Ctx) error {
	return proxyIngestionHealth(c, os.Getenv("INTERNAL_RSS_URL"))
}

// rssHealth reports the rss ingestion status for /health.
func rssHealth(ctx context.Context) (string, bool) {
	internalURL := os.Getenv("INTERNAL_RSS_URL")
	if internalURL == "" {
		return "healthy", true
	}
	code, err := probeIngestion(ctx, internalURL)
	if err != nil || code != http.StatusOK {
		return "down", false
	}
	return "healthy", true
}

// rssDashboard returns the "rss" dashboard section for a user: the
// latest items across the feeds of their news/rss widgets.
func rssDashboard(ctx context.Context, userSub string) map[string]interface{} {
	cacheKey := CacheKeyRSSPrefix + userSub
	var items []RssItem
	if cacheGetJSON(ctx, cacheKey, &items) {
		return map[string]interface{}{"rss": items}
	}

	feedURLs := getUserRSSFeedURLs(ctx, userSub)
	if len(feedURLs) == 0 {
		return map[string]interface{}{"rss": []RssItem{}}
	}

	items = queryRSSItems(ctx, feedURLs)
	if items == nil {
		items = make([]RssItem, 0)
	}

	cacheSetJSON(ctx, cacheKey, items, RSSItemsCacheTTL)
	return map[string]interface{}{"rss": items}
}

// rssLifecycle handles channel lifecycle events in-process. Unlike the
// other local sources, rss does real work here: syncing the user's
// custom feed URLs into tracked_feeds/user_custom_feeds so the Rust
// poller discovers them. (The subscriber-set maintenance the proxied
// handler also did was write-only — ADR-0002 Appendix A — and is gone.)
func rssLifecycle(event, userSub string, config, oldConfig map[string]interface{}, enabled bool) {
	ctx := context.Background()
	switch event {
	case "created":
		go syncRSSFeedsToTracked(userSub, config)
	case "updated":
		if config == nil {
			return
		}
		platform.Rdb.Del(ctx, CacheKeyRSSPrefix+userSub)
		go syncRSSFeedsToTracked(userSub, config)
	case "deleted":
		platform.Rdb.Del(ctx, CacheKeyRSSPrefix+userSub)
	case "sync":
		// The proxied handler only warmed dead subscriber sets here.
	}
}

// getUserRSSFeedURLs unions the feed URLs across a user's news/rss widget
// channels. Post-widget-split a user has one row per curated feed
// (widget_type = 'news_bbc', …) plus 'rss_custom' for their own feeds —
// and a legacy coarse 'rss'/'news' row may still exist. Gather them all.
func getUserRSSFeedURLs(ctx context.Context, logtoSub string) []string {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT config FROM user_widgets
		WHERE logto_sub = $1
		  AND (widget_type LIKE 'news\_%'
		       OR widget_type LIKE 'rss\_%')
	`, logtoSub)
	if err != nil {
		return nil
	}
	defer rows.Close()
	seen := make(map[string]bool)
	var urls []string
	for rows.Next() {
		var configJSON []byte
		if err := rows.Scan(&configJSON); err != nil {
			continue
		}
		var config map[string]interface{}
		if err := json.Unmarshal(configJSON, &config); err != nil {
			continue
		}
		for _, u := range platform.ExtractFeedURLsFromConfig(config) {
			if !seen[u] {
				seen[u] = true
				urls = append(urls, u)
			}
		}
	}
	return urls
}

// queryRSSItems fetches the latest RSS items for the given feed URLs.
func queryRSSItems(ctx context.Context, feedURLs []string) []RssItem {
	if len(feedURLs) == 0 {
		return nil
	}

	rows, err := platform.DBPool.Query(ctx, `
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
// into tracked_feeds (the polling-target table, deduplicated on URL) and
// user_custom_feeds (the per-user visibility row the catalog reads).
// Curated-default URLs are skipped for the latter so the catalog UNION
// never re-labels them as "Custom".
func syncRSSFeedsToTracked(userSub string, config map[string]interface{}) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RSS] PANIC in syncRSSFeedsToTracked for user %s: %v", userSub, r)
		}
	}()

	// Dedicated timeout context — this runs in a background goroutine,
	// not tied to any HTTP request lifecycle.
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

	// Preload curated default URLs so we can skip writing duplicates into
	// user_custom_feeds.
	curatedURLs := make(map[string]struct{})
	curatedRows, curErr := platform.DBPool.Query(ctx, `SELECT url FROM tracked_feeds WHERE is_default = true`)
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

		// Global polling target, deduplicated on URL: two users adding
		// the same URL still get one row (the Rust service polls each
		// unique URL once). added_by records whoever was first.
		_, err := platform.DBPool.Exec(ctx, `
			INSERT INTO tracked_feeds (url, name, category, is_default, is_enabled, added_by)
			VALUES ($1, $2, 'Custom', false, true, $3)
			ON CONFLICT (url) DO NOTHING
		`, feed.URL, name, userSub)
		if err != nil {
			log.Printf("[RSS] Failed to sync feed %s to tracked_feeds: %v", feed.URL, err)
			continue
		}

		if _, isCurated := curatedURLs[feed.URL]; isCurated {
			continue
		}

		// Per-user visibility row. ON CONFLICT updates the name so
		// renaming an already-added feed works.
		_, err = platform.DBPool.Exec(ctx, `
			INSERT INTO user_custom_feeds (logto_sub, url, name, category)
			VALUES ($1, $2, $3, 'Custom')
			ON CONFLICT (logto_sub, url) DO UPDATE SET name = EXCLUDED.name
		`, userSub, feed.URL, name)
		if err != nil {
			log.Printf("[RSS] Failed to sync feed %s to user_custom_feeds for %s: %v", feed.URL, userSub, err)
		}
	}

	invalidateUserCatalogCache(ctx, userSub)
}

// =============================================================================
// Auto-cleanup janitor
// =============================================================================
//
// Recognises feeds that are definitively broken and removes them from the
// system (and from each subscribing user's config) so users aren't stuck
// with dead URLs. "Definitively broken" means: last_success_at older than
// 7 days, never polled and 7+ days old, or consecutive_failures >= 100
// (~8h of 5-min polling failures — more aggressive than the Rust-side
// 24h quarantine threshold, because this one auto-REMOVES).
//
// Custom feeds are fully removed (user_custom_feeds + tracked_feeds +
// cascaded rss_items + each subscriber's user_widgets.config.feeds[]);
// curated feeds are only disabled for operator follow-up.
//
// Runs on startup and every JanitorInterval. Idempotent. Core runs 2
// replicas (ADR-0001), so each pass is guarded by a Redis SET NX lock —
// one replica sweeps, the other skips.

const (
	// LastSuccessStaleThreshold is how old last_success_at may be before
	// the janitor classifies the feed as broken.
	LastSuccessStaleThreshold = "7 days"

	// MaxConsecutiveFailuresJanitor is the failure-count threshold for
	// auto-removal (100 cycles × 5 min ≈ 8h).
	MaxConsecutiveFailuresJanitor = 100

	// JanitorInterval is how often the cleanup runs.
	JanitorInterval = 6 * time.Hour

	// JanitorRunTimeout caps how long a single janitor cycle can run.
	JanitorRunTimeout = 5 * time.Minute

	// janitorLockKey is the Redis mutex that keeps the 2 core replicas
	// from sweeping concurrently. TTL outlives JanitorRunTimeout so a
	// crashed holder can't wedge the lock for more than one pass.
	janitorLockKey = "lock:rss-janitor"
	janitorLockTTL = 10 * time.Minute
)

// StartRSSJanitor launches the auto-cleanup loop in a goroutine. Runs
// once shortly after boot and then every JanitorInterval; exits cleanly
// when the root context is cancelled (SIGTERM during pod termination).
func StartRSSJanitor(rootCtx context.Context) {
	go func() {
		// Wait briefly so DB pool warmup etc. complete first.
		select {
		case <-time.After(30 * time.Second):
		case <-rootCtx.Done():
			return
		}

		log.Printf("[RSS Janitor] starting; interval=%s, last-success-threshold=%s, max-failures=%d",
			JanitorInterval, LastSuccessStaleThreshold, MaxConsecutiveFailuresJanitor)

		for {
			runJanitorOnce(rootCtx)

			select {
			case <-time.After(JanitorInterval):
				continue
			case <-rootCtx.Done():
				log.Printf("[RSS Janitor] stopping (root context cancelled)")
				return
			}
		}
	}()
}

// runJanitorOnce performs a single cleanup pass, guarded by the Redis
// replica lock. Idempotent; per-step errors are logged but don't abort
// the pass — partial cleanup beats none, and the next cycle picks up
// whatever this one missed.
func runJanitorOnce(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, JanitorRunTimeout)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RSS Janitor] PANIC during cleanup pass: %v", r)
		}
	}()

	// Replica lock: first pod in wins; the other skips this pass. The
	// lock expires on its own (no explicit release) — passes are 6h
	// apart, so holding the lock for the full TTL costs nothing and
	// keeps the failure mode simple.
	locked, err := platform.Rdb.SetNX(ctx, janitorLockKey, "1", janitorLockTTL).Result()
	if err != nil {
		log.Printf("[RSS Janitor] lock acquisition failed (skipping pass): %v", err)
		return
	}
	if !locked {
		log.Printf("[RSS Janitor] another replica holds the lock — skipping pass")
		return
	}

	// Step 1 — disable broken curated feeds (operator action required
	// for actual removal).
	disabled, err := disableBrokenCuratedFeeds(ctx)
	if err != nil {
		log.Printf("[RSS Janitor] disable curated step failed: %v", err)
	} else if disabled > 0 {
		log.Printf("[RSS Janitor] disabled %d broken curated feed(s) — operator action recommended", disabled)
	}

	// Step 2 — remove broken custom feeds (full cleanup).
	removed, err := removeBrokenCustomFeeds(ctx)
	if err != nil {
		log.Printf("[RSS Janitor] remove custom step failed: %v", err)
	} else if removed > 0 {
		log.Printf("[RSS Janitor] removed %d broken custom feed(s) and pruned subscriber configs", removed)
	}

	if disabled > 0 || removed > 0 {
		// Some catalogs may have stale content — drop every cached user
		// catalog so the next read sees the new state.
		invalidateAllCatalogCaches(ctx)
	}
}

// disableBrokenCuratedFeeds flips is_enabled = false on curated feeds
// that crossed the broken threshold. They are NOT removed — operators
// decide whether the curated catalog drops them entirely.
func disableBrokenCuratedFeeds(ctx context.Context) (int, error) {
	const q = `
		UPDATE tracked_feeds
		   SET is_enabled = false,
		       last_error = COALESCE(last_error, '') || ' [auto-disabled by janitor at ' || NOW()::text || ']'
		 WHERE is_default = true
		   AND is_enabled = true
		   AND (
			   (last_success_at IS NULL AND created_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `')
			OR last_success_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `'
			OR consecutive_failures >= $1
		   )
	`
	cmd, err := platform.DBPool.Exec(ctx, q, MaxConsecutiveFailuresJanitor)
	if err != nil {
		return 0, err
	}
	return int(cmd.RowsAffected()), nil
}

// removeBrokenCustomFeeds finds custom feeds past the broken threshold
// and removes them everywhere: each subscriber's
// user_widgets.config.feeds[] is pruned, user_custom_feeds rows are
// deleted, and the tracked_feeds row is dropped (rss_items cascades).
// Returns the count of unique URLs removed.
func removeBrokenCustomFeeds(ctx context.Context) (int, error) {
	const findQ = `
		SELECT url FROM tracked_feeds
		 WHERE is_default = false
		   AND (
			   (last_success_at IS NULL AND created_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `')
			OR last_success_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `'
			OR consecutive_failures >= $1
		   )
	`
	rows, err := platform.DBPool.Query(ctx, findQ, MaxConsecutiveFailuresJanitor)
	if err != nil {
		return 0, err
	}
	urls := make([]string, 0)
	for rows.Next() {
		var url string
		if scanErr := rows.Scan(&url); scanErr == nil {
			urls = append(urls, url)
		}
	}
	rows.Close()

	if len(urls) == 0 {
		return 0, nil
	}

	for _, url := range urls {
		// Prune user_widgets.config.feeds[] for each subscribing user.
		// The COALESCE handles filtering down to an empty set (jsonb_agg
		// returns NULL on empty input, but config.feeds must stay a JSON
		// array).
		if _, pruneErr := platform.DBPool.Exec(ctx, `
			UPDATE user_widgets
			   SET config = jsonb_set(
				   config,
				   '{feeds}',
				   COALESCE(
				       (SELECT jsonb_agg(item)
				        FROM jsonb_array_elements(config->'feeds') item
				        WHERE item->>'url' != $2),
				       '[]'::jsonb
				   )
			   )
			 WHERE (widget_type LIKE 'news\_%'
			        OR widget_type LIKE 'rss\_%')
			   AND config ? 'feeds'
			   AND config->'feeds' @> jsonb_build_array(jsonb_build_object('url', $2::text))
		`, MaxConsecutiveFailuresJanitor, url); pruneErr != nil {
			log.Printf("[RSS Janitor] prune user_widgets for %s failed: %v", url, pruneErr)
			// Continue — better to remove tracked_feeds with a few stale
			// user configs than skip the URL entirely.
		}

		if _, ucfErr := platform.DBPool.Exec(ctx,
			"DELETE FROM user_custom_feeds WHERE url = $1", url); ucfErr != nil {
			log.Printf("[RSS Janitor] delete user_custom_feeds for %s failed: %v", url, ucfErr)
		}

		// rss_items cascades via FK. Guard is_default defensively even
		// though the find query already filtered to customs.
		if _, tfErr := platform.DBPool.Exec(ctx,
			"DELETE FROM tracked_feeds WHERE url = $1 AND is_default = false", url); tfErr != nil {
			log.Printf("[RSS Janitor] delete tracked_feeds for %s failed: %v", url, tfErr)
		}
	}

	return len(urls), nil
}
