package ingestread

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/getsentry/sentry-go"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const MaxCustomFeeds = 50

type RSSWriteError struct {
	Reason     string
	Message    string
	Status     int
	RetryAfter int
}

func (e *RSSWriteError) Error() string { return e.Message }

// Both budgets are shared across replicas and independent of source IP.
var rssWriteBudget = redis.NewScript(`
local writes = tonumber(redis.call('GET', KEYS[1]) or '0')
local adds = tonumber(redis.call('GET', KEYS[2]) or '0')
if writes >= 60 then return math.max(1, redis.call('TTL', KEYS[1])) end
if adds + tonumber(ARGV[1]) > 100 then return math.max(1, redis.call('TTL', KEYS[2])) end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if tonumber(ARGV[1]) > 0 then
  if redis.call('INCRBY', KEYS[2], ARGV[1]) == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[2], 86400) end
end
return 0`)

func consumeRSSBudget(ctx context.Context, sub string, additions int) error {
	unavailable := &RSSWriteError{Reason: "unavailable", Message: "Feed changes are temporarily unavailable. Please retry.", Status: 503, RetryAfter: 5}
	if platform.Rdb == nil {
		return unavailable
	}
	retry, err := rssWriteBudget.Run(ctx, platform.Rdb, []string{"rss:writes:{" + sub + "}", "rss:adds:{" + sub + "}"}, additions).Int()
	if err != nil {
		return unavailable
	}
	if retry > 0 {
		return &RSSWriteError{Reason: "rate_limit", Message: "Too many feed changes. Please wait before trying again.", Status: 429, RetryAfter: retry}
	}
	return nil
}

// SyncRSSFeeds runs in the widget transaction: limits, target rows, and the
// saved widget commit together. The per-account lock prevents concurrent cap bypass.
func SyncRSSFeeds(ctx context.Context, tx pgx.Tx, sub string, config map[string]interface{}) error {
	if err := ValidateRSSConfig(config); err != nil {
		return err
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	var parsed struct {
		Feeds []struct {
			URL  string `json:"url"`
			Name string `json:"name"`
		} `json:"feeds"`
	}
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return err
	}
	if len(parsed.Feeds) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 370))`, sub); err != nil {
		return err
	}
	curated := make(map[string]bool)
	for _, def := range platform.Catalog() {
		if platform.DataSourceForWidget(def.ID) == "rss" {
			for _, u := range platform.ExtractFeedURLsFromConfig(platform.DefaultConfigFor(def.ID)) {
				curated[u] = true
			}
		}
	}
	rows, err := tx.Query(ctx, `SELECT url FROM tracked_feeds WHERE is_default = true`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			rows.Close()
			return err
		}
		curated[u] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	owned := make(map[string]bool)
	rows, err = tx.Query(ctx, `SELECT url FROM user_custom_feeds WHERE logto_sub = $1`, sub)
	if err != nil {
		return err
	}
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			rows.Close()
			return err
		}
		owned[u] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	added := make(map[string]bool)
	hasCustom := false
	for _, feed := range parsed.Feeds {
		if !curated[feed.URL] {
			hasCustom = true
			if !owned[feed.URL] {
				added[feed.URL] = true
			}
		}
	}
	if len(added) > 0 && len(owned)+len(added) > MaxCustomFeeds {
		return &RSSWriteError{Reason: "feed_limit", Message: fmt.Sprintf("You can keep up to %d custom feeds. Remove a custom feed before adding another.", MaxCustomFeeds), Status: 409}
	}
	if hasCustom {
		if err := consumeRSSBudget(ctx, sub, len(added)); err != nil {
			return err
		}
	}
	seen := make(map[string]bool)
	for _, feed := range parsed.Feeds {
		if seen[feed.URL] {
			continue
		}
		seen[feed.URL] = true
		name := feed.Name
		if name == "" {
			name = feed.URL
		}
		if _, err := tx.Exec(ctx, `INSERT INTO tracked_feeds (url, name, category, is_default, is_enabled, added_by)
			VALUES ($1, $2, 'Custom', $4, true, $3) ON CONFLICT (url) DO NOTHING`, feed.URL, name, sub, curated[feed.URL]); err != nil {
			return err
		}
		if curated[feed.URL] {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO user_custom_feeds (logto_sub, url, name, category)
			VALUES ($1, $2, $3, 'Custom') ON CONFLICT (logto_sub, url) DO UPDATE SET name = EXCLUDED.name`, sub, feed.URL, name); err != nil {
			return err
		}
	}
	return nil
}

// Retain hourly security counts, never submitted URLs, tokens, emails or IPs.
func RecordRSSAbuse(sub, reason string) {
	if platform.DBPool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	actor := platform.HashUserSub(sub)
	var count int
	err := platform.DBPool.QueryRow(ctx, `INSERT INTO rss_security_events (hour, actor, reason)
		VALUES (date_trunc('hour', now()), $1, $2)
		ON CONFLICT (hour, actor, reason) DO UPDATE SET attempts = rss_security_events.attempts + 1, last_seen = now()
		RETURNING attempts`, actor, reason).Scan(&count)
	if err != nil {
		log.Print("[RSS Security] Failed to record rejection")
		return
	}
	if count == 5 {
		sentry.WithScope(func(scope *sentry.Scope) {
			scope.SetLevel(sentry.LevelWarning)
			scope.SetTag("feature", "rss-abuse")
			scope.SetTag("reason", reason)
			if actor != "" {
				scope.SetUser(sentry.User{ID: actor})
			}
			sentry.CaptureMessage("Repeated RSS write rejection")
		})
	}
}
