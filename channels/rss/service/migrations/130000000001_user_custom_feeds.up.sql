-- Per-user custom feed registry, introduced 2026-05-06.
--
-- Why this exists: until now `tracked_feeds` (the polling-target table)
-- was the SOLE store for both curated/default feeds and user-added
-- custom feeds, distinguished only by `is_default`. The catalog
-- endpoint that powers the desktop UI's "add feeds" picker read from
-- `tracked_feeds` with no per-user filter, so user A's custom feeds
-- showed up in user B's catalog. Multi-tenant data leak.
--
-- The fix is structural: split per-user metadata into this table.
-- `tracked_feeds` continues to be the single polling target (the Rust
-- ingestion service still polls each unique URL once regardless of
-- how many users subscribe), but the catalog endpoint now joins
-- `tracked_feeds` (for curated defaults + health columns) with
-- `user_custom_feeds` (for the requesting user's customs only).
--
-- Each user owns their own (name, category) for a given URL — two
-- users adding the same URL get two rows here with potentially
-- different display names. The `tracked_feeds` row deduplicates the
-- URL for polling purposes only.
CREATE TABLE IF NOT EXISTS user_custom_feeds (
    logto_sub  TEXT NOT NULL,
    url        TEXT NOT NULL,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'Custom',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (logto_sub, url)
);

CREATE INDEX IF NOT EXISTS idx_user_custom_feeds_url
  ON user_custom_feeds(url);

CREATE INDEX IF NOT EXISTS idx_user_custom_feeds_logto_sub
  ON user_custom_feeds(logto_sub);

-- Backfill from existing tracked_feeds rows that were custom feeds
-- with a recorded `added_by`. Rows where `added_by IS NULL` are
-- pre-`added_by`-migration legacy and are intentionally left orphaned
-- in tracked_feeds; the auto-cleanup janitor introduced in this same
-- batch will eventually remove them when they hit broken thresholds.
INSERT INTO user_custom_feeds (logto_sub, url, name, category, created_at)
SELECT added_by, url, name, category, COALESCE(created_at, NOW())
FROM tracked_feeds
WHERE is_default = false
  AND added_by IS NOT NULL
ON CONFLICT (logto_sub, url) DO NOTHING;
