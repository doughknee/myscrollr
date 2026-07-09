-- Best-effort reversal of the News per-feed split (mirrors 000014.down).
-- Forward-only is preferred (see README "Rollbacks via rolling forward"); this
-- exists for completeness and local dev. It merges the per-feed news_* and
-- rss_custom rows back into one coarse 'news' row per user.
--
-- Lossy by design: per-widget config nuance is dropped, feeds are deduped into
-- a single array, and bool_or re-enables the coarse row if ANY feed widget was
-- enabled. The typeof guard mirrors the up migration.
INSERT INTO user_channels (logto_sub, channel_type, enabled, visible, config, created_at, updated_at)
SELECT
    uc.logto_sub,
    'news',
    bool_or(uc.enabled),
    bool_or(uc.visible),
    jsonb_build_object('feeds', jsonb_agg(DISTINCT f.feed)),
    min(uc.created_at),
    max(uc.updated_at)
FROM user_channels uc
CROSS JOIN LATERAL jsonb_array_elements(uc.config -> 'feeds') AS f(feed)
WHERE (left(uc.channel_type, 5) = 'news_' OR uc.channel_type = 'rss_custom')
  AND jsonb_typeof(uc.config -> 'feeds') = 'array'
GROUP BY uc.logto_sub
ON CONFLICT (logto_sub, channel_type) DO NOTHING;

DELETE FROM user_channels
WHERE left(channel_type, 5) = 'news_' OR channel_type = 'rss_custom';
