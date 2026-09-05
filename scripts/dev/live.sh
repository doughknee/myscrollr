#!/usr/bin/env bash
# The dev dataset's clock.
#
# `make seed` loads a snapshot and rebases its timestamps to "now", and then
# nothing ever moves: no game kicks off, no score changes, no price drifts.
# Two days later every fixture that was "tonight" is in the past, the ticker
# shows only floors and stale finals, and a correctly working app looks
# broken. Every ingester is keyless in dev by design, so nothing upstream
# will ever advance it either.
#
# This advances it. Every TICK seconds:
#   games    'pre' whose start has passed become 'in' with a clock; live
#            games score at roughly the sport's real rate and show a period
#            or inning; after the sport's length they go 'final'.
#   trades   every price drifts a little; the sparkline gains the point; the
#            day range widens to hold it.
#   markets  implied probabilities drift a point or two.
#   caches   core's Redis caches are dropped, so the next dashboard poll
#            serves what is now in the database.
# Nothing is fabricated from nothing: every row that changes was already in
# the snapshot, and rss_items are left alone (a headline that never existed
# is not a headline). It makes no upstream requests and needs no API keys.
#
# Runs until Ctrl-C. `--once` does a single tick (used by CI); TICK=5
# tightens the cadence.
set -euo pipefail

cd "$(dirname "$0")/../.."

TICK="${TICK:-15}"
ONCE=0
for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    *) echo "[live] unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -f docker/compose.yml ]; then
  COMPOSE=(docker compose -f docker/compose.yml)
else
  COMPOSE=(docker compose)
fi
LOCAL_DB="postgres://scrollr:scrollr@localhost:5432/scrollr?sslmode=disable"

psql_in() { "${COMPOSE[@]}" exec -T postgres psql "$LOCAL_DB" -v ON_ERROR_STOP=1 "$@"; }
redis_in() { "${COMPOSE[@]}" exec -T redis redis-cli "$@"; }

if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "[live] postgres is not running — start the stack first (make up)." >&2
  exit 1
fi

