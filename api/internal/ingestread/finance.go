package ingestread

// The finance widget source, folded in from channels/finance/api per
// ADR-0002 (REL-14). Route shapes, cache keys, and response bodies are
// byte-identical to the proxied originals. The Rust ingester
// (channels/finance/service) is unchanged — it still polls TwelveData
// and writes trades/tracked_symbols; INTERNAL_FINANCE_URL points at it
// for health probes.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

const (
	// CacheKeyFinance is the Redis key for cached trade data (all trades).
	CacheKeyFinance = "cache:finance"

	// CacheKeyFinancePrefix is the Redis key prefix for per-user trade
	// caches. Must stay in sync with widgetUserCacheKeys (redis.go),
	// which invalidates these on CDC dispatch.
	CacheKeyFinancePrefix = "cache:finance:"

	// CacheKeyFinanceCatalog is the Redis key for the cached symbol catalog.
	CacheKeyFinanceCatalog = "cache:finance:catalog"

	// FinanceCacheTTL is how long trade data is cached.
	FinanceCacheTTL = 30 * time.Second

	// FinanceCatalogCacheTTL is how long the symbol catalog is cached.
	FinanceCatalogCacheTTL = 5 * time.Minute

	// tradeColumns is the shared SELECT list for trade queries.
	// COALESCE guards against NULL columns for rows that have been
	// inserted but not yet updated by the Rust ingestion service.
	tradeColumns = `
			t.symbol,
			COALESCE(t.price, 0),
			COALESCE(t.previous_close, 0),
			COALESCE(t.price_change, 0),
			COALESCE(t.percentage_change, 0),
			COALESCE(t.direction, 'flat'),
			COALESCE(t.last_updated, t.created_at),
			COALESCE(ts.link, 'https://www.google.com/search?q=' || t.symbol || '+stock')`
)

// Trade represents a financial trade from the TwelveData ingestion service.
type Trade struct {
	Symbol           string    `json:"symbol"`
	Price            float64   `json:"price"`
	PreviousClose    float64   `json:"previous_close"`
	PriceChange      float64   `json:"price_change"`
	PercentageChange float64   `json:"percentage_change"`
	Direction        string    `json:"direction"`
	LastUpdated      time.Time `json:"last_updated"`
	Link             string    `json:"link"`
}

// TrackedSymbol represents a symbol entry from the catalog.
type TrackedSymbol struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

var financeSource = localSource{
	dashboard:      financeDashboard,
	health:         financeHealth,
	invalidateUser: invalidateFinanceUserCache,
}

// RegisterFinanceRoutes mounts the finance routes natively on core.
// Registered before the dynamic proxy so they take priority over any
// still-registered finance-api during cutover.
func RegisterFinanceRoutes(app *fiber.App) {
	app.Get("/finance", platform.LogtoAuth, handleGetFinance)
	app.Get("/finance/public", handleGetFinance)
	app.Get("/finance/health", handleFinanceHealth)
	app.Get("/finance/symbols", handleGetSymbolCatalog)
}

// handleGetFinance returns the latest trades for every tracked symbol.
func handleGetFinance(c *fiber.Ctx) error {
	ctx := context.Background()
	var trades []Trade
	if cacheGetJSON(ctx, CacheKeyFinance, &trades) {
		c.Set("X-Cache", "HIT")
		return c.JSON(trades)
	}

	trades, err := queryTrades(ctx)
	if err != nil {
		log.Printf("[Finance] getFinance query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	cacheSetJSON(ctx, CacheKeyFinance, trades, FinanceCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(trades)
}

// handleGetSymbolCatalog returns all enabled tracked symbols for the
// dashboard symbol browser.
func handleGetSymbolCatalog(c *fiber.Ctx) error {
	ctx := context.Background()
	var catalog []TrackedSymbol
	if cacheGetJSON(ctx, CacheKeyFinanceCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	rows, err := platform.DBPool.Query(ctx,
		"SELECT symbol, COALESCE(name, symbol), COALESCE(category, 'Other') FROM tracked_symbols WHERE is_enabled = true ORDER BY category, symbol")
	if err != nil {
		log.Printf("[Finance] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
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

	cacheSetJSON(ctx, CacheKeyFinanceCatalog, catalog, FinanceCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// handleFinanceHealth proxies the Rust finance service's full health
// payload for operators.
func handleFinanceHealth(c *fiber.Ctx) error {
	return proxyIngestionHealth(c, os.Getenv("INTERNAL_FINANCE_URL"))
}

// financeHealth reports the finance ingestion status for /health. DB and
// Redis reachability are already covered by core's own top-level checks,
// so only the Rust service's readiness matters here. An unset
// INTERNAL_FINANCE_URL skips the probe (matches the retired finance-api
// behavior).
func financeHealth(ctx context.Context) (string, bool) {
	internalURL := os.Getenv("INTERNAL_FINANCE_URL")
	if internalURL == "" {
		return "healthy", true
	}
	code, err := probeIngestion(ctx, internalURL)
	if err != nil || code != http.StatusOK {
		return "down", false
	}
	return "healthy", true
}

// financeDashboard returns the "finance" dashboard section for a user:
// the latest trades for the symbols across their finance widgets.
func financeDashboard(ctx context.Context, userSub string) map[string]interface{} {
	cacheKey := CacheKeyFinancePrefix + userSub
	var trades []Trade
	if cacheGetJSON(ctx, cacheKey, &trades) {
		return map[string]interface{}{"finance": trades}
	}

	symbols := getUserFinanceSymbols(ctx, userSub)
	if len(symbols) == 0 {
		return map[string]interface{}{"finance": []Trade{}}
	}

	trades = queryTradesBySymbols(ctx, symbols)
	if trades == nil {
		trades = make([]Trade, 0)
	}

	cacheSetJSON(ctx, cacheKey, trades, FinanceCacheTTL)
	return map[string]interface{}{"finance": trades}
}

// invalidateFinanceUserCache drops the per-user trades cache after a
// finance widget config change.
func invalidateFinanceUserCache(userSub string) {
	if err := platform.Rdb.Del(context.Background(), CacheKeyFinancePrefix+userSub).Err(); err != nil {
		log.Printf("[Finance] Failed to invalidate cache for %s: %v", userSub, err)
	}
}

// queryTrades fetches all trades.
func queryTrades(ctx context.Context) ([]Trade, error) {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT `+tradeColumns+`
		FROM trades t
		LEFT JOIN tracked_symbols ts ON t.symbol = ts.symbol
		ORDER BY t.symbol ASC`)
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
func queryTradesBySymbols(ctx context.Context, symbols []string) []Trade {
	if len(symbols) == 0 {
		return nil
	}

	rows, err := platform.DBPool.Query(ctx, `
		SELECT `+tradeColumns+`
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

// getUserFinanceSymbols unions the symbol lists across a user's finance
// widget channels (finance_stocks, finance_crypto, …; plus any legacy
// coarse 'finance' row).
func getUserFinanceSymbols(ctx context.Context, logtoSub string) []string {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT config FROM user_widgets
		WHERE logto_sub = $1
		  AND (widget_type = 'finance' OR widget_type LIKE 'finance\_%')
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
		var config map[string]interface{}
		if err := json.Unmarshal(configJSON, &config); err != nil {
			continue
		}
		for _, s := range platform.ExtractStringArray(config, "symbols") {
			if !seen[s] {
				seen[s] = true
				symbols = append(symbols, s)
			}
		}
	}
	return symbols
}
