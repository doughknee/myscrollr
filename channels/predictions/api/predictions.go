package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// CacheKeyPredictions is the Redis key for cached market data (all markets).
	CacheKeyPredictions = "cache:predictions"

	// CacheKeyPredictionsPrefix is the Redis key prefix for per-user market caches.
	CacheKeyPredictionsPrefix = "cache:predictions:"

	// CacheKeyPredictionsCatalog is the Redis key for the cached market catalog.
	CacheKeyPredictionsCatalog = "cache:predictions:catalog"

	// PredictionsCacheTTL is how long market data is cached.
	PredictionsCacheTTL = 30 * time.Second

	// PredictionsCatalogCacheTTL is how long the market catalog is cached.
	PredictionsCatalogCacheTTL = 5 * time.Minute

	// CandlesticksCacheTTL bounds how often we hit Kalshi for a market's
	// price history (v1.1.4 detail-modal chart). Candles are hourly, so
	// five minutes keeps the modal snappy without hammering the signed API.
	CandlesticksCacheTTL = 5 * time.Minute

	// CandlesticksWindowDays is the fixed history window the modal shows.
	CandlesticksWindowDays = 7

	// RedisPredictionsSubscribersPrefix is the Redis key prefix for the
	// channel-wide predictions subscriber set. v1 routing is a channel-wide
	// broadcast, so the only set used is "predictions:subscribers:all"
	// alongside the core-maintained "channel:subscribers:predictions".
	RedisPredictionsSubscribersPrefix = "predictions:subscribers:"

	// RedisChannelSubscribersPrefix is the core-gateway-maintained per-channel
	// subscriber set prefix. The key "channel:subscribers:predictions" holds
	// every user who has the predictions channel enabled — the v1 broadcast
	// audience.
	RedisChannelSubscribersPrefix = "channel:subscribers:"

	// MarketsQuery is the SQL used to fetch all tracked markets for display.
	// COALESCE guards against NULL columns for rows that have been inserted
	// but not yet updated by the Rust ingestion service.
	MarketsQuery = `
		SELECT
			id,
			COALESCE(source, 'kalshi'),
			ticker,
			COALESCE(event_ticker, ''),
			COALESCE(event_title, ''),
			COALESCE(event_rank, 1),
			COALESCE(category, 'Other'),
			COALESCE(title, ''),
			COALESCE(subtitle, ''),
			COALESCE(yes_price, 0),
			COALESCE(yes_bid, 0),
			COALESCE(yes_ask, 0),
			COALESCE(prev_yes_price, 0),
			COALESCE(volume, 0),
			COALESCE(open_interest, 0),
			COALESCE(status, ''),
			COALESCE(result, ''),
			close_time,
			COALESCE(link, ''),
			COALESCE(updated_at, created_at)
		FROM markets
		WHERE is_primary = true OR event_rank = 2
		ORDER BY volume DESC, ticker ASC`
)

// =============================================================================
// App
// =============================================================================

// App holds the shared dependencies for all handlers.
type App struct {
	db  *pgxpool.Pool
	rdb *redis.Client
}

// =============================================================================
// Public Routes (proxied by core gateway)
// =============================================================================

