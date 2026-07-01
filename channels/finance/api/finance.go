package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// CacheKeyFinance is the Redis key for cached trade data (all trades).
	CacheKeyFinance = "cache:finance"

	// CacheKeyFinancePrefix is the Redis key prefix for per-user trade caches.
	CacheKeyFinancePrefix = "cache:finance:"

	// CacheKeyFinanceCatalog is the Redis key for the cached symbol catalog.
	CacheKeyFinanceCatalog = "cache:finance:catalog"

	// FinanceCacheTTL is how long trade data is cached.
	FinanceCacheTTL = 30 * time.Second

	// FinanceCatalogCacheTTL is how long the symbol catalog is cached.
	FinanceCatalogCacheTTL = 5 * time.Minute

	// RedisFinanceSubscribersPrefix is the Redis key prefix for per-symbol
	// subscriber sets (e.g. "finance:subscribers:AAPL").
	RedisFinanceSubscribersPrefix = "finance:subscribers:"

	// TradesQuery is the SQL used to fetch all trades.
	// COALESCE guards against NULL columns for rows that have been inserted
	// but not yet updated by the Rust ingestion service.
	// JOINs with tracked_symbols to include the link field.
	TradesQuery = `
		SELECT 
			t.symbol, 
			COALESCE(t.price, 0), 
			COALESCE(t.previous_close, 0), 
			COALESCE(t.price_change, 0), 
			COALESCE(t.percentage_change, 0), 
			COALESCE(t.direction, 'flat'), 
			COALESCE(t.last_updated, t.created_at),
			COALESCE(ts.link, 'https://www.google.com/search?q=' || t.symbol || '+stock')
		FROM trades t
		LEFT JOIN tracked_symbols ts ON t.symbol = ts.symbol
		ORDER BY t.symbol ASC`
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

