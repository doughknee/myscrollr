// Package main — RSS auto-cleanup janitor.
//
// The janitor runs in a background goroutine on every RSS API pod. Its
// job is to recognise feeds that are definitively broken and remove
// them from the system (and from each subscribing user's config) so
// users aren't stuck with dead URLs in their personal feed list.
//
// "Definitively broken" means one of:
//
//   - last_success_at older than 7 days (LastSuccessStaleThreshold)
//   - never successfully polled AND created_at older than 7 days
//   - consecutive_failures >= 100 (~8 hours of 5-min polling failures —
//     more aggressive than the 24h Rust-side quarantine threshold of 288)
//
// Cleanup behavior depends on whether the feed is curated or custom:
//
//   - Custom feeds (is_default = false) are FULLY REMOVED:
//     - user_custom_feeds rows for the URL are deleted
//     - tracked_feeds row is deleted (cascades rss_items)
//     - The subscriber Redis set is deleted
//     - For each subscribing user, their user_channels.config.feeds[]
//       JSONB array has the broken URL removed
//
//   - Curated feeds (is_default = true) are operator-managed; the
//     janitor only marks is_enabled = false and logs a warning. Hands-on
//     removal is the operator's call, not automatic.
//
// The janitor runs on startup AND every JanitorInterval (6 hours).
// All operations are idempotent — running it twice in a row produces
// no different end-state than running it once.

package main

import (
	"context"
	"log"
	"time"
)

const (
	// LastSuccessStaleThreshold is how old `last_success_at` is allowed
	// to be before the janitor classifies the feed as broken. 7 days
	// catches truly-dead feeds while tolerating a week-long outage of
	// an otherwise-good source.
	LastSuccessStaleThreshold = "7 days"

	// MaxConsecutiveFailuresJanitor is the failure-count threshold for
	// auto-removal. 100 cycles × 5 min = ~8h. More aggressive than the
	// Rust-side quarantine at 288 (~24h) because the janitor's threshold
	// is for AUTO-REMOVAL while quarantine just stops polling.
	MaxConsecutiveFailuresJanitor = 100

	// JanitorInterval is how often the cleanup runs. 6 hours is
	// frequent enough to catch broken feeds within a quarter-day
	// without spamming logs.
	JanitorInterval = 6 * time.Hour

	// JanitorRunTimeout caps how long a single janitor cycle can run
	// before being cancelled. Set generously: a typical run touches
	// only a handful of broken-feed URLs, but if the prod DB is slow
	// or there's a thundering herd of recently-broken feeds we don't
	// want the janitor to wedge.
	JanitorRunTimeout = 5 * time.Minute
)

// startJanitor launches the auto-cleanup loop in a goroutine. Returns
// immediately so the caller can continue with the rest of startup.
//
// The loop runs once on launch (after a brief sleep so other startup
// machinery completes first) and then every JanitorInterval. It uses
// a child context derived from rootCtx; when the root is cancelled
// (e.g. SIGTERM during pod termination) the janitor exits cleanly.
func (a *App) startJanitor(rootCtx context.Context) {
	go func() {
		// Wait briefly so DB pool warmup, channel registration, etc.
		// complete before the first janitor pass.
		select {
		case <-time.After(30 * time.Second):
		case <-rootCtx.Done():
			return
		}

		log.Printf("[RSS Janitor] starting; interval=%s, last-success-threshold=%s, max-failures=%d",
			JanitorInterval, LastSuccessStaleThreshold, MaxConsecutiveFailuresJanitor)

		for {
			a.runJanitorOnce(rootCtx)

			select {
			case <-time.After(JanitorInterval):
				continue
			case <-rootCtx.Done():
				log.Printf("[RSS Janitor] stopping (root context cancelled)")
				return
			}
		}
	}()
}

// runJanitorOnce performs a single cleanup pass. Idempotent.
//
// Wraps the entire pass in JanitorRunTimeout. Any error in a sub-step
// is logged but doesn't abort the whole pass — partial cleanup is
// better than no cleanup, and the next cycle will pick up whatever this
// one missed.
func (a *App) runJanitorOnce(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, JanitorRunTimeout)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RSS Janitor] PANIC during cleanup pass: %v", r)
		}
	}()

	// Step 1 — disable broken curated feeds (operator action required
	// for actual removal; we just stop showing them in catalogs).
	disabled, err := a.disableBrokenCuratedFeeds(ctx)
	if err != nil {
		log.Printf("[RSS Janitor] disable curated step failed: %v", err)
	} else if disabled > 0 {
		log.Printf("[RSS Janitor] disabled %d broken curated feed(s) — operator action recommended", disabled)
	}

	// Step 2 — remove broken custom feeds (full cleanup).
	removed, err := a.removeBrokenCustomFeeds(ctx)
	if err != nil {
		log.Printf("[RSS Janitor] remove custom step failed: %v", err)
	} else if removed > 0 {
		log.Printf("[RSS Janitor] removed %d broken custom feed(s) and pruned subscriber configs", removed)
	}

	if disabled > 0 || removed > 0 {
		// Some catalogs may have stale content. Drop every cached
		// user catalog so next read sees the new state.
		a.invalidateAllCatalogCaches(ctx)
	}
}

