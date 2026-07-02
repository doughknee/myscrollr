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
-- working untouched — only the row's identity (channel_type) changes.
--
-- Widget ids MUST match the desktop catalog / api/core/widgets.go, which
-- do not always equal the league-name slug ("Premier League" is
-- sports_premierleague, not sports_premier_league). Leagues without a
-- catalog widget fall back to the slug — they still route by the sports_
-- prefix and their config.leagues value.
INSERT INTO user_channels (logto_sub, channel_type, enabled, visible, config, created_at, updated_at)
SELECT
    uc.logto_sub,
    CASE lg.value
        WHEN 'NFL'                THEN 'sports_nfl'
        WHEN 'NBA'                THEN 'sports_nba'
        WHEN 'NHL'                THEN 'sports_nhl'
        WHEN 'MLB'                THEN 'sports_mlb'
        WHEN 'MLS'                THEN 'sports_mls'
        WHEN 'UFC'                THEN 'sports_ufc'
        WHEN 'AFL'                THEN 'sports_afl'
        WHEN 'NCAA Football'      THEN 'sports_ncaaf'
        WHEN 'NCAA Basketball'    THEN 'sports_ncaab'
        WHEN 'Premier League'     THEN 'sports_premierleague'
        WHEN 'La Liga'            THEN 'sports_laliga'
        WHEN 'Champions League'   THEN 'sports_championsleague'
        WHEN 'FIFA World Cup'     THEN 'sports_worldcup'
        WHEN 'Formula 1'          THEN 'sports_f1'
        ELSE 'sports_' || lower(regexp_replace(lg.value, '[^a-zA-Z0-9]+', '_', 'g'))
    END,
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

-- Remove ONLY the rows the split above actually consumed. A sports row with
-- no/empty/malformed leagues produced no widget rows — deleting it would
-- silently drop a user's widget, breaking the grandfather contract. Such
-- rows stay as legacy 'sports' (still a valid type: it routes by the
-- legacy coarse map and the user can reconfigure it).
-- (CASE, not chained AND: Postgres may reorder WHERE predicates, so the
-- array-length call must be provably guarded by the typeof check.)
DELETE FROM user_channels
WHERE channel_type = 'sports'
  AND CASE WHEN jsonb_typeof(config -> 'leagues') = 'array'
           THEN jsonb_array_length(config -> 'leagues') > 0
           ELSE false END;

-- ── Finance: existing rows become the Stocks widget ─────────────────
-- The stocks/crypto distinction (tracked_symbols.category) lives in the
-- finance service's DB, not here, so we cannot split by class in a core-DB
-- migration. All existing symbols become the Stocks widget; they still get
-- quotes via the same per-symbol topic (cdc:finance:{SYMBOL}), and a user can
-- move crypto symbols into a Crypto widget afterwards.
--
-- Renames are guarded against UNIQUE(logto_sub, channel_type) collisions:
-- during a rolling deploy the new API can create a new-type row before this
-- migration runs on another replica's boot. The old-type leftover (only
-- present when the user already owns the new type) is dropped — the newer
-- row is the user's current intent. This also makes a re-run a no-op.
UPDATE user_channels uc SET channel_type = 'finance_stocks'
WHERE channel_type = 'finance'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'finance_stocks');
DELETE FROM user_channels WHERE channel_type = 'finance';

-- ── News + Fantasy: renames, same collision guard ───────────────────
UPDATE user_channels uc SET channel_type = 'news'
WHERE channel_type = 'rss'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'news');
DELETE FROM user_channels WHERE channel_type = 'rss';

UPDATE user_channels uc SET channel_type = 'fantasy_yahoo'
WHERE channel_type = 'fantasy'
  AND NOT EXISTS (
      SELECT 1 FROM user_channels x
      WHERE x.logto_sub = uc.logto_sub AND x.channel_type = 'fantasy_yahoo');
DELETE FROM user_channels WHERE channel_type = 'fantasy';

-- predictions keeps its id — already a single widget.
