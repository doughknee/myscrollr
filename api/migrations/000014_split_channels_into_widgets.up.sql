-- Widget/slot redesign (2026-06-30): flatten coarse channel rows into
-- per-widget rows. channel_type now holds a widget id (see api/core/widgets.go).
--
-- Grandfather contract: this only re-shapes existing rows; it never drops a
-- user below their new slot cap. Slot enforcement (CreateChannel) applies to
-- NEW adds only, so a user who ends up over-cap after the split keeps every
-- widget enabled.

-- ── Sports: one row per league ──────────────────────────────────────
-- The league name stays in config.leagues so the existing per-league CDC
-- routing (cdc:sports:{LEAGUE}, sports:subscribers:league:{LEAGUE}) keeps
-- working untouched — only the row's identity (channel_type) changes. The
-- widget id is the league slug, e.g. "NFL" -> sports_nfl,
-- "Premier League" -> sports_premier_league.
INSERT INTO user_channels (logto_sub, channel_type, enabled, visible, config, created_at, updated_at)
SELECT
    uc.logto_sub,
    'sports_' || lower(regexp_replace(lg.value, '[^a-zA-Z0-9]+', '_', 'g')),
    uc.enabled,
    uc.visible,
    jsonb_set(uc.config, '{leagues}', jsonb_build_array(to_jsonb(lg.value))),
    uc.created_at,
    uc.updated_at
FROM user_channels uc
CROSS JOIN LATERAL jsonb_array_elements_text(uc.config -> 'leagues') AS lg(value)
WHERE uc.channel_type = 'sports'
  AND jsonb_typeof(uc.config -> 'leagues') = 'array'
ON CONFLICT (logto_sub, channel_type) DO NOTHING;

DELETE FROM user_channels WHERE channel_type = 'sports';

-- ── Finance: existing rows become the Stocks widget ─────────────────
-- The stocks/crypto distinction (tracked_symbols.category) lives in the
-- finance service's DB, not here, so we cannot split by class in a core-DB
-- migration. All existing symbols become the Stocks widget; they still get
-- quotes via the same per-symbol topic (cdc:finance:{SYMBOL}), and a user can
-- move crypto symbols into a Crypto widget afterwards. Rename is
-- collision-free because no finance_stocks row exists pre-migration.
UPDATE user_channels SET channel_type = 'finance_stocks' WHERE channel_type = 'finance';

-- ── News + Fantasy: pure renames ────────────────────────────────────
UPDATE user_channels SET channel_type = 'news' WHERE channel_type = 'rss';
UPDATE user_channels SET channel_type = 'fantasy_yahoo' WHERE channel_type = 'fantasy';

-- predictions keeps its id — already a single widget.