// getPredictions retrieves the latest prediction markets.
// The core gateway adds X-User-Sub header for authenticated requests.
func (a *App) getPredictions(c *fiber.Ctx) error {
	var predictions []Prediction
	if GetCache(a.rdb, CacheKeyPredictions, &predictions) {
		c.Set("X-Cache", "HIT")
		return c.JSON(predictions)
	}

	predictions, err := a.queryMarkets(context.Background())
	if err != nil {
		log.Printf("[Predictions] getPredictions query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	SetCache(a.rdb, CacheKeyPredictions, predictions, PredictionsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(predictions)
}

// getCatalog returns all enabled tracked markets for the dashboard
// market browser.
func (a *App) getCatalog(c *fiber.Ctx) error {
	var catalog []TrackedMarket
	if GetCache(a.rdb, CacheKeyPredictionsCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	rows, err := a.db.Query(context.Background(),
		"SELECT ticker, COALESCE(title, ticker), COALESCE(category, 'Other') FROM tracked_markets WHERE is_enabled = true ORDER BY category, ticker")
	if err != nil {
		log.Printf("[Predictions] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch market catalog",
		})
	}
	defer rows.Close()

	catalog = make([]TrackedMarket, 0)
	for rows.Next() {
		var m TrackedMarket
		if err := rows.Scan(&m.Ticker, &m.Title, &m.Category); err != nil {
			log.Printf("[Predictions] Catalog scan error: %v", err)
			continue
		}
		catalog = append(catalog, m)
	}

	SetCache(a.rdb, CacheKeyPredictionsCatalog, catalog, PredictionsCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// healthHandler proxies a health check to the internal Rust predictions service.
func (a *App) healthHandler(c *fiber.Ctx) error {
	return ProxyInternalHealth(c, os.Getenv("INTERNAL_PREDICTIONS_URL"))
}

// getCandlesticks returns a market's price history for the desktop
// detail-modal chart (v1.1.4): the last CandlesticksWindowDays of hourly
// candles, proxied from the internal Rust service (which holds the Kalshi
// credentials) and cached in Redis. This API owns the series-ticker lookup
// so the Rust side stays a pure signed pass-through.
func (a *App) getCandlesticks(c *fiber.Ctx) error {
	ticker := strings.TrimSpace(c.Params("ticker"))
	if ticker == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "ticker is required",
		})
	}
	ctx := context.Background()

	cacheKey := "cache:predictions:candles:" + ticker
	if cached, err := a.rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
		c.Set("X-Cache", "HIT")
		c.Set("Content-Type", "application/json")
		return c.SendString(cached)
	}

	var series string
	err := a.db.QueryRow(ctx,
		"SELECT COALESCE(series_ticker, '') FROM markets WHERE ticker = $1",
		ticker,
	).Scan(&series)
	if err != nil || series == "" {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error", Error: "unknown market",
		})
	}

	internalURL := strings.TrimRight(os.Getenv("INTERNAL_PREDICTIONS_URL"), "/")
	if internalURL == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "error", Error: "ingestion service not configured",
		})
	}

	end := time.Now().Unix()
	start := end - CandlesticksWindowDays*24*3600
	proxyURL := fmt.Sprintf(
		"%s/internal/candlesticks?series=%s&ticker=%s&start_ts=%d&end_ts=%d&period_interval=60",
		internalURL, url.QueryEscape(series), url.QueryEscape(ticker), start, end,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, proxyURL, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "failed to build upstream request",
		})
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		log.Printf("[Predictions] Candlesticks proxy failed for %s: %v", ticker, err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error", Error: "history unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("[Predictions] Candlesticks upstream %d for %s: %v", resp.StatusCode, ticker, err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error", Error: "history unavailable",
		})
	}

	if err := a.rdb.Set(ctx, cacheKey, string(body), CandlesticksCacheTTL).Err(); err != nil {
		log.Printf("[Predictions] Candlesticks cache write failed for %s: %v", ticker, err)
	}

	c.Set("X-Cache", "MISS")
	c.Set("Content-Type", "application/json")
	return c.Send(body)
}

// =============================================================================
// Internal Routes (called by core gateway)
// =============================================================================

// handleInternalCDC receives CDC records from the core gateway and returns the
// list of users who should receive these records.
//
// v1 routing is a channel-wide BROADCAST: predictions does not route per-market
// in v1, so the handler returns every user who has the predictions channel
// enabled (the members of the core-maintained channel:subscribers:predictions
// set). The CDC records themselves are not inspected beyond confirming the batch
// is non-empty.
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

	ctx := context.Background()

	// Channel-wide broadcast: every subscriber of the predictions channel
	// receives every market update in v1.
	subs, err := GetSubscribers(a.rdb, ctx, RedisChannelSubscribersPrefix+"predictions")
	if err != nil {
		log.Printf("[Predictions CDC] Failed to get channel subscribers: %v", err)
		return c.JSON(fiber.Map{"users": []string{}})
	}

	return c.JSON(fiber.Map{"users": subs})
}

// handleInternalDashboard returns predictions data for a user's dashboard.
// Query param: user={logto_sub}
//
// v1 has no per-market routing, so a user's markets are simply all enabled
// markets. If the user's channel config narrows the view via favorites or
// categories, those are honored; otherwise the full enabled set is returned.
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{"predictions": []Prediction{}})
	}

	// Check per-user cache first
	cacheKey := CacheKeyPredictionsPrefix + userSub
	var predictions []Prediction
	if GetCache(a.rdb, cacheKey, &predictions) {
		return c.JSON(fiber.Map{"predictions": predictions})
	}

	// Resolve the user's view: their favorites/categories from channel config,
	// falling back to all enabled markets.
	favorites, categories := a.getUserPredictionsConfig(userSub)
	predictions = a.queryMarketsForUser(favorites, categories)
	if predictions == nil {
		predictions = make([]Prediction, 0)
	}

	SetCache(a.rdb, cacheKey, predictions, PredictionsCacheTTL)
	return c.JSON(fiber.Map{"predictions": predictions})
}

