-- Best-effort reversal of the widget/slot split. Forward-only is preferred
-- (see README "Rollbacks via rolling forward"); this exists for completeness
-- and local dev. It merges split widget rows back into the coarse channels.

-- ── Sports: aggregate sports_* rows back into one 'sports' row per user ──
-- Guards mirror the up migration: only rows with a real leagues array feed
-- the merge (post-split rows always have one, but configs are free-form —
-- a scalar would make jsonb_array_elements_text abort the whole migration).
-- Lossy by design: non-leagues config keys on split rows are dropped, and
-- bool_or re-enables a sports row if ANY league widget was enabled.
INSERT INTO user_channels (logto_sub, channel_type, enabled, visible, config, created_at, updated_at)
SELECT
    uc.logto_sub,
    'sports',
    bool_or(uc.enabled),
    bool_or(uc.visible),
    jsonb_build_object('leagues', jsonb_agg(DISTINCT lg.value)),
    min(uc.created_at),
    max(uc.updated_at)
FROM user_channels uc
CROSS JOIN LATERAL jsonb_array_elements_text(uc.config -> 'leagues') AS lg(value)
WHERE left(uc.channel_type, 7) = 'sports_'
  AND jsonb_typeof(uc.config -> 'leagues') = 'array'
GROUP BY uc.logto_sub
ON CONFLICT (logto_sub, channel_type) DO NOTHING;

DELETE FROM user_channels WHERE left(channel_type, 7) = 'sports_';

-- ── Finance: collapse back to a single 'finance' row ────────────────
-- Lossy: finance_crypto symbols are dropped (the pre-split model had no
-- asset-class separation). Stocks become the restored finance row. Renames
-- carry the same collision guard as the up migration (a legacy-type row can
-- coexist with the new type mid-deploy).
UPDATE user_channels uc SET channel_type = 'finance'
WHERE channel_type = 'finance_stocks'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'finance');
DELETE FROM user_channels WHERE channel_type IN ('finance_stocks', 'finance_crypto');

-- ── News + Fantasy: reverse the renames ─────────────────────────────
UPDATE user_channels uc SET channel_type = 'rss'
WHERE channel_type = 'news'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'rss');
DELETE FROM user_channels WHERE channel_type = 'news';

UPDATE user_channels uc SET channel_type = 'fantasy'
WHERE channel_type = 'fantasy_yahoo'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'fantasy');
DELETE FROM user_channels WHERE channel_type = 'fantasy_yahoo';
