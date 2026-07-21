package ingestread

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

// publicFeedGroup coalesces concurrent cache misses for the public feed
// into a single upstream fetch.
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
func HandlePublicFeed(c *fiber.Ctx) error {
	// Check Redis cache first
	val, err := platform.Rdb.Get(context.Background(), PublicFeedCacheKey).Result()
	if err == nil {
		c.Set("Content-Type", "application/json")
		c.Set("X-Cache", "HIT")
		return c.SendString(val)
	}

	// Singleflight: only one goroutine fetches; others share the result
	result, err, _ := publicFeedGroup.Do("public-feed", func() (interface{}, error) {
		// Double-check cache
		if val, err := platform.Rdb.Get(context.Background(), PublicFeedCacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := PublicFeedResponse{
			Data: make(map[string]interface{}),
		}

		httpClient := &http.Client{Timeout: platform.HealthCheckTimeout}

		type publicResult struct {
			data map[string]interface{}
		}
		type publicTarget struct {
			intg *platform.ChannelInfo
			path string
		}

		var targets []publicTarget
		if intg := platform.GetChannel("finance"); intg != nil {
			targets = append(targets, publicTarget{intg, "/finance/public"})
		}
		if intg := platform.GetChannel("sports"); intg != nil {
			targets = append(targets, publicTarget{intg, "/sports/public"})
		}

		results := make([]publicResult, len(targets))
		var wg sync.WaitGroup
		wg.Add(len(targets))
		for i, t := range targets {
			go func(idx int, tgt publicTarget) {
				defer wg.Done()
				results[idx] = publicResult{data: fetchChannelPublic(httpClient, tgt.intg, tgt.path)}
			}(i, t)
		}
		wg.Wait()

		for _, r := range results {
			for k, v := range r.data {
				res.Data[k] = v
			}
		}

		cacheData, _ := json.Marshal(res)
		platform.Rdb.Set(context.Background(), PublicFeedCacheKey, cacheData, PublicFeedCacheTTL)
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "public feed fetch failed"})
	}

	c.Set("Content-Type", "application/json")
	c.Set("X-Cache", "MISS")
	return c.Send(result.([]byte))
}

// fetchChannelPublic calls a channel's public endpoint and returns
// the parsed response data. The response is expected to be an array (e.g.
// trades or games) which gets wrapped under the channel name key.
func fetchChannelPublic(client *http.Client, intg *platform.ChannelInfo, path string) map[string]interface{} {
	url := intg.InternalURL + path
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("[PublicFeed] %s fetch error: %v", intg.Name, err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("[PublicFeed] %s returned status %d", intg.Name, resp.StatusCode)
		return nil
	}

	// Channel public endpoints return raw arrays (e.g. []Trade or []Game).
	// Wrap them under the channel name to match the DashboardResponse.Data shape.
	var items interface{}
	if err := json.Unmarshal(body, &items); err != nil {
		log.Printf("[PublicFeed] %s unmarshal error: %v", intg.Name, err)
		return nil
	}

	return map[string]interface{}{
		intg.Name: items,
	}
}
