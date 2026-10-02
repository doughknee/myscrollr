package ingestread

import (
	"context"
	"encoding/json"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

// publicFeedGroup coalesces concurrent cache misses for the public feed
// into a single build.
var publicFeedGroup singleflight.Group

const (
	// PublicFeedCacheKey is the Redis key for the cached public feed.
	PublicFeedCacheKey = "cache:public:feed"

	// PublicFeedCacheTTL is how long the public feed is cached.
	PublicFeedCacheTTL = 30 * time.Second

	// PublicFeedMaxWidgets caps ?widgets= (SCROLLR-315). The website's bar
	// shows a handful; the cap bounds the cache keys one caller can mint.
	PublicFeedMaxWidgets = 12
)

// publicFeedFill mirrors POPULAR_SYMBOLS in
// desktop/src/datawidgets/finance/view.ts: what fills a short watchlist's
// page (SCROLLR-292). A ?widgets= feed carries them so the website's bar
// still fills a page from a five-symbol starter list.
var publicFeedFill = map[string][]string{
	"stock":  {"AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "GOOGL", "META", "SPY", "QQQ", "AVGO", "NFLX", "AMD", "JPM", "V", "COST", "WMT", "DIS", "KO", "MA", "XOM"},
	"crypto": {"BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "DOGE/USD", "ADA/USD", "BNB/USD", "AVAX/USD", "LINK/USD", "DOT/USD", "LTC/USD", "SHIB/USD", "TRX/USD", "BCH/USD", "XLM/USD", "SUI/USD", "NEAR/USD", "UNI/USD", "ATOM/USD", "HBAR/USD"},
}

// publicFeedWidgets normalizes ?widgets=: catalog data widgets only
// (unknown ids and utilities dropped), sorted, deduped, at most
// PublicFeedMaxWidgets. Empty means the full feed.
func publicFeedWidgets(raw string) []string {
	var ids []string
	for _, id := range strings.Split(raw, ",") {
		id = strings.TrimSpace(id)
		if def, ok := platform.WidgetByID(id); ok && def.Source != "" {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	if len(ids) > PublicFeedMaxWidgets {
		ids = ids[:PublicFeedMaxWidgets]
	}
	return ids
}

// publicFeedFilter is what a ?widgets= list needs from each source, read
// from the widgets' default configs: finance their symbols plus their asset
// class's fill, sports their leagues, rss their feeds.
type publicFeedFilter struct{ symbols, leagues, feeds map[string]bool }

func newPublicFeedFilter(ids []string) publicFeedFilter {
	f := publicFeedFilter{map[string]bool{}, map[string]bool{}, map[string]bool{}}
	add := func(set map[string]bool, xs []string) {
		for _, x := range xs {
			set[x] = true
		}
	}
	for _, id := range ids {
		cfg := platform.DefaultConfigFor(id)
		add(f.symbols, platform.ExtractStringArray(cfg, "symbols"))
		if class, _ := cfg["asset_class"].(string); class != "" {
			add(f.symbols, publicFeedFill[class])
		}
		add(f.leagues, platform.ExtractStringArray(cfg, "leagues"))
		add(f.feeds, platform.ExtractFeedURLsFromConfig(cfg))
	}
	return f
}

func keepIf[T any](xs []T, ok func(T) bool) []T {
	out := make([]T, 0, len(xs))
	for _, x := range xs {
		if ok(x) {
			out = append(out, x)
		}
	}
	return out
}

func (f publicFeedFilter) finance(trades []Trade) []Trade {
	return keepIf(trades, func(t Trade) bool { return f.symbols[t.Symbol] })
}

func (f publicFeedFilter) sports(s SportsResponse) SportsResponse {
	return SportsResponse{
		Sports: keepIf(s.Sports, func(g Game) bool { return f.leagues[g.League] }),
		Meta:   SportsMeta{Leagues: keepIf(s.Meta.Leagues, func(l LeagueMeta) bool { return f.leagues[l.Name] })},
	}
}

func (f publicFeedFilter) feedURLs() []string {
	urls := make([]string, 0, len(f.feeds))
	for u := range f.feeds {
		urls = append(urls, u)
	}
	return urls
}

// PublicFeedResponse is the response shape for GET /public/feed.
// It mirrors the DashboardResponse data map but without preferences/channels:
// "finance" and "rss" are the dashboard's shapes, "sports" is the
// /sports/public {sports, meta} object.
type PublicFeedResponse struct {
	Data map[string]interface{} `json:"data"`
}

// HandlePublicFeed returns an aggregated feed of finance, sports and rss
// (the curated news feeds, SCROLLR-313) for the website's bar and the
// signed-out desktop.
//
// ?widgets=sports_nfl,news_npr,finance_stocks (catalog ids, SCROLLR-315)
// narrows it to what those widgets show: their leagues, their feeds, their
// symbols plus the page fill. Absent, empty or all unknown: the full feed.
//
// No authentication required. Results are cached in Redis for 30s.
//
// This used to resolve both sources through platform.GetChannel and fetch
// them over HTTP. ADR-0002 folded finance and sports into core as local
// sources, so they stopped registering as discovered channels — GetChannel
// returned nil for both, the target list came out empty, and the endpoint
// served `{"data":{}}` with HTTP 200 for six weeks without anything
// noticing. It now reads the same in-process payload builders the
// /finance/public and /sports/public routes use.
func HandlePublicFeed(c *fiber.Ctx) error {
	ctx := context.Background()

	ids := publicFeedWidgets(strings.Clone(c.Query("widgets")))
	cacheKey := PublicFeedCacheKey
	if len(ids) > 0 {
		cacheKey += ":" + strings.Join(ids, ",")
	}
	filter := newPublicFeedFilter(ids)
	rssURLs := curatedFeedURLs()
	if len(ids) > 0 {
		rssURLs = filter.feedURLs()
	}

	// Check Redis cache first
	if val, err := platform.Rdb.Get(ctx, cacheKey).Result(); err == nil {
		c.Set("Content-Type", "application/json")
		c.Set("X-Cache", "HIT")
		return c.SendString(val)
	}

	// Singleflight: only one goroutine builds; others share the result
	result, err, _ := publicFeedGroup.Do(cacheKey, func() (interface{}, error) {
		// Double-check cache
		if val, err := platform.Rdb.Get(ctx, cacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := PublicFeedResponse{Data: make(map[string]interface{})}

		var (
			wg      sync.WaitGroup
			trades  []Trade
			sports  SportsResponse
			rss     []RssItem
			okTrade bool
			okSport bool
			okRSS   bool
		)
		wg.Add(3)
		go func() {
			defer wg.Done()
			t, _, err := PublicFinance(ctx)
			if err != nil {
				log.Printf("[PublicFeed] finance: %v", err)
				return
			}
			trades, okTrade = t, true
		}()
		go func() {
			defer wg.Done()
			s, _, err := PublicSports(ctx)
			if err != nil {
				log.Printf("[PublicFeed] sports: %v", err)
				return
			}
			sports, okSport = s, true
		}()
		go func() {
			defer wg.Done()
			r, err := PublicRSS(ctx, rssURLs)
			if err != nil {
				log.Printf("[PublicFeed] rss: %v", err)
				return
			}
			rss, okRSS = r, true
		}()
		wg.Wait()
		if len(ids) > 0 {
			trades, sports = filter.finance(trades), filter.sports(sports)
		}

		// A source that errored is omitted rather than emitted empty, so a
		// caller can tell "no data" apart from "this half is broken" — and
		// so a partial outage does not get cached as an empty success.
		if okTrade {
			res.Data["finance"] = trades
		}
		if okSport {
			res.Data["sports"] = sports
		}
		if okRSS {
			res.Data["rss"] = rss
		}

		cacheData, err := json.Marshal(res)
		if err != nil {
			return nil, err
		}
		// Only cache a complete feed. Caching a half-built one would pin the
		// degraded shape for the full TTL.
		if okTrade && okSport && okRSS {
			platform.Rdb.Set(ctx, cacheKey, cacheData, PublicFeedCacheTTL)
		}
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "public feed fetch failed"})
	}

	c.Set("Content-Type", "application/json")
	c.Set("X-Cache", "MISS")
	return c.Send(result.([]byte))
}
