-- =============================================================================
-- One-off: delete the 8 permanently-failing RSS feeds that were flagged in
-- the 2026-04-23 health audit.
--
-- Symptoms: each feed had `consecutive_failures >= 237` with `last_error =
-- "unable to parse feed: no root element"`, meaning the upstream URL stopped
-- serving RSS/Atom XML. The retry-on-quarantine loop retries them every
-- ~24 hours and they fail again every time, bloating `error_count` in
-- `/health/ready` and the log volume.
--
-- Feeds removed:
--   1. NerdWallet          https://www.nerdwallet.com/blog/feed/
--   2. Reuters             https://www.reutersagency.com/feed/    (not in configs/feeds.json — orphan)
--   3. Webdesigner Depot   https://www.webdesignerdepot.com/feed/
--   4. ESPN Top Headlines  https://www.espn.com/espn/rss/news
--   5. ESPN NFL            https://www.espn.com/espn/rss/nfl/news
--   6. ESPN NBA            https://www.espn.com/espn/rss/nba/news
--   7. ESPN MLB            https://www.espn.com/espn/rss/mlb/news
--   8. ESPN NHL            https://www.espn.com/espn/rss/nhl/news
--
-- Effect: `DELETE FROM tracked_feeds` cascades to `rss_items` via the
-- `rss_items_feed_url_fkey ON DELETE CASCADE` foreign key, so all ingested
-- items for these feeds are removed as well.
--
-- User-widget cleanup: one user had Reuters in their `user_widgets.config`
-- JSONB. This script scrubs the URL from their saved config so they don't
-- see a broken tile. The scrub is idempotent and no-op for other users.
--
-- Idempotent: safe to re-run. `DELETE` is a no-op if the row is already
-- gone. The JSONB update only rewrites rows whose filter produces a
-- different array.
--
-- To run:
--
--   kubectl -n scrollr run pg-rss-cleanup --rm -i --restart=Never \
--     --image=postgres:16-alpine \
--     --env="PGURL=$(kubectl -n scrollr get secret scrollr-secrets \
--            -o jsonpath='{.data.DATABASE_URL}' | base64 -d)" \
--     --command -- sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1' \
--     < scripts/migrations/remove-dead-rss-feeds.sql
--
-- =============================================================================

BEGIN;

-- Pre-flight: confirm we're connected to a scrollr DB.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'tracked_feeds') THEN
        RAISE EXCEPTION 'Pre-flight failed: `tracked_feeds` table does not exist. Wrong database?';
    END IF;
END $$;

-- 1) Show what we're about to delete (for operator visibility)
\echo === Rows about to be deleted from tracked_feeds ===
SELECT name, url, consecutive_failures, last_success_at
FROM tracked_feeds
WHERE url IN (
    'https://www.nerdwallet.com/blog/feed/',
    'https://www.reutersagency.com/feed/',
    'https://www.webdesignerdepot.com/feed/',
    'https://www.espn.com/espn/rss/news',
    'https://www.espn.com/espn/rss/nfl/news',
    'https://www.espn.com/espn/rss/nba/news',
    'https://www.espn.com/espn/rss/mlb/news',
    'https://www.espn.com/espn/rss/nhl/news'
);

-- 2) Show cascade impact on rss_items
\echo === rss_items rows that will cascade-delete ===
SELECT feed_url, COUNT(*) AS items_to_delete
FROM rss_items
WHERE feed_url IN (
    'https://www.nerdwallet.com/blog/feed/',
    'https://www.reutersagency.com/feed/',
    'https://www.webdesignerdepot.com/feed/',
    'https://www.espn.com/espn/rss/news',
    'https://www.espn.com/espn/rss/nfl/news',
    'https://www.espn.com/espn/rss/nba/news',
    'https://www.espn.com/espn/rss/mlb/news',
    'https://www.espn.com/espn/rss/nhl/news'
)
GROUP BY feed_url
ORDER BY feed_url;

-- 3) Scrub the dead URLs from any user_widgets.config JSONB that
--    mentions them. Operates on every rss-type channel; a filter that
--    removes nothing is a no-op.
--
--    The `config` shape is `{"feeds": [{"url": "...", "name": "...", ...}, ...]}`
--    so we rebuild the feeds array, keeping only entries whose `url` is not
--    in the dead-feed set.
\echo === Scrubbing dead URLs from user_widgets.config ===
UPDATE user_widgets
SET
    config = jsonb_set(
        config,
        '{feeds}',
        COALESCE(
            (
                SELECT jsonb_agg(f)
                FROM jsonb_array_elements(config -> 'feeds') AS f
                WHERE f ->> 'url' NOT IN (
                    'https://www.nerdwallet.com/blog/feed/',
                    'https://www.reutersagency.com/feed/',
                    'https://www.webdesignerdepot.com/feed/',
                    'https://www.espn.com/espn/rss/news',
                    'https://www.espn.com/espn/rss/nfl/news',
                    'https://www.espn.com/espn/rss/nba/news',
                    'https://www.espn.com/espn/rss/mlb/news',
                    'https://www.espn.com/espn/rss/nhl/news'
                )
            ),
            '[]'::jsonb
        ),
        false
    ),
    updated_at = NOW()
WHERE widget_type = 'rss'
  AND config -> 'feeds' @> ANY(ARRAY[
      jsonb_build_array(jsonb_build_object('url', 'https://www.nerdwallet.com/blog/feed/')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.reutersagency.com/feed/')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.webdesignerdepot.com/feed/')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.espn.com/espn/rss/news')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.espn.com/espn/rss/nfl/news')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.espn.com/espn/rss/nba/news')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.espn.com/espn/rss/mlb/news')),
      jsonb_build_array(jsonb_build_object('url', 'https://www.espn.com/espn/rss/nhl/news'))
  ]);

-- 4) Delete the feeds themselves (cascades to rss_items).
\echo === Deleting rows from tracked_feeds (cascades to rss_items) ===
DELETE FROM tracked_feeds
WHERE url IN (
    'https://www.nerdwallet.com/blog/feed/',
    'https://www.reutersagency.com/feed/',
    'https://www.webdesignerdepot.com/feed/',
    'https://www.espn.com/espn/rss/news',
    'https://www.espn.com/espn/rss/nfl/news',
    'https://www.espn.com/espn/rss/nba/news',
    'https://www.espn.com/espn/rss/mlb/news',
    'https://www.espn.com/espn/rss/nhl/news'
);

-- 5) Final state
\echo === tracked_feeds summary after cleanup ===
SELECT
    COUNT(*) AS total_feeds,
    COUNT(*) FILTER (WHERE consecutive_failures > 0) AS failing_feeds,
    COUNT(*) FILTER (WHERE consecutive_failures >= 10) AS quarantined_feeds
FROM tracked_feeds;

COMMIT;