// handleInternalHealth is the endpoint the core gateway and k8s probes hit.
//
// It verifies that this API's own dependencies (Postgres, Redis) are reachable
// and that the downstream Rust ingestion service's /health/ready returns 200.
// Any failure returns HTTP 503 so the k8s readinessProbe can mark the pod
// NotReady and stop routing traffic.
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

	if internalURL := os.Getenv("INTERNAL_PREDICTIONS_URL"); internalURL != "" {
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
// Channel Lifecycle
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

	ctx := context.Background()

	switch req.Event {
	case "created":
		// No special action needed on create — sync event handles subscriber sets
		log.Printf("[Predictions Lifecycle] Channel created for user %s", req.User)

	case "updated":
		a.onChannelUpdated(ctx, req.User)

	case "deleted":
		a.onChannelDeleted(ctx, req.User)

	case "sync":
		a.onSyncSubscriptions(ctx, req.User, req.Enabled)

	default:
		log.Printf("[Predictions Lifecycle] Unknown event: %s", req.Event)
	}

	return c.JSON(fiber.Map{"ok": true})
}

// onChannelUpdated invalidates the per-user cache when a channel is updated.
// v1 routing is channel-wide, so there are no per-market subscriber sets to
// diff — only the user's narrowed dashboard view (favorites/categories) can
// change, which the cache bust forces a re-resolve of.
func (a *App) onChannelUpdated(ctx context.Context, userSub string) {
	a.rdb.Del(ctx, CacheKeyPredictionsPrefix+userSub)
}

// onChannelDeleted removes the user from the channel-wide subscriber set and
// invalidates per-user cache when a channel is removed.
func (a *App) onChannelDeleted(ctx context.Context, userSub string) {
	RemoveSubscriber(a.rdb, ctx, RedisChannelSubscribersPrefix+"predictions", userSub)
	a.rdb.Del(ctx, CacheKeyPredictionsPrefix+userSub)
}

// onSyncSubscriptions adds or removes the user from the channel-wide subscriber
// set based on the enabled flag. Called on dashboard load to warm the set.
func (a *App) onSyncSubscriptions(ctx context.Context, userSub string, enabled bool) {
	setKey := RedisChannelSubscribersPrefix + "predictions"
	if enabled {
		AddSubscriber(a.rdb, ctx, setKey, userSub)
	} else {
		RemoveSubscriber(a.rdb, ctx, setKey, userSub)
	}
}

// =============================================================================
// Database Helpers
// =============================================================================

// queryMarkets fetches all primary markets from PostgreSQL.
func (a *App) queryMarkets(ctx context.Context) ([]Prediction, error) {
	rows, err := a.db.Query(ctx, MarketsQuery)
	if err != nil {
		return nil, fmt.Errorf("predictions query failed: %w", err)
	}
	defer rows.Close()

	predictions := make([]Prediction, 0)
	for rows.Next() {
		var p Prediction
		if err := rows.Scan(
			&p.ID, &p.Source, &p.Ticker, &p.EventTicker, &p.EventTitle,
			&p.EventRank, &p.Category, &p.Title,
			&p.Subtitle, &p.YesPrice, &p.YesBid, &p.YesAsk, &p.PrevYesPrice,
			&p.Volume, &p.OpenInterest, &p.Status, &p.Result, &p.CloseTime,
			&p.Link, &p.UpdatedAt,
		); err != nil {
			log.Printf("[Predictions] Row scan failed: %v", err)
			continue
		}
		predictions = append(predictions, p)
	}

	return predictions, nil
}

