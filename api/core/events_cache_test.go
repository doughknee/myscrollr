package core

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// setupMiniRedis replaces the global `Rdb` with an in-memory miniredis instance
// for the duration of a test. Returns a cleanup function to call with defer.
func setupMiniRedis(t *testing.T) (*miniredis.Miniredis, func()) {
	t.Helper()

	mr := miniredis.RunT(t)
	previousRdb := Rdb
	Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	return mr, func() {
		_ = Rdb.Close()
		Rdb = previousRdb
	}
}

// userCacheKeysFor is the contract the production helper implements: for a
// given user, which cache keys must be invalidated on CDC dispatch so no
// stale reply escapes. Kept as a test-local slice so future additions must
// update BOTH this slice AND the production `InvalidateUserCaches` /
// `widgetUserCacheKeys`. Mismatch → test fails → we notice the drift.
func userCacheKeysFor(userSub string) []string {
	return []string{
		RedisDashboardCachePrefix + userSub,
		"cache:finance:" + userSub,
		"cache:sports:" + userSub,
		"cache:rss:" + userSub,
	}
}

// TestInvalidateDashboardCache is the baseline happy-path — the helper should
// delete the expected key so future fetches re-populate the cache with fresh
// data.
func TestInvalidateDashboardCache(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()

	const userSub = "user_abc_123"
	cacheKey := RedisDashboardCachePrefix + userSub

	payload, _ := json.Marshal(map[string]string{"data": "stale"})
	mr.Set(cacheKey, string(payload))
	if !mr.Exists(cacheKey) {
		t.Fatalf("precondition: cache key %q should exist after manual Set", cacheKey)
	}

	InvalidateDashboardCache(userSub)

	if mr.Exists(cacheKey) {
		t.Errorf("InvalidateDashboardCache(%q) left key %q in redis; expected deletion", userSub, cacheKey)
	}
}

// TestInvalidateUserCaches verifies the combined helper deletes every
// per-user cache key a CDC event could have staled — not just the
// top-level dashboard, but the per-channel caches that get merged into
// a dashboard rebuild.
func TestInvalidateUserCaches(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()

	const userSub = "user_multi_layer"
	keys := userCacheKeysFor(userSub)

	for _, k := range keys {
		mr.Set(k, `{"stale":true}`)
	}
	for _, k := range keys {
		if !mr.Exists(k) {
			t.Fatalf("precondition: key %q should exist after seed", k)
		}
	}

	InvalidateUserCaches(userSub)

	for _, k := range keys {
		if mr.Exists(k) {
			t.Errorf("InvalidateUserCaches left key %q in Redis; stale data could still serve", k)
		}
	}
}

// TestDispatchToUserInvalidatesAllCaches is the regression test for the
// 2026-04-24 "finance symbols jitter" bug.
//
// Scenario the bug produced:
//
//  1. GET /dashboard caches the aggregated response in Redis for 30s
//     (DashboardCacheTTL). That response is BUILT by fan-out to each
//     channel's /internal/dashboard — and THOSE are ALSO cached per-user
//     for 30s (cache:finance:<user>, cache:sports:<user>, cache:rss:<user>).
//  2. Prices for AAPL update in Postgres.
//  3. Sequin publishes a CDC event to Redis topic cdc:finance:AAPL.
//  4. Hub's listenToTopics fans out to subscribed users via dispatchToUser.
//  5. Desktop receives the SSE event and merges it into its TanStack
//     Query cache (optimistic UI update — UI shows new price).
//  6. Desktop's safety-net `invalidateQueries` fires ~500ms later, so
//     GET /dashboard runs on the server. Cache miss rebuilds by calling
//     each channel. The finance channel serves its OWN still-warm
//     30s cache with pre-event prices. Rebuilt response is persisted
//     — now looks fresh but is actually stale.
//  7. Stale response overwrites the optimistic merge → UI visibly
//     regresses. Next CDC event pushes forward again → endless jitter
//     for up to 30s per cache layer.
//
// Fix: dispatchToUser invalidates EVERY per-user cache layer (dashboard
// + all three channel caches) immediately before sending the SSE
// payload. Any refetch lands on cold caches → fresh data from Postgres
// → optimistic merge and refetch agree.
func TestDispatchToUserInvalidatesAllCaches(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()

	// Hub must exist to call dispatchToUser. listenToTopics / workers are
	// not needed for the test — we're testing the dispatch function in
	// isolation.
	prevHub := globalHub
	globalHub = &Hub{
		registry:   &topicRegistry{},
		dispatchCh: make(chan dispatchJob, 1),
	}
	defer func() { globalHub = prevHub }()

	const userSub = "user_jitter_test"
	keys := userCacheKeysFor(userSub)

	// Seed a "stale" cached dashboard AND stale per-channel caches.
	stale, _ := json.Marshal(map[string]interface{}{
		"data": map[string]interface{}{
			"finance": []map[string]interface{}{
				{"symbol": "AAPL", "price": 150.20},
			},
		},
	})
	for _, k := range keys {
		mr.Set(k, string(stale))
	}

	// Simulate a CDC event being dispatched to this user. We don't
	// register a real client — the user may be offline when the CDC
	// fires, but the cache invalidation must still happen so their
	// NEXT fetch gets fresh data.
	payload := []byte(`{"data":[{"action":"update","record":{"symbol":"AAPL","price":150.60},"metadata":{"table_name":"trades"}}]}`)
	globalHub.dispatchToUser(userSub, payload)

	// Invalidation is kicked off in a goroutine so the dispatch hot path
	// stays non-blocking. Give it a tiny window to complete.
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		anyExists := false
		for _, k := range keys {
			if mr.Exists(k) {
				anyExists = true
				break
			}
		}
		if !anyExists {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	for _, k := range keys {
		if mr.Exists(k) {
			t.Errorf("dispatchToUser left cache key %q in Redis; stale data could still serve on the next refetch", k)
		}
	}
}

// TestDispatchToUserWithNoClientsStillInvalidates covers the edge case
// where the user has no active SSE connection (ticker/main app closed
// but dashboard cache from earlier poll is still in Redis). A CDC event
// should still clear that cache so when the user reopens the app, the
// fresh-from-DB dashboard is served on first poll.
func TestDispatchToUserWithNoClientsStillInvalidates(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()

	prevHub := globalHub
	globalHub = &Hub{
		registry:   &topicRegistry{},
		dispatchCh: make(chan dispatchJob, 1),
	}
	defer func() { globalHub = prevHub }()

	const userSub = "user_offline_but_cached"
	cacheKey := RedisDashboardCachePrefix + userSub

	mr.Set(cacheKey, `{"data":{"finance":[{"symbol":"TSLA","price":200}]}}`)

	// No register() call — user is "offline"
	globalHub.dispatchToUser(userSub, []byte(`{"data":[]}`))

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if !mr.Exists(cacheKey) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if mr.Exists(cacheKey) {
		t.Errorf("dispatchToUser should invalidate cache even when user has no live SSE clients; otherwise the cache serves stale data on next poll after reconnect")
	}
}

// TestInvalidateIdempotent — calling invalidate on a user who has no cache
// entry must be a safe no-op (no panic, no error log spam).
func TestInvalidateIdempotent(t *testing.T) {
	_, cleanup := setupMiniRedis(t)
	defer cleanup()

	// Keys do not exist.
	InvalidateDashboardCache("never_cached_user")
	InvalidateUserCaches("never_cached_user")

	// Verify Redis is reachable after the ops (sanity check).
	if err := Rdb.Ping(context.Background()).Err(); err != nil {
		t.Errorf("Redis ping failed after no-op invalidate: %v", err)
	}
}
