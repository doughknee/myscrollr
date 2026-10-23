package ingestread

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestRSSBudgetsAtomicAndNonSliding(t *testing.T) {
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	ctx := context.Background()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 70; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if consumeRSSBudget(ctx, "burst", 0) == nil {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 60 {
		t.Fatalf("admitted %d writes; want 60", accepted.Load())
	}
	if err := consumeRSSBudget(ctx, "another-account", 0); err != nil {
		t.Fatal(err)
	}
	mr.FastForward(time.Minute)
	if err := consumeRSSBudget(ctx, "burst", 0); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := consumeRSSBudget(ctx, "daily", 50); err != nil {
			t.Fatal(err)
		}
	}
	var limited *RSSWriteError
	if err := consumeRSSBudget(ctx, "daily", 1); !errors.As(err, &limited) || limited.Status != 429 || limited.RetryAfter != 86400 {
		t.Fatalf("daily limit: %v", err)
	}
	mr.FastForward(time.Hour)
	if err := consumeRSSBudget(ctx, "daily", 1); !errors.As(err, &limited) || limited.RetryAfter != 82800 {
		t.Fatalf("daily window slides: %v", err)
	}
	if err := consumeRSSBudget(ctx, "daily", 0); err != nil {
		t.Fatalf("existing feed edit blocked: %v", err)
	}
	mr.FastForward(23 * time.Hour)
	if err := consumeRSSBudget(ctx, "daily", 1); err != nil {
		t.Fatal(err)
	}
	previous := platform.Rdb
	platform.Rdb = nil
	err := consumeRSSBudget(ctx, "unavailable", 1)
	platform.Rdb = previous
	if !errors.As(err, &limited) || limited.Status != 503 {
		t.Fatalf("Redis outage: %v", err)
	}
}

func rssLimitConfig(urls ...string) map[string]interface{} {
	feeds := make([]interface{}, 0, len(urls))
	for _, u := range urls {
		feeds = append(feeds, map[string]interface{}{"url": u, "name": "Test feed"})
	}
	return map[string]interface{}{"feeds": feeds}
}

func TestRSSCapSerializesConcurrentAdditionsAndPreservesExistingFeeds(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	_, cleanupRedis := testsupport.MiniRedis(t)
	defer cleanupRedis()
	ctx := context.Background()
	sub := fmt.Sprintf("rss-cap-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM user_custom_feeds WHERE logto_sub=$1`, sub)
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM tracked_feeds WHERE added_by=$1 AND is_default=false`, sub)
	})
	save := func(config map[string]interface{}, commit bool) error {
		tx, err := platform.DBPool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if err := SyncRSSFeeds(ctx, tx, sub, config); err != nil {
			return err
		}
		if commit {
			return tx.Commit(ctx)
		}
		return nil
	}
	var urls []string
	for i := 0; i < 49; i++ {
		urls = append(urls, fmt.Sprintf("https://example.com/%s/%d", sub, i))
	}
	if err := save(rssLimitConfig(urls...), true); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 49; i < 51; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results <- save(rssLimitConfig(fmt.Sprintf("https://example.com/%s/%d", sub, i)), true)
		}(i)
	}
	wg.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		var limited *RSSWriteError
		if err == nil {
			accepted++
		} else if errors.As(err, &limited) && limited.Reason == "feed_limit" {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("accepted=%d rejected=%d", accepted, rejected)
	}
	var count int
	if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM user_custom_feeds WHERE logto_sub=$1`, sub).Scan(&count); err != nil || count != 50 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	if err := save(rssLimitConfig(urls[0], urls[0]), true); err != nil {
		t.Fatalf("existing/duplicate edit: %v", err)
	}
	if err := save(platform.DefaultConfigFor("news_npr"), true); err != nil {
		t.Fatalf("curated feed at cap: %v", err)
	}
	// Removing a saved feed frees a slot; a rolled-back widget must not leave a target behind.
	if _, err := platform.DBPool.Exec(ctx, `DELETE FROM user_custom_feeds WHERE logto_sub=$1 AND url=$2`, sub, urls[0]); err != nil {
		t.Fatal(err)
	}
	rollbackURL := "https://example.com/" + sub + "/rollback"
	if err := save(rssLimitConfig(rollbackURL), false); err != nil {
		t.Fatal(err)
	}
	if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM tracked_feeds WHERE url=$1`, rollbackURL).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback left target: %d %v", count, err)
	}
	if err := save(rssLimitConfig(rollbackURL), true); err != nil {
		t.Fatal(err)
	}
	if _, err := platform.DBPool.Exec(ctx, `UPDATE tracked_feeds SET is_enabled=false WHERE url=$1`, rollbackURL); err != nil {
		t.Fatal(err)
	}
	if err := save(rssLimitConfig(rollbackURL), true); err != nil {
		t.Fatal(err)
	}
	var enabled bool
	if err := platform.DBPool.QueryRow(ctx, `SELECT is_enabled FROM tracked_feeds WHERE url=$1`, rollbackURL).Scan(&enabled); err != nil || enabled {
		t.Fatalf("disabled target reactivated: %t %v", enabled, err)
	}
}

func TestRSSAuditStoresOnlyHashedActorAndCounts(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	t.Setenv("SENTRY_USER_SALT", "test-security-salt")
	sub := "audit-secret-subject"
	actor := platform.HashUserSub(sub)
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(), `DELETE FROM rss_security_events WHERE actor=$1`, actor)
	})
	RecordRSSAbuse(sub, "invalid_destination")
	RecordRSSAbuse(sub, "invalid_destination")
	var count int
	var saved string
	err := platform.DBPool.QueryRow(context.Background(), `SELECT actor, attempts FROM rss_security_events WHERE actor=$1 AND reason='invalid_destination'`, actor).Scan(&saved, &count)
	if err != nil || saved == sub || saved == "" || count != 2 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
}