// getFinance retrieves the latest financial trades.
// The core gateway adds X-User-Sub header for authenticated requests.
func (a *App) getFinance(c *fiber.Ctx) error {
	var trades []Trade
	if GetCache(a.rdb, CacheKeyFinance, &trades) {
		c.Set("X-Cache", "HIT")
		return c.JSON(trades)
	}

	trades, err := a.queryTrades(context.Background())
	if err != nil {
		log.Printf("[Finance] getFinance query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	SetCache(a.rdb, CacheKeyFinance, trades, FinanceCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(trades)
}

// getSymbolCatalog returns all enabled tracked symbols for the dashboard
// symbol browser.
func (a *App) getSymbolCatalog(c *fiber.Ctx) error {
	var catalog []TrackedSymbol
	if GetCache(a.rdb, CacheKeyFinanceCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	rows, err := a.db.Query(context.Background(),
		"SELECT symbol, COALESCE(name, symbol), COALESCE(category, 'Other') FROM tracked_symbols WHERE is_enabled = true ORDER BY category, symbol")
	if err != nil {
		log.Printf("[Finance] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch symbol catalog",
		})
	}
	defer rows.Close()

	catalog = make([]TrackedSymbol, 0)
	for rows.Next() {
		var s TrackedSymbol
		if err := rows.Scan(&s.Symbol, &s.Name, &s.Category); err != nil {
			log.Printf("[Finance] Catalog scan error: %v", err)
			continue
		}
		catalog = append(catalog, s)
	}

	SetCache(a.rdb, CacheKeyFinanceCatalog, catalog, FinanceCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// healthHandler proxies a health check to the internal Rust finance service.
func (a *App) healthHandler(c *fiber.Ctx) error {
	return ProxyInternalHealth(c, os.Getenv("INTERNAL_FINANCE_URL"))
}

// =============================================================================
// Internal Routes (called by core gateway)
// =============================================================================

// handleInternalCDC receives CDC records from the core gateway and returns the
// list of users who should receive these records.
//
// Finance uses per-symbol routing: for each CDC record, we extract the symbol
// field and look up which users are subscribed to that specific symbol via the
// Redis set finance:subscribers:{symbol}. The returned user list is the union
// of all subscribers across all symbols in the batch.
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
	userSet := make(map[string]bool)

	for _, rec := range req.Records {
		symbol, ok := rec.Record["symbol"].(string)
		if !ok || symbol == "" {
			continue
		}
		subs, err := GetSubscribers(a.rdb, ctx, RedisFinanceSubscribersPrefix+symbol)
		if err != nil {
			log.Printf("[Finance CDC] Failed to get subscribers for %s: %v", symbol, err)
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

// handleInternalDashboard returns finance data for a user's dashboard.
// Query param: user={logto_sub}
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{"finance": []Trade{}})
	}

	// Check per-user cache first
	cacheKey := CacheKeyFinancePrefix + userSub
	var trades []Trade
	if GetCache(a.rdb, cacheKey, &trades) {
		return c.JSON(fiber.Map{"finance": trades})
	}

	// Get user's selected symbols from their channel config
	symbols := a.getUserFinanceSymbols(userSub)
	if len(symbols) == 0 {
		return c.JSON(fiber.Map{"finance": []Trade{}})
	}

	trades = a.queryTradesBySymbols(symbols)
	if trades == nil {
		trades = make([]Trade, 0)
	}

	SetCache(a.rdb, cacheKey, trades, FinanceCacheTTL)
	return c.JSON(fiber.Map{"finance": trades})
}

// handleInternalHealth is the endpoint the core gateway and k8s probes hit.
//
// It verifies that this API's own dependencies (Postgres, Redis) are reachable
// and that the downstream Rust ingestion service's /health/ready returns 200.
// Any failure returns HTTP 503 so the k8s readinessProbe can mark the pod
// NotReady and stop routing traffic. The previous version returned a static
// `{"status":"healthy"}` no matter what, which helped mask the ingestion
// outage on 2026-04-19.
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

	if internalURL := os.Getenv("INTERNAL_FINANCE_URL"); internalURL != "" {
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
		log.Printf("[Finance Lifecycle] Channel created for user %s", req.User)

	case "updated":
		a.onChannelUpdated(ctx, req.User, req.OldConfig, req.Config)

	case "deleted":
		a.onChannelDeleted(ctx, req.User, req.Config)

	case "sync":
		a.onSyncSubscriptions(ctx, req.User, req.Config, req.Enabled)

	default:
		log.Printf("[Finance Lifecycle] Unknown event: %s", req.Event)
	}

	return c.JSON(fiber.Map{"ok": true})
}

// onChannelUpdated handles symbol list changes when a channel is updated.
// 1. Diffs old vs new symbols, removes user from stale subscriber sets
// 2. Invalidates per-user cache
func (a *App) onChannelUpdated(ctx context.Context, userSub string, oldConfig, newConfig map[string]interface{}) {
	if newConfig == nil {
		return
	}

	oldSymbols := extractSymbolsFromChannelConfig(oldConfig)
	newSymbols := extractSymbolsFromChannelConfig(newConfig)
	newSet := make(map[string]bool, len(newSymbols))
	for _, s := range newSymbols {
		newSet[s] = true
	}
	for _, s := range oldSymbols {
		if !newSet[s] {
			RemoveSubscriber(a.rdb, ctx, RedisFinanceSubscribersPrefix+s, userSub)
		}
	}

	// Invalidate per-user cache
	a.rdb.Del(ctx, CacheKeyFinancePrefix+userSub)
}

// onChannelDeleted removes the user from all symbol subscriber sets and
// invalidates per-user cache when a channel is removed.
func (a *App) onChannelDeleted(ctx context.Context, userSub string, config map[string]interface{}) {
	symbols := extractSymbolsFromChannelConfig(config)
	for _, s := range symbols {
		RemoveSubscriber(a.rdb, ctx, RedisFinanceSubscribersPrefix+s, userSub)
	}
	a.rdb.Del(ctx, CacheKeyFinancePrefix+userSub)
}

// onSyncSubscriptions adds or removes the user from per-symbol subscriber
// sets based on the enabled flag. Called on dashboard load to warm sets.
func (a *App) onSyncSubscriptions(ctx context.Context, userSub string, config map[string]interface{}, enabled bool) {
	symbols := extractSymbolsFromChannelConfig(config)
	for _, s := range symbols {
		if enabled {
			AddSubscriber(a.rdb, ctx, RedisFinanceSubscribersPrefix+s, userSub)
		} else {
			RemoveSubscriber(a.rdb, ctx, RedisFinanceSubscribersPrefix+s, userSub)
		}
	}
}

// =============================================================================
// Database Helpers
// =============================================================================

// queryTrades fetches all trades from PostgreSQL.
func (a *App) queryTrades(ctx context.Context) ([]Trade, error) {
	rows, err := a.db.Query(ctx, TradesQuery)
	if err != nil {
		return nil, fmt.Errorf("finance query failed: %w", err)
	}
	defer rows.Close()

	trades := make([]Trade, 0)
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.Symbol, &t.Price, &t.PreviousClose, &t.PriceChange, &t.PercentageChange, &t.Direction, &t.LastUpdated, &t.Link); err != nil {
			log.Printf("[Finance] Row scan failed: %v", err)
			continue
		}
		trades = append(trades, t)
	}

	return trades, nil
}

