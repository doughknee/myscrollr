package core

import (
	"context"
	"log"
	"sync"
	"time"
)

// Curated-feed URL cache.
//
// `tier_limits.go::ValidateChannelConfig` uses this to derive the
// `is_custom` flag server-side instead of trusting the client's
// `is_custom` field. A URL is custom iff it does NOT appear in the
// curated set (tracked_feeds.is_default = true).
//
// The cache holds a snapshot of curated URLs and refreshes lazily.
// It returns nil when the cache is empty AND a refresh fails (or DB
// is uninitialized — common in unit tests). Callers must handle the
// nil case by falling back to client-asserted `is_custom`. This
// fall-through is intentional: the pre-derivation behavior was to
// trust the client, so we never DEGRADE on cache failure.
//
// Why a package-level cache instead of a parameter passed through
// the call stack: ValidateChannelConfig is called from multiple
// places and is also covered by tests that don't have a context or
// DB. Adding parameters would force breaking signature changes
// across the codebase + tests. The cache+fallback is invisible to
// existing callers and safe in test mode.

const curatedFeedURLsCacheTTL = 5 * time.Minute

// curatedFeedURLsCacheTimeout is the per-query timeout for refreshing
// the curated set. Generous because this is a tiny SELECT against a
// small table and we'd rather wait than fall back to client-trust.
const curatedFeedURLsCacheTimeout = 3 * time.Second

var (
	curatedFeedURLsMu      sync.RWMutex
	curatedFeedURLsCache   map[string]bool // nil = unloaded
	curatedFeedURLsExpires time.Time       // zero = always refresh
)

// getCuratedFeedURLs returns the cached set of curated feed URLs.
//
// On a hit (cache present and unexpired): returns the cached map.
// On a miss (expired or never loaded): refreshes synchronously and
// returns the new map. If the refresh fails, returns the previous
// cached value (could be nil).
//
// Returning nil signals "no curated set available — fall back to
// client-asserted is_custom". Tests run with DBPool == nil so they
// always get nil, which preserves the legacy client-trust behavior
// without test changes.
//
// Uses a 3-second per-query timeout so a slow DB doesn't wedge
// channel-update requests.
func getCuratedFeedURLs() map[string]bool {
	curatedFeedURLsMu.RLock()
	if !curatedFeedURLsExpires.IsZero() && time.Now().Before(curatedFeedURLsExpires) {
		cache := curatedFeedURLsCache
		curatedFeedURLsMu.RUnlock()
		return cache
	}
	curatedFeedURLsMu.RUnlock()

	if DBPool == nil {
		// Test or pre-init mode — no DB available. Fall through to
		// client-asserted is_custom in callers.
		return nil
	}

	curatedFeedURLsMu.Lock()
	defer curatedFeedURLsMu.Unlock()

	// Double-check after acquiring the write lock — another goroutine
	// may have refreshed while we were waiting.
	if !curatedFeedURLsExpires.IsZero() && time.Now().Before(curatedFeedURLsExpires) {
		return curatedFeedURLsCache
	}

	ctx, cancel := context.WithTimeout(context.Background(), curatedFeedURLsCacheTimeout)
	defer cancel()

	rows, err := DBPool.Query(ctx, "SELECT url FROM tracked_feeds WHERE is_default = true")
	if err != nil {
		log.Printf("[TierLimits] curated URL refresh failed: %v (using stale cache=%v)", err, curatedFeedURLsCache != nil)
		// Don't bump the expiry on failure; let the next call retry.
		return curatedFeedURLsCache
	}
	defer rows.Close()

	urls := make(map[string]bool, 256)
	for rows.Next() {
		var url string
		if scanErr := rows.Scan(&url); scanErr == nil {
			urls[url] = true
		}
	}

	curatedFeedURLsCache = urls
	curatedFeedURLsExpires = time.Now().Add(curatedFeedURLsCacheTTL)
	return urls
}

// invalidateCuratedFeedURLs forces the next getCuratedFeedURLs call
// to refresh from DB. Useful from tests; rarely needed in prod since
// the curated set changes infrequently and a 5-min TTL is acceptable.
func invalidateCuratedFeedURLs() {
	curatedFeedURLsMu.Lock()
	curatedFeedURLsExpires = time.Time{}
	curatedFeedURLsMu.Unlock()
}
