package ingestread

// The predictions widget source, folded in from channels/predictions/api
// per ADR-0002 (REL-15). Route shapes, cache keys, and response bodies
// are identical to the proxied originals. The Rust ingester
// (channels/predictions/service) is unchanged — it holds the Kalshi
// credentials, runs the curated sweep, and serves the signed
// candlesticks pass-through; INTERNAL_PREDICTIONS_URL points at it.

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

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const (
	// CacheKeyPredictions is the Redis key for cached market data (all markets).
	CacheKeyPredictions = "cache:predictions"

	// CacheKeyPredictionsPrefix is the Redis key prefix for per-user market
	// caches. Must stay in sync with widgetUserCacheKeys (redis.go).
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

	// marketsSelectList is the shared column list for market display
	// queries. COALESCE guards against NULL columns for rows that have been
	// inserted but not yet updated by the Rust ingestion service. Scan order
	// must match scanMarkets.
	marketsSelectList = `
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
			COALESCE(volume_24h, 0),
			COALESCE(open_interest, 0),
			COALESCE(in_sweep, TRUE),
			COALESCE(status, ''),
			COALESCE(result, ''),
			settled_at,
			close_time,
			COALESCE(link, ''),
			COALESCE(updated_at, created_at)`

	// marketsLiveWhere is the "live curated set" predicate (v1.1.5): rows in
	// the current sweep selection that haven't passed close or settled. The
	// close_time guard is a zombie backstop only — Kalshi sets close_time
	// weeks past real settlement, so it can't DETECT settlement (that's what
	// in_sweep + the lifecycle/recheck status writes are for), but a row
	// past its close is definitively not live.
	marketsLiveWhere = `in_sweep = TRUE
			AND (is_primary = TRUE OR event_rank = 2)
			AND (close_time IS NULL OR close_time > now())
			AND lower(COALESCE(status, '')) NOT IN ('settled', 'determined', 'finalized')`

	// marketsResolvedRecentlyWhere keeps just-settled markets in the payload
	// for the desktop's "Resolved today" strip, regardless of sweep
	// membership (settled markets leave the sweep by definition). Keyed on
	// settled_at — the once-stamped resolution transition — NOT updated_at,
	// which any write refreshes.
	marketsResolvedRecentlyWhere = `settled_at IS NOT NULL
			AND settled_at > now() - interval '24 hours'`

	// MarketsQuery fetches every market the widget may display: the live
	// curated set plus the trailing-24h resolved rows. Ordered by 24h volume
	// (liveliness) — all-time volume never shrinks, so settled giants would
	// permanently outrank live markets (the v1.1.4 stale-feed bug).
	MarketsQuery = `
		SELECT` + marketsSelectList + `
		FROM markets
		WHERE (` + marketsLiveWhere + `)
		   OR (` + marketsResolvedRecentlyWhere + `)
		ORDER BY volume_24h DESC NULLS LAST, volume DESC, ticker ASC`
)