# One tick of the world, in SQL. Random with a fixed shape rather than a
# script of events, so a second run is a different evening. A quoted heredoc,
# so it is plain SQL: '' is a literal apostrophe, nothing here is bash.
TICK_SQL=$(cat <<'SQL'
-- 1. Kick off: anything scheduled and past due is now in play.
UPDATE games SET
  state = 'in',
  home_team_score = 0, away_team_score = 0,
  status_short = CASE sport
    WHEN 'baseball' THEN 'T1'
    WHEN 'american-football' THEN 'Q1 15:00'
    WHEN 'football' THEN '1'''
    WHEN 'formula-1' THEN 'L1'
    WHEN 'mma' THEN 'R1'
    WHEN 'afl' THEN 'Q1'
    ELSE 'LIVE' END,
  short_detail = 'In Progress', status_long = 'In Progress',
  updated_at = now()
WHERE state = 'pre' AND start_time <= now() AND start_time > now() - interval '6 hours';

-- 2. Play: every live game gets a clock from how long it has run, and a
--    chance to score sized to the sport (a soccer goal is rarer than a run).
WITH live AS (
  SELECT id, sport, extract(epoch FROM (now() - start_time)) / 60.0 AS mins
  FROM games WHERE state = 'in'
), roll AS (
  -- Real scoring rates, per side, per tick. Derived from a typical game and
  -- the sport's length: MLB ~4.5 runs a side over 170 min, college football
  -- ~4 scoring plays a side over 190, soccer ~1.3 goals a side over 110, AFL
  -- ~25 scoring shots a side over 130. Scaled by the tick length so TICK=5
  -- does not triple the scoring. The first version rolled ~15x too often
  -- and had the Red Sox 14 runs up in the second inning.
  SELECT l.id, l.sport, l.mins,
         random() < (:tick / 15.0) * CASE l.sport WHEN 'baseball' THEN 0.0066 WHEN 'american-football' THEN 0.0053
                                 WHEN 'football' THEN 0.0030 WHEN 'afl' THEN 0.048 ELSE 0.0 END AS home_scores,
         random() < (:tick / 15.0) * CASE l.sport WHEN 'baseball' THEN 0.0066 WHEN 'american-football' THEN 0.0053
                                 WHEN 'football' THEN 0.0030 WHEN 'afl' THEN 0.048 ELSE 0.0 END AS away_scores,
         CASE l.sport WHEN 'american-football' THEN (ARRAY[3,7,7,6])[1 + floor(random()*4)::int]
                      WHEN 'afl' THEN (ARRAY[1,6,6])[1 + floor(random()*3)::int] ELSE 1 END AS pts
  FROM live l
)
UPDATE games g SET
  home_team_score = g.home_team_score + CASE WHEN r.home_scores THEN r.pts ELSE 0 END,
  away_team_score = g.away_team_score + CASE WHEN r.away_scores THEN r.pts ELSE 0 END,
  status_short = CASE r.sport
    WHEN 'baseball' THEN (CASE WHEN (floor(r.mins/10)::int % 2) = 0 THEN 'T' ELSE 'B' END) || least(9, 1 + floor(r.mins/20))::text
    WHEN 'american-football' THEN 'Q' || least(4, 1 + floor(r.mins/45))::text || ' '
         || lpad((14 - (floor(r.mins)::int % 15))::text, 2, '0') || ':' || lpad((59 - (floor(r.mins*7)::int % 60))::text, 2, '0')
    WHEN 'football' THEN least(90, floor(r.mins * 0.85))::int::text || ''''
    WHEN 'formula-1' THEN 'L' || least(57, 1 + floor(r.mins/1.8))::text
    WHEN 'mma' THEN 'R' || least(5, 1 + floor(r.mins/5))::text
    WHEN 'afl' THEN 'Q' || least(4, 1 + floor(r.mins/30))::text
    ELSE 'LIVE' END,
  updated_at = now()
FROM roll r WHERE g.id = r.id;

-- 3. Full time: past the sport's length, the game is a result.
UPDATE games SET
  state = 'final', status_short = 'FT', short_detail = 'Final', status_long = 'Match Finished',
  updated_at = now()
WHERE state = 'in' AND now() - start_time > CASE sport
  WHEN 'baseball' THEN interval '170 minutes'
  WHEN 'american-football' THEN interval '190 minutes'
  WHEN 'football' THEN interval '110 minutes'
  WHEN 'formula-1' THEN interval '105 minutes'
  WHEN 'mma' THEN interval '25 minutes'
  WHEN 'afl' THEN interval '130 minutes'
  ELSE interval '120 minutes' END;

-- 4. Prices drift: a random walk of up to +/-0.4% per tick; the sparkline
--    keeps the last 30 points; the day range widens to hold the new price.
WITH moved AS (
  SELECT id, round((price * (1 + (random() - 0.5) * 0.008))::numeric, 4) AS np
  FROM trades WHERE price > 0
)
UPDATE trades t SET
  price = m.np,
  price_change = round((m.np - COALESCE(t.previous_close, m.np))::numeric, 4),
  percentage_change = CASE WHEN COALESCE(t.previous_close, 0) > 0
    THEN round(((m.np - t.previous_close) / t.previous_close * 100)::numeric, 4) ELSE 0 END,
  direction = CASE WHEN m.np >= COALESCE(t.previous_close, m.np) THEN 'up' ELSE 'down' END,
  day_high = greatest(COALESCE(t.day_high, m.np), m.np),
  day_low = least(COALESCE(t.day_low, m.np), m.np),
  sparkline = (
    SELECT COALESCE(jsonb_agg(v ORDER BY i), '[]'::jsonb) FROM (
      SELECT v, i FROM jsonb_array_elements(COALESCE(t.sparkline, '[]'::jsonb)) WITH ORDINALITY AS e(v, i)
      ORDER BY i DESC LIMIT 29
    ) tail
  ) || to_jsonb(m.np),
  last_updated = now()
FROM moved m WHERE t.id = m.id;

-- 5. Odds drift a point or two, and remember where they were.
UPDATE markets SET
  prev_yes_price = yes_price,
  yes_price = greatest(0, least(100, yes_price + (floor(random()*5)::int - 2)))
WHERE status = 'active' AND random() < 0.3;
SQL
)

drop_caches() {
  # Core caches every widget read for 10-30s. Drop them so the next poll is
  # the truth; scoped, so SSE subscriber sets and the like are untouched.
  local keys
  keys="$(redis_in --scan --pattern 'cache:*' 2>/dev/null | tr '\n' ' ')"
  # shellcheck disable=SC2086
  [ -n "$keys" ] && redis_in DEL $keys >/dev/null 2>&1 || true
  keys="$(redis_in --scan --pattern 'dashboard:*' 2>/dev/null | tr '\n' ' ')"
  # shellcheck disable=SC2086
  [ -n "$keys" ] && redis_in DEL $keys >/dev/null 2>&1 || true
}

tick() {
  printf '%s' "$TICK_SQL" | psql_in -q -v "tick=$TICK"
  drop_caches
}

status() {
  psql_in -At -F'|' -c "
    SELECT count(*) FILTER (WHERE state='in'),
           count(*) FILTER (WHERE state='pre' AND start_time <= now() + interval '24 hours'),
           count(*) FILTER (WHERE state='final' AND start_time >= now() - interval '18 hours')
    FROM games" | awk -F'|' '{printf "live %s · next 24h %s · finals 18h %s", $1, $2, $3}'
}

# The snapshot's timestamps sit wherever the last `make seed` put them; if
# that was days ago, nothing is due to kick off for days. Anchor first.
bash scripts/dev/seed.sh rebase

# Backdate a handful of the soonest fixtures so the first tick has something
# live to show, rather than making the user wait for the next real kickoff.
# Spread over the last 25 minutes so the clocks differ.
psql_in -q -c "
  WITH soon AS (
    SELECT id FROM games WHERE state = 'pre' AND start_time > now()
    ORDER BY start_time LIMIT 6
  )
  UPDATE games g SET start_time = now() - (random() * interval '25 minutes') - interval '1 minute'
  FROM soon WHERE g.id = soon.id;"

# Keep the day ahead populated. Each start eats the nearest fixtures, and the
# snapshot's schedule has gaps, so after a few starts nothing is due for a
# day and the bar is live games and finals only. If fewer than ten fixtures
# fall in the next 24h, pull the next twenty forward and spread them over
# the coming six hours -- they still kick off in order, just sooner.
psql_in -q -c "
  WITH due AS (
    SELECT count(*) AS n FROM games WHERE state = 'pre' AND start_time BETWEEN now() AND now() + interval '24 hours'
  ), next AS (
    SELECT id, row_number() OVER (ORDER BY start_time) AS k
    FROM games WHERE state = 'pre' AND start_time > now() + interval '24 hours'
    ORDER BY start_time LIMIT 20
  )
  UPDATE games g SET start_time = now() + (next.k * interval '18 minutes')
  FROM next, due WHERE g.id = next.id AND due.n < 10;"

tick
echo "[live] $(status)"
[ "$ONCE" = 1 ] && exit 0

echo "[live] ticking every ${TICK}s — Ctrl-C to stop. No upstream requests are being made."
while sleep "$TICK"; do
  tick
  printf '\r[live] %s   %s' "$(date +%H:%M:%S)" "$(status)"
done