// disableBrokenCuratedFeeds flips is_enabled = false on curated feeds
// (is_default = true) that have crossed the broken threshold. Returns
// the count of rows updated. The feeds are NOT removed — operators
// decide whether the curated catalog should drop them entirely.
func (a *App) disableBrokenCuratedFeeds(ctx context.Context) (int, error) {
	const q = `
		UPDATE tracked_feeds
		   SET is_enabled = false,
		       last_error = COALESCE(last_error, '') || ' [auto-disabled by janitor at ' || NOW()::text || ']'
		 WHERE is_default = true
		   AND is_enabled = true
		   AND (
			   (last_success_at IS NULL AND created_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `')
			OR last_success_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `'
			OR consecutive_failures >= $1
		   )
	`
	cmd, err := a.db.Exec(ctx, q, MaxConsecutiveFailuresJanitor)
	if err != nil {
		return 0, err
	}
	return int(cmd.RowsAffected()), nil
}

// removeBrokenCustomFeeds finds custom feeds (is_default = false) that
// have crossed the broken threshold and removes them everywhere:
//
//  1. Lists their URLs (the union of broken-by-staleness or
//     broken-by-failure-count).
//  2. For each URL, prunes user_channels.config.feeds[] for every
//     subscribing user so the URL no longer appears in their pinned
//     feed list.
//  3. Deletes user_custom_feeds rows for the URL.
//  4. Deletes the tracked_feeds row (rss_items cascades via FK).
//  5. Drops the per-URL Redis subscriber set.
//
// Returns the count of unique URLs removed.
//
// Per-step errors are logged but don't halt the pass — partial cleanup
// is still useful, and the next cycle will pick up whatever was missed.
func (a *App) removeBrokenCustomFeeds(ctx context.Context) (int, error) {
	// Step 1 — find the URLs.
	const findQ = `
		SELECT url FROM tracked_feeds
		 WHERE is_default = false
		   AND (
			   (last_success_at IS NULL AND created_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `')
			OR last_success_at < NOW() - INTERVAL '` + LastSuccessStaleThreshold + `'
			OR consecutive_failures >= $1
		   )
	`
	rows, err := a.db.Query(ctx, findQ, MaxConsecutiveFailuresJanitor)
	if err != nil {
		return 0, err
	}
	urls := make([]string, 0)
	for rows.Next() {
		var url string
		if scanErr := rows.Scan(&url); scanErr == nil {
			urls = append(urls, url)
		}
	}
	rows.Close()

	if len(urls) == 0 {
		return 0, nil
	}

	for _, url := range urls {
		// Step 2 — prune user_channels.config.feeds[] for each
		// subscribing user. The JSONB filter at the bottom of the
		// CASE expression rebuilds the feeds array minus the broken
		// URL, then writes it back. Users with no rss row aren't
		// affected.
		//
		// We use jsonb_set + jsonb_agg + jsonb_array_elements; the
		// COALESCE handles the case where filtering produces an empty
		// set (jsonb_agg returns NULL on empty input, but config.feeds
		// must be a JSON array, not null).
		if _, pruneErr := a.db.Exec(ctx, `
			UPDATE user_channels
			   SET config = jsonb_set(
				   config,
				   '{feeds}',
				   COALESCE(
				       (SELECT jsonb_agg(item)
				        FROM jsonb_array_elements(config->'feeds') item
				        WHERE item->>'url' != $2),
				       '[]'::jsonb
				   )
			   )
			 WHERE channel_type = 'rss'
			   AND config ? 'feeds'
			   AND config->'feeds' @> jsonb_build_array(jsonb_build_object('url', $2::text))
		`, MaxConsecutiveFailuresJanitor, url); pruneErr != nil {
			log.Printf("[RSS Janitor] prune user_channels for %s failed: %v", url, pruneErr)
			// Continue — better to remove tracked_feeds with a few
			// stale user configs than skip the URL entirely.
		}

		// Step 3 — drop user_custom_feeds rows for the URL. Removes
		// every user's tenancy claim on this URL.
		if _, ucfErr := a.db.Exec(ctx,
			"DELETE FROM user_custom_feeds WHERE url = $1", url); ucfErr != nil {
			log.Printf("[RSS Janitor] delete user_custom_feeds for %s failed: %v", url, ucfErr)
		}

		// Step 4 — drop the tracked_feeds row. rss_items cascades.
		// Guard `is_default = false` defensively even though the find
		// query already filtered to customs.
		if _, tfErr := a.db.Exec(ctx,
			"DELETE FROM tracked_feeds WHERE url = $1 AND is_default = false", url); tfErr != nil {
			log.Printf("[RSS Janitor] delete tracked_feeds for %s failed: %v", url, tfErr)
		}

		// Step 5 — drop the subscriber set in Redis.
		a.rdb.Del(ctx, RedisRSSSubscribersPrefix+url)
	}

	return len(urls), nil
}