// Prediction represents a single tracked Kalshi market for display.
//
// Pricing is stored as integer cents 0–100 (== implied probability %),
// derived from Kalshi's *_dollars decimal strings. JSON keys mirror the
// `markets` table column names (snake_case). See channels/predictions/CONTRACT.md.
type Prediction struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Ticker      string `json:"ticker"`
	EventTicker string `json:"event_ticker,omitempty"`
	// EventTitle is the event's human question ("More tech layoffs in
	// 2026 than in 2025?") — the market's own Title is just its leg
	// ("Yes", "Atlanta"). EventRank orders legs within an event
	// (1 = most liquid / is_primary, 2 = second outcome). v1.1.4.
	EventTitle   string `json:"event_title,omitempty"`
	EventRank    int    `json:"event_rank,omitempty"`
	Category     string `json:"category,omitempty"`
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle,omitempty"`
	YesPrice     int    `json:"yes_price"`
	YesBid       int    `json:"yes_bid,omitempty"`
	YesAsk       int    `json:"yes_ask,omitempty"`
	PrevYesPrice int    `json:"prev_yes_price,omitempty"`
	Volume       int64  `json:"volume,omitempty"`
	// Volume24h is the trailing-24h contract volume (refreshed by the
	// catalog sweep). Drives the desktop's "Trending" sort — all-time
	// Volume never shrinks, so it can't rank liveliness. v1.1.5.
	Volume24h    int64 `json:"volume_24h,omitempty"`
	OpenInterest int64 `json:"open_interest,omitempty"`
	// InSweep is false once the market drops out of the curated sweep
	// selection (settled / delisted / out-ranked). Such rows only appear
	// in the payload while recently resolved ("Resolved today"); clients
	// must not render them as live markets. No omitempty — false is the
	// meaningful value. v1.1.5.
	InSweep bool   `json:"in_sweep"`
	Status  string `json:"status,omitempty"`
	Result  string `json:"result,omitempty"`
	// SettledAt is when the market transitioned into a resolved state
	// (stamped once by the ingestion service). Drives "Resolved today";
	// updated_at is unusable for that — any write refreshes it. v1.1.5.
	SettledAt *time.Time `json:"settled_at,omitempty"`
	CloseTime *time.Time `json:"close_time,omitempty"`
	Link      string     `json:"link,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

// TrackedMarket represents a market entry from the catalog.
type TrackedMarket struct {
	Ticker   string `json:"ticker"`
	Title    string `json:"title"`
	Category string `json:"category"`
}

var predictionsSource = localSource{
	dashboard:      predictionsDashboard,
	health:         predictionsHealth,
	invalidateUser: invalidatePredictionsUserCache,
}

// RegisterPredictionsRoutes mounts the predictions routes natively on core.
func RegisterPredictionsRoutes(app *fiber.App) {
	app.Get("/predictions", platform.LogtoAuth, handleGetPredictions)
	app.Get("/predictions/public", handleGetPredictions)
	app.Get("/predictions/health", handlePredictionsHealth)
	app.Get("/predictions/catalog", handleGetMarketCatalog)
	app.Get("/predictions/candlesticks/:ticker", platform.LogtoAuth, handleGetCandlesticks)
}

// handleGetPredictions returns the latest prediction markets (the same
// payload for authenticated and public callers, served from one cache).
func handleGetPredictions(c *fiber.Ctx) error {
	ctx := context.Background()
	var predictions []Prediction
	if cacheGetJSON(ctx, CacheKeyPredictions, &predictions) {
		c.Set("X-Cache", "HIT")
		return c.JSON(predictions)
	}

	predictions, err := queryMarkets(ctx)
	if err != nil {
		log.Printf("[Predictions] getPredictions query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	cacheSetJSON(ctx, CacheKeyPredictions, predictions, PredictionsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(predictions)
}

// handleGetMarketCatalog returns all enabled tracked markets for the
// dashboard market browser.
func handleGetMarketCatalog(c *fiber.Ctx) error {
	ctx := context.Background()
	var catalog []TrackedMarket
	if cacheGetJSON(ctx, CacheKeyPredictionsCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	rows, err := platform.DBPool.Query(ctx,
		"SELECT ticker, COALESCE(title, ticker), COALESCE(category, 'Other') FROM tracked_markets WHERE is_enabled = true ORDER BY category, ticker")
	if err != nil {
		log.Printf("[Predictions] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
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

	cacheSetJSON(ctx, CacheKeyPredictionsCatalog, catalog, PredictionsCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// handlePredictionsHealth proxies the Rust predictions service's full
// health payload for operators.
func handlePredictionsHealth(c *fiber.Ctx) error {
	return proxyIngestionHealth(c, os.Getenv("INTERNAL_PREDICTIONS_URL"))
}

// predictionsHealth reports the predictions ingestion status for /health.
func predictionsHealth(ctx context.Context) (string, bool) {
	internalURL := os.Getenv("INTERNAL_PREDICTIONS_URL")
	if internalURL == "" {
		return "healthy", true
	}
	code, err := probeIngestion(ctx, internalURL)
	if err != nil || code != http.StatusOK {
		return "down", false
	}
	return "healthy", true
}

// handleGetCandlesticks returns a market's price history for the desktop
// detail-modal chart (v1.1.4): the last CandlesticksWindowDays of hourly
// candles, proxied from the internal Rust service (which holds the Kalshi
// credentials) and cached in Redis. Core owns the series-ticker lookup so
// the Rust side stays a pure signed pass-through.
func handleGetCandlesticks(c *fiber.Ctx) error {
	ticker := strings.TrimSpace(c.Params("ticker"))
	if ticker == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "ticker is required",
		})
	}
	ctx := context.Background()

	cacheKey := "cache:predictions:candles:" + ticker
	if cached, err := platform.Rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
		c.Set("X-Cache", "HIT")
		c.Set("Content-Type", "application/json")
		return c.SendString(cached)
	}

	var series string
	err := platform.DBPool.QueryRow(ctx,
		"SELECT COALESCE(series_ticker, '') FROM markets WHERE ticker = $1",
		ticker,
	).Scan(&series)
	if err != nil || series == "" {
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
			Status: "error", Error: "unknown market",
		})
	}

	internalURL := strings.TrimRight(os.Getenv("INTERNAL_PREDICTIONS_URL"), "/")
	if internalURL == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{
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
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "failed to build upstream request",
		})
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		log.Printf("[Predictions] Candlesticks proxy failed for %s: %v", ticker, err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{
			Status: "error", Error: "history unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("[Predictions] Candlesticks upstream %d for %s: %v", resp.StatusCode, ticker, err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{
			Status: "error", Error: "history unavailable",
		})
	}

	if err := platform.Rdb.Set(ctx, cacheKey, string(body), CandlesticksCacheTTL).Err(); err != nil {
		log.Printf("[Predictions] Candlesticks cache write failed for %s: %v", ticker, err)
	}

	c.Set("X-Cache", "MISS")
	c.Set("Content-Type", "application/json")
	return c.Send(body)
}

// predictionsDashboard returns the "predictions" dashboard section for a
// user.
//
// v1 has no per-market routing, so a user's markets are simply all enabled
// markets. If the user's channel config narrows the view via favorites or
// categories, those are honored; otherwise the full enabled set is
// returned from ONE shared cache entry (the same key handleGetPredictions
// uses) instead of a duplicate per-user copy in Redis.
func predictionsDashboard(ctx context.Context, userSub string) map[string]interface{} {
	favorites, categories := getUserPredictionsConfig(ctx, userSub)
	if len(favorites) == 0 && len(categories) == 0 {
		var predictions []Prediction
		if cacheGetJSON(ctx, CacheKeyPredictions, &predictions) {
			return map[string]interface{}{"predictions": predictions}
		}
		predictions, err := queryMarkets(ctx)
		if err != nil {
			log.Printf("[Predictions] Dashboard query failed: %v", err)
			return map[string]interface{}{"predictions": []Prediction{}}
		}
		cacheSetJSON(ctx, CacheKeyPredictions, predictions, PredictionsCacheTTL)
		return map[string]interface{}{"predictions": predictions}
	}

	// Narrowed view (pre-v1.1.5 client config): cached per user.
	cacheKey := CacheKeyPredictionsPrefix + userSub
	var predictions []Prediction
	if cacheGetJSON(ctx, cacheKey, &predictions) {
		return map[string]interface{}{"predictions": predictions}
	}

	predictions = queryMarketsForUser(ctx, favorites, categories)
	if predictions == nil {
		predictions = make([]Prediction, 0)
	}

	cacheSetJSON(ctx, cacheKey, predictions, PredictionsCacheTTL)
	return map[string]interface{}{"predictions": predictions}
}

// invalidatePredictionsUserCache drops the per-user narrowed-view cache
// after a predictions widget config change.
func invalidatePredictionsUserCache(userSub string) {
	if err := platform.Rdb.Del(context.Background(), CacheKeyPredictionsPrefix+userSub).Err(); err != nil {
		log.Printf("[Predictions] Failed to invalidate cache for %s: %v", userSub, err)
	}
}

// queryMarkets fetches all primary markets.
func queryMarkets(ctx context.Context) ([]Prediction, error) {
	rows, err := platform.DBPool.Query(ctx, MarketsQuery)
	if err != nil {
		return nil, fmt.Errorf("predictions query failed: %w", err)
	}
	predictions := scanMarkets(rows, nil)
	if predictions == nil {
		predictions = make([]Prediction, 0)
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
func queryMarketsForUser(ctx context.Context, favorites, categories []string) []Prediction {
	if len(favorites) == 0 && len(categories) == 0 {
		// v1 default: everyone sees everything.
		predictions, err := queryMarkets(ctx)
		if err != nil {
			log.Printf("[Predictions] queryMarketsForUser default query failed: %v", err)
			return nil
		}
		return predictions
	}

	// Old-client path (pre-v1.1.5 configs): category narrowing + favorites
	// union, but on top of the same liveness gates as MarketsQuery — a
	// starred or category-matched market that left the sweep must not keep
	// serving frozen prices to old builds either.
	rows, err := platform.DBPool.Query(ctx, `
		SELECT`+marketsSelectList+`
		FROM markets
		WHERE ((`+marketsLiveWhere+`)
		       AND (cardinality($1::text[]) = 0 OR category = ANY($1) OR ticker = ANY($2)))
		   OR (`+marketsResolvedRecentlyWhere+`)
		ORDER BY volume_24h DESC NULLS LAST, volume DESC, ticker ASC
	`, categories, favorites)
	return scanMarkets(rows, err)
}

// scanMarkets scans a markets result set into a slice of Prediction. It
// accepts the (rows, err) pair from a Query call to keep call sites terse.
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
			&p.Volume, &p.Volume24h, &p.OpenInterest, &p.InSweep,
			&p.Status, &p.Result, &p.SettledAt, &p.CloseTime,
			&p.Link, &p.UpdatedAt,
		); err != nil {
			log.Printf("[Predictions] Row scan failed: %v", err)
			continue
		}
		predictions = append(predictions, p)
	}
	return predictions
}

// getUserPredictionsConfig extracts the favorites and categories lists
// from a user's predictions channel config.
func getUserPredictionsConfig(ctx context.Context, logtoSub string) (favorites, categories []string) {
	var configJSON []byte
	err := platform.DBPool.QueryRow(ctx, `
		SELECT config FROM user_widgets
		WHERE logto_sub = $1 AND widget_type = 'predictions'
	`, logtoSub).Scan(&configJSON)
	if err != nil {
		return nil, nil
	}
	return extractFavoritesFromConfig(configJSON), extractCategoriesFromConfig(configJSON)
}

// predictionsConfig mirrors the user_widgets.config JSONB shape for
// widget_type=predictions: {"categories": [...], "favorites": [...]}.
type predictionsConfig struct {
	Categories []string `json:"categories"`
	Favorites  []string `json:"favorites"`
}

// extractFavoritesFromConfig parses a config JSONB blob and returns favorites.
func extractFavoritesFromConfig(configJSON []byte) []string {
	var config predictionsConfig
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}
	return filterEmptyStrings(config.Favorites)
}

// extractCategoriesFromConfig parses a config JSONB blob and returns categories.
func extractCategoriesFromConfig(configJSON []byte) []string {
	var config predictionsConfig
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}
	return filterEmptyStrings(config.Categories)
}

// filterEmptyStrings returns a copy of the slice with empty strings removed.
func filterEmptyStrings(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
