-- Finish the channel→widget split for News (follow-up to 000014).
--
-- 000014 split sports per-league but only RENAMED rss → 'news' (a single
-- coarse row). The catalog, though, is per-feed — news_bbc, news_guardian, …
-- (desktop/src/marketplace.ts) — and the "already added?" check is an exact
-- widget-id match (catalog.tsx). So a pre-split user's coarse 'news' row never
-- matches any per-feed card: a feed they already read (e.g. The Guardian)
-- shows as addable and, if added, spawns a second slot-consuming row for the
-- same content. This splits each coarse 'news' row into per-feed widgets so
-- the id space matches the catalog and dedup/slot-counting work.
--
-- Mapping mirrors the marketplace catalog: match each feed to a curated widget
-- id by URL (name is a fallback for slight URL drift); everything unmatched is
-- a user's own feed and collapses into the one rss_custom widget (which is
-- built to hold many feeds).
--
-- Grandfather contract (same as 000014): additive — never drops a user below
-- their slot cap. A news-heavy user ends up over-cap but keeps every feed;
-- only NEW adds are gated. We delete only the coarse rows the split consumed.

WITH feed_map(match_url, match_name, widget_id) AS (VALUES
    ('https://feeds.bbci.co.uk/news/rss.xml',                                                  'BBC News',          'news_bbc'),
    ('https://feeds.npr.org/1001/rss.xml',                                                      'NPR News',          'news_npr'),
    ('https://www.theguardian.com/world/rss',                                                   'The Guardian',      'news_guardian'),
    ('https://www.aljazeera.com/xml/rss/all.xml',                                               'Al Jazeera',        'news_aljazeera'),
    ('https://feeds.propublica.org/propublica/main',                                            'ProPublica',        'news_propublica'),
    ('https://feeds.bloomberg.com/markets/news.rss',                                            'Bloomberg Markets', 'news_bloomberg'),
    ('https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',    'CNBC Top News',     'news_cnbc'),
    ('https://www.nasa.gov/news-release/feed/',                                                 'NASA Breaking News','news_nasa'),
    ('https://hnrss.org/frontpage',                                                             'Hacker News',       'news_hackernews'),
    ('https://www.theverge.com/rss/index.xml',                                                  'The Verge',         'news_theverge')
),
-- Explode every coarse 'news' row into its individual feeds. The typeof guard
-- mirrors 000014: a scalar/absent feeds value would make jsonb_array_elements
-- abort the whole migration.
exploded AS (
    SELECT
        uc.logto_sub,
        uc.enabled,
        uc.visible,
        uc.created_at,
        uc.updated_at,
        f.feed,
        f.feed->>'url'  AS feed_url,
        f.feed->>'name' AS feed_name
    FROM user_channels uc
    CROSS JOIN LATERAL jsonb_array_elements(uc.config -> 'feeds') AS f(feed)
    WHERE uc.channel_type = 'news'
      AND jsonb_typeof(uc.config -> 'feeds') = 'array'
),
-- Resolve each feed to a widget id: curated match → news_*, else rss_custom.
resolved AS (
    SELECT
        e.logto_sub, e.enabled, e.visible, e.created_at, e.updated_at, e.feed,
        COALESCE(m.widget_id, 'rss_custom') AS widget_id
    FROM exploded e
    LEFT JOIN feed_map m
        ON m.match_url = e.feed_url OR m.match_name = e.feed_name
)
-- One row per (user, widget_id). A curated widget carries its single feed;
-- rss_custom aggregates all of a user's custom feeds. On conflict (the target
-- widget already exists — e.g. the user re-added it from the new catalog, or a
-- rolling deploy raced this migration) MERGE the feed lists (deduped) instead
-- of dropping the coarse row's feeds.
INSERT INTO user_channels (logto_sub, channel_type, enabled, visible, config, created_at, updated_at)
SELECT
    r.logto_sub,
    r.widget_id,
    bool_or(r.enabled),
    bool_or(r.visible),
    jsonb_build_object('feeds', jsonb_agg(DISTINCT r.feed)),
    min(r.created_at),
    max(r.updated_at)
FROM resolved r
GROUP BY r.logto_sub, r.widget_id
ON CONFLICT (logto_sub, channel_type) DO UPDATE
    -- Parenthesise (EXCLUDED.config -> 'feeds'): Postgres ranks -> and || at
    -- the SAME precedence (left-associative), so without parens this parses as
    -- (existing_array || EXCLUDED.config) -> 'feeds' → NULL → a scalar-null
    -- feeds. Concatenate the two feed ARRAYS, then dedup.
    SET config = jsonb_build_object('feeds', (
            SELECT jsonb_agg(DISTINCT f)
            FROM jsonb_array_elements(
                COALESCE(user_channels.config -> 'feeds', '[]'::jsonb)
                || (EXCLUDED.config -> 'feeds')
            ) AS f
        )),
        enabled    = user_channels.enabled OR EXCLUDED.enabled,
        visible    = user_channels.visible OR EXCLUDED.visible,
        updated_at = GREATEST(user_channels.updated_at, EXCLUDED.updated_at);

-- Remove only the coarse 'news' rows the split actually consumed (had a
-- non-empty feeds array). Empty/malformed 'news' rows stay as legacy — as in
-- 000014's sports handling, deleting them would silently drop a user's widget.
-- (CASE, not chained AND: Postgres may reorder WHERE predicates, so the
-- array-length call must be provably guarded by the typeof check.)
DELETE FROM user_channels
WHERE channel_type = 'news'
  AND CASE WHEN jsonb_typeof(config -> 'feeds') = 'array'
           THEN jsonb_array_length(config -> 'feeds') > 0
           ELSE false END;
