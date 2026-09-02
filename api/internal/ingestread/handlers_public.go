package ingestread

import (
	"context"
	"encoding/json"
	"log"
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
)

// PublicFeedResponse is the response shape for GET /public/feed.
// It mirrors the DashboardResponse data map but without preferences/channels.
type PublicFeedResponse struct {
	Data map[string]interface{} `json:"data"`
}

// HandlePublicFeed returns an aggregated feed of finance + sports data.
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

	// Check Redis cache first
	if val, err := platform.Rdb.Get(ctx, PublicFeedCacheKey).Result(); err == nil {
		c.Set("Content-Type", "application/json")
		c.Set("X-Cache", "HIT")
		return c.SendString(val)
	}

	// Singleflight: only one goroutine builds; others share the result
	result, err, _ := publicFeedGroup.Do("public-feed", func() (interface{}, error) {
		// Double-check cache
		if val, err := platform.Rdb.Get(ctx, PublicFeedCacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := PublicFeedResponse{Data: make(map[string]interface{})}

		var (
			wg      sync.WaitGroup
			trades  []Trade
			sports  SportsResponse
			okTrade bool
			okSport bool
		)
		wg.Add(2)
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
		wg.Wait()

		// A source that errored is omitted rather than emitted empty, so a
		// caller can tell "no data" apart from "this half is broken" — and
		// so a partial outage does not get cached as an empty success.
		if okTrade {
			res.Data["finance"] = trades
		}
		if okSport {
			res.Data["sports"] = sports
		}

		cacheData, err := json.Marshal(res)
		if err != nil {
			return nil, err
		}
		// Only cache a complete feed. Caching a half-built one would pin the
		// degraded shape for the full TTL.
		if okTrade && okSport {
			platform.Rdb.Set(ctx, PublicFeedCacheKey, cacheData, PublicFeedCacheTTL)
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