// queryTradesBySymbols fetches trades for a specific set of symbols.
func (a *App) queryTradesBySymbols(symbols []string) []Trade {
	if len(symbols) == 0 {
		return nil
	}

	rows, err := a.db.Query(context.Background(), `
		SELECT 
			t.symbol, 
			COALESCE(t.price, 0), 
			COALESCE(t.previous_close, 0), 
			COALESCE(t.price_change, 0),
			COALESCE(t.percentage_change, 0), 
			COALESCE(t.direction, 'flat'), 
			COALESCE(t.last_updated, t.created_at),
			COALESCE(ts.link, 'https://www.google.com/search?q=' || t.symbol || '+stock')
		FROM trades t
		LEFT JOIN tracked_symbols ts ON t.symbol = ts.symbol
		WHERE t.symbol = ANY($1)
		ORDER BY t.symbol ASC
	`, symbols)
	if err != nil {
		log.Printf("[Finance] Trades by symbols query failed: %v", err)
		return nil
	}
	defer rows.Close()

	trades := make([]Trade, 0)
	for rows.Next() {
		var t Trade
		if err := rows.Scan(&t.Symbol, &t.Price, &t.PreviousClose, &t.PriceChange, &t.PercentageChange, &t.Direction, &t.LastUpdated, &t.Link); err != nil {
			log.Printf("[Finance] Row scan failed: %v", err)
			continue
		}
		trades = append(trades, t)
	}
	return trades
}

// getUserFinanceSymbols unions the symbol lists across a user's finance widget
// channels (finance_stocks, finance_crypto, …; plus any legacy coarse 'finance'
// row). The per-asset-class split lives in the widget's config; here we gather
// every symbol the user follows so the ingest/query layer serves them all.
func (a *App) getUserFinanceSymbols(logtoSub string) []string {
	rows, err := a.db.Query(context.Background(), `
		SELECT config FROM user_channels
		WHERE logto_sub = $1
		  AND (channel_type = 'finance' OR channel_type LIKE 'finance\_%')
	`, logtoSub)
	if err != nil {
		return nil
	}
	defer rows.Close()
	seen := make(map[string]bool)
	var symbols []string
	for rows.Next() {
		var configJSON []byte
		if err := rows.Scan(&configJSON); err != nil {
			continue
		}
		for _, s := range extractSymbolsFromConfig(configJSON) {
			if !seen[s] {
				seen[s] = true
				symbols = append(symbols, s)
			}
		}
	}
	return symbols
}

// =============================================================================
// Config Parsing Helpers
// =============================================================================

// extractSymbolsFromChannelConfig extracts symbols from a channel's config map.
func extractSymbolsFromChannelConfig(config map[string]interface{}) []string {
	if config == nil {
		return nil
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return nil
	}
	return extractSymbolsFromConfig(configJSON)
}

// extractSymbolsFromConfig parses a config JSONB blob and returns symbol strings.
func extractSymbolsFromConfig(configJSON []byte) []string {
	var config struct {
		Symbols []string `json:"symbols"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}

	symbols := make([]string, 0, len(config.Symbols))
	for _, s := range config.Symbols {
		if s != "" {
			symbols = append(symbols, s)
		}
	}
	return symbols
}
