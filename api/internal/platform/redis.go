package platform

import (
	"context"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

// Rdb is the global Redis client. Exported so channel packages can access it
// for direct operations (e.g. cache invalidation).
var Rdb *redis.Client

// ConnectRedis initialises the Redis client from the REDIS_URL env var.
func ConnectRedis() {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatal("REDIS_URL must be set")
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Unable to parse REDIS_URL: %v", err)
	}

	Rdb = redis.NewClient(opts)

	if err := Rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("Unable to connect to Redis: %v", err)
	}

	log.Println("Successfully connected to Redis")
}

// PublishRaw publishes pre-serialised bytes to a Redis channel.
func PublishRaw(channel string, data []byte) error {
	return Rdb.Publish(context.Background(), channel, data).Err()
}

// PublishBatch publishes the same payload to multiple Redis channels in a single
// pipeline round-trip. Returns the number of errors encountered.
func PublishBatch(channels []string, data []byte) int {
	if len(channels) == 0 {
		return 0
	}

	ctx := context.Background()
	pipe := Rdb.Pipeline()
	for _, ch := range channels {
		pipe.Publish(ctx, ch, data)
	}

	cmds, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		log.Printf("[Redis] Pipeline publish error: %v", err)
	}

	errCount := 0
	for _, cmd := range cmds {
		if cmd.Err() != nil {
			errCount++
		}
	}
	return errCount
}

// PSubscribe listens to Redis channels matching one or more patterns.
func PSubscribe(ctx context.Context, patterns ...string) *redis.PubSub {
	return Rdb.PSubscribe(ctx, patterns...)
}

// InvalidateDashboardCache removes the cached dashboard response for a user.
// Called after widget CRUD or preference updates to ensure the next poll gets fresh data.
func InvalidateDashboardCache(userSub string) {
	if err := Rdb.Del(context.Background(), RedisDashboardCachePrefix+userSub).Err(); err != nil {
		log.Printf("[Cache] Failed to invalidate dashboard cache for %s: %v", userSub, err)
	}
}

// widgetUserCacheKeys returns all per-user cache keys each widget data source owns,
// for a given user. Used by `InvalidateUserCaches` on CDC dispatch.
//
// The keys follow the convention `cache:<channel>:<userSub>` chosen by
// each channel API (channels/*/api/*.go constants). Core knows about them
// only by convention, not by importing — this respects the AGENTS.md
// channel-isolation rule (no shared Go types) while still letting core
// keep downstream caches in sync when CDC fires.
func widgetUserCacheKeys(userSub string) []string {
	return []string{
		"cache:finance:" + userSub,
		"cache:sports:" + userSub,
		// Sports alone has two per-user payloads on two keys: the full
		// widget-page games list and the fair-shared dashboard preview.
		"cache:sports:dash:" + userSub,
		"cache:rss:" + userSub,
		"cache:predictions:" + userSub,
	}
}

// InvalidateUserCaches deletes all per-user cache entries that could
// contain stale data after a CDC event: core's /dashboard cache plus
// each channel's /internal/dashboard cache.
//
// Called from `Hub.dispatchToUser` on every CDC dispatch so a desktop
// safety-net refetch (triggered ~500ms after the SSE burst) cannot
// overwrite the optimistic in-memory merge with pre-event prices. See
// the comment on `dispatchToUser` for the full regression scenario.
//
// Uses a single Redis pipeline to do one round-trip (not N). At the
// observed peak of ~47 events/sec with <100 users, cost is under 5k
// ops/sec on Redis — negligible.
func InvalidateUserCaches(userSub string) {
	ctx := context.Background()
	keys := append([]string{RedisDashboardCachePrefix + userSub}, widgetUserCacheKeys(userSub)...)
	if err := Rdb.Del(ctx, keys...).Err(); err != nil {
		log.Printf("[Cache] Failed to invalidate user caches for %s: %v", userSub, err)
	}
}

// RedisOverviewCachePrefix is the per-user key prefix for the overview
// cache. Format: overview:{logto_sub}.
const RedisOverviewCachePrefix = "overview:"

// InvalidateOverviewCache deletes the per-user overview cache key.
// Called from the Stripe webhook (subscription state changes), the
// widget CRUD handlers (toggle state changes), and the GDPR request
// lifecycle (deletion status changes) so the next request always sees
// fresh data instead of waiting up to OverviewCacheTTL for the cache
// to expire.
//
// Failures are logged and swallowed — the caller's primary write has
// already succeeded; an invalidation miss only delays the visible
// effect by OverviewCacheTTL, which is acceptable.
func InvalidateOverviewCache(ctx context.Context, userID string) {
	if userID == "" || Rdb == nil {
		return
	}
	key := RedisOverviewCachePrefix + userID
	if err := Rdb.Del(ctx, key).Err(); err != nil {
		log.Printf("[Overview] cache invalidate failed for %s: %v", userID, err)
	}
}