// queryMarketsForUser fetches the markets that make up a user's dashboard view.
//
// `categories` narrows the universe (empty = everything). `favorites` is
// the desktop WATCHLIST MIRROR (v1.1.4): those tickers are unioned in on
// top of the universe, so a starred market always reaches the client even
// when Configure's category filter would exclude it — a star means
// "always show me this". Pre-1.1.4 clients that treated favorites as an
// exclusive pin list still see their pins (now alongside the universe
// every unpinned user always saw).
func (a *App) queryMarketsForUser(favorites, categories []string) []Prediction {
	ctx := context.Background()

	if len(favorites) == 0 && len(categories) == 0 {
		// v1 default: everyone sees everything.
		predictions, err := a.queryMarkets(ctx)
		if err != nil {
			log.Printf("[Predictions] queryMarketsForUser default query failed: %v", err)
			return nil
		}
		return predictions
	}

	rows, err := a.db.Query(ctx, `
		SELECT
			id, COALESCE(source, 'kalshi'), ticker, COALESCE(event_ticker, ''),
			COALESCE(event_title, ''), COALESCE(event_rank, 1),
			COALESCE(category, 'Other'), COALESCE(title, ''), COALESCE(subtitle, ''),
			COALESCE(yes_price, 0), COALESCE(yes_bid, 0), COALESCE(yes_ask, 0),
			COALESCE(prev_yes_price, 0), COALESCE(volume, 0), COALESCE(open_interest, 0),
			COALESCE(status, ''), COALESCE(result, ''), close_time,
			COALESCE(link, ''), COALESCE(updated_at, created_at)
		FROM markets
		WHERE ((is_primary = true OR event_rank = 2)
		       AND (cardinality($1::text[]) = 0 OR category = ANY($1)))
		   OR ticker = ANY($2)
		ORDER BY volume DESC, ticker ASC
	`, categories, favorites)
	return scanMarkets(rows, err)
}

// scanMarkets scans a markets result set into a slice of Prediction. It accepts
// the (rows, err) pair from a Query call to keep call sites terse.
func scanMarkets(rows pgx.Rows, err error) []Prediction {
	if err != nil {
		log.Printf("[Predictions] Markets query failed: %v", err)
		return nil
	}
	defer rows.Close()

	predictions := make([]Prediction, 0)
	for rows.Next() {
		var p Prediction
		if err := rows.Scan(
			&p.ID, &p.Source, &p.Ticker, &p.EventTicker, &p.EventTitle,
			&p.EventRank, &p.Category, &p.Title,
			&p.Subtitle, &p.YesPrice, &p.YesBid, &p.YesAsk, &p.PrevYesPrice,
			&p.Volume, &p.OpenInterest, &p.Status, &p.Result, &p.CloseTime,
			&p.Link, &p.UpdatedAt,
		); err != nil {
			log.Printf("[Predictions] Row scan failed: %v", err)
			continue
		}
		predictions = append(predictions, p)
	}
	return predictions
}

// getUserPredictionsConfig extracts the favorites and categories lists from a
// user's predictions channel config.
func (a *App) getUserPredictionsConfig(logtoSub string) (favorites, categories []string) {
	var configJSON []byte
	err := a.db.QueryRow(context.Background(), `
		SELECT config FROM user_channels
		WHERE logto_sub = $1 AND channel_type = 'predictions'
	`, logtoSub).Scan(&configJSON)
	if err != nil {
		return nil, nil
	}
	return extractFavoritesFromConfig(configJSON), extractCategoriesFromConfig(configJSON)
}

// =============================================================================
// Config Parsing Helpers
// =============================================================================

// predictionsConfig mirrors the user_channels.config JSONB shape for
// channel_type=predictions: {"categories": [...], "favorites": [...]}.
type predictionsConfig struct {
	Categories []string `json:"categories"`
	Favorites  []string `json:"favorites"`
}

// extractFavoritesFromChannelConfig extracts favorites from a channel's config map.
func extractFavoritesFromChannelConfig(config map[string]interface{}) []string {
	if config == nil {
		return nil
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return nil
	}
	return extractFavoritesFromConfig(configJSON)
}

// extractFavoritesFromConfig parses a config JSONB blob and returns favorites.
func extractFavoritesFromConfig(configJSON []byte) []string {
	var config predictionsConfig
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}
	return filterEmpty(config.Favorites)
}

// extractCategoriesFromConfig parses a config JSONB blob and returns categories.
func extractCategoriesFromConfig(configJSON []byte) []string {
	var config predictionsConfig
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}
	return filterEmpty(config.Categories)
}

// filterEmpty returns a copy of the slice with empty strings removed.
func filterEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
