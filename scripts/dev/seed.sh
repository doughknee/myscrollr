#!/usr/bin/env bash
#
# `make seed` / `make seed-capture` — the local dev dataset.
#
# Local dev runs with every upstream API key blank (see scripts/dev/setup.mjs).
# The ingesters handle that correctly: they stay up and serve whatever is in
# Postgres. But a fresh clone's Postgres is EMPTY, so the honest reward for
# `make up` was a blank app, and the only way to see a working one was to paste
# a production key — spending the same api-sports and TwelveData quota that live
# users depend on.
#
# This loads a committed snapshot instead. Zero upstream requests, ever.
#
#   seed.sh load                    restore scripts/dev/seed.sql.gz locally
#   seed.sh capture                 re-record it from $SOURCE_DATABASE_URL
#   seed.sh capture --from-cluster  re-record it from PRODUCTION
#
# Capture is a rare maintenance operation; `load` is what everyone runs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_FILE="${SEED_FILE:-$ROOT/scripts/dev/seed.sql.gz}"
COMPOSE=(docker compose -f "$ROOT/docker/compose.yml")
[ -f "$ROOT/docker/compose.override.yml" ] && COMPOSE+=(-f "$ROOT/docker/compose.override.yml")

# The local stack's own database. Capture defaults to this too, so the common
# case (run once with real keys, snapshot the result) needs no arguments.
LOCAL_DB="postgres://scrollr:scrollr@localhost:5432/scrollr?sslmode=disable"

# psql runs inside the postgres container — no host Postgres client required,
# which is the whole point of the containerized stack. A remote
# SOURCE_DATABASE_URL is resolved from inside that container: use
# host.docker.internal for a `kubectl port-forward` on the host.
psql_in() {
  local url="$1"; shift
  "${COMPOSE[@]}" exec -T postgres psql "$url" -v ON_ERROR_STOP=1 "$@"
}

redis_in() {
  "${COMPOSE[@]}" exec -T redis redis-cli "$@"
}

# -- Reading from production -----------------------------------------
# `--from-cluster` exists because production's database cannot be reached
# from a laptop at all: DATABASE_URL points at DigitalOcean's PRIVATE
# endpoint (private-*.db.ondigitalocean.com:25060), which resolves only
# inside the VPC. There is no port-forward to set up -- kubectl forwards to
# pods, and a managed database is not one.
#
# So the psql that reads production runs INSIDE the cluster, in a throwaway
# pod, and its stdout is streamed back. The credential never leaves the
# cluster: the pod takes DATABASE_URL from the existing scrollr-secrets
# secret BY REFERENCE, so it appears in no command line, no shell history
# and no pod spec.
#
# This is a READ, and the table allowlist below is the entire scrub -- it
# names content tables only, and every table holding user data is excluded
# by not being on it.
K8S_NS="${K8S_NAMESPACE:-scrollr}"
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:17-alpine}"
CAPTURE_POD="seed-capture-$$"
FROM_CLUSTER=""

cluster_pod_start() {
  echo "[seed] starting $CAPTURE_POD in namespace $K8S_NS" >&2
  local spec
  spec=$(cat <<JSON
{"spec":{"containers":[{"name":"$CAPTURE_POD","image":"$PG_CLIENT_IMAGE",
"command":["sleep","1800"],
"env":[{"name":"PGURL","valueFrom":{"secretKeyRef":{"name":"scrollr-secrets","key":"DATABASE_URL"}}}]}]}}
JSON
)
  kubectl run "$CAPTURE_POD" -n "$K8S_NS" --restart=Never \
    --image="$PG_CLIENT_IMAGE" --overrides="$spec" >/dev/null
  # Deleted even if capture dies part-way. --wait=false so a slow teardown
  # does not hold up the shell.
  trap 'kubectl delete pod "$CAPTURE_POD" -n "$K8S_NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true; rm -f "${TMP_SEED:-}"' EXIT
  kubectl wait --for=condition=Ready "pod/$CAPTURE_POD" -n "$K8S_NS" --timeout=180s >/dev/null
}

# psql against whichever source capture was pointed at. No TTY is requested,
# so COPY output comes back byte-for-byte rather than line-ending-translated.
src_psql() {
  if [ -n "$FROM_CLUSTER" ]; then
    # Single quotes are the point: $PGURL and "$@" must expand inside the
    # POD, from the secret-injected env, not out here where the value does
    # not exist and must never be materialised.
    # shellcheck disable=SC2016
    kubectl exec "$CAPTURE_POD" -n "$K8S_NS" -- \
      sh -c 'exec psql "$PGURL" -v ON_ERROR_STOP=1 "$@"' _ "$@"
  else
    psql_in "${SOURCE_DATABASE_URL:-$LOCAL_DB}" "$@"
  fi
}

# ── The dataset ──────────────────────────────────────────────────────
# table|WHERE/LIMIT clause. These ten tables are ALL content, no user data —
# the allowlist is the entire scrub. Everything with user data in it
# (yahoo_*, user_*, stripe_*, support_*, business_leads, osticket_*) is
# excluded by not being here.
#
# Order matters on load: rss_items has an FK onto tracked_feeds(url).
TABLES='
tracked_symbols|
tracked_leagues|
tracked_markets|
tracked_feeds|WHERE is_default = true
trades|
games|
standings|
teams|
markets|ORDER BY close_time DESC NULLS LAST LIMIT 500
rss_items|WHERE feed_url IN (SELECT url FROM tracked_feeds WHERE is_default = true) ORDER BY published_at DESC NULLS LAST LIMIT 500
'

# Read into an array once, up front. A `while read` loop fed by a pipe or
# here-string silently stops after ONE iteration here, because the body calls
# `docker compose exec`, which inherits stdin and drains it. That failure looks
# like a successful capture holding a single table.
SPECS=()
while IFS= read -r line; do
  [ -n "$line" ] && SPECS+=("$line")
done <<< "$TABLES"

table_names() { printf '%s
' "${SPECS[@]}" | cut -d'|' -f1; }

# ── capture ──────────────────────────────────────────────────────────
capture() {
  local src
  if [ -n "$FROM_CLUSTER" ]; then
    src="production (via $K8S_NS/$CAPTURE_POD)"
  else
    src="${SOURCE_DATABASE_URL:-$LOCAL_DB}"
  fi
  # File-scope, not `local`: the EXIT trap runs after this function has
  # returned, where a local would already be out of scope and `set -u` would
  # turn cleanup itself into an error.
  TMP_SEED="$(mktemp)"
  trap 'rm -f "${TMP_SEED:-}"' EXIT
  local tmp="$TMP_SEED"

  echo "[seed] capturing from ${src%%\?*}"
  [ -n "$FROM_CLUSTER" ] && cluster_pod_start

  {
    echo "-- Generated by scripts/dev/seed.sh capture on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "-- Content tables only — no user data. Do not edit by hand; re-run capture."
    echo "BEGIN;"
    # One TRUNCATE for all ten: rss_items -> tracked_feeds is an FK, and
    # naming both in the same statement is what makes that legal without
    # CASCADE (which would reach into user tables).
    echo "TRUNCATE $(table_names | paste -sd, -) RESTART IDENTITY;"
  } > "$tmp"

  local spec table clause
  for spec in "${SPECS[@]}"; do
    table="${spec%%|*}"; clause="${spec#*|}"
    # Explicit column list, resolved at capture time and written into the
    # COPY header. That makes the file self-describing: a column ADDED later
    # still loads (it takes its default), and a column DROPPED fails loudly
    # on load instead of silently shifting every value one place left.
    local cols
    cols="$(src_psql -At -c \
      "SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '$table'")"
    if [ -z "$cols" ]; then
      echo "[seed] ERROR: table '$table' does not exist in the source database" >&2
      exit 1
    fi

    echo "COPY $table ($cols) FROM stdin;" >> "$tmp"
    src_psql -At -c "COPY (SELECT $cols FROM $table $clause) TO STDOUT" >> "$tmp"
    echo '\.' >> "$tmp"

    # Wrapped in a subquery: the clause may be an ORDER BY/LIMIT, which
    # Postgres rejects directly against a bare count(*).
    local n; n="$(src_psql -At -c "SELECT count(*) FROM (SELECT 1 FROM $table $clause) q")"
    printf '  %-18s %s rows\n' "$table" "$n"
  done

  echo "COMMIT;" >> "$tmp"
  gzip -9 -c "$tmp" > "$SEED_FILE"
  echo "[seed] wrote $SEED_FILE ($(du -h "$SEED_FILE" | cut -f1))"
  echo "[seed] commit it — that file IS the dev dataset."
}

# ── load ─────────────────────────────────────────────────────────────
# Restoring rows is only half the job. Several read paths and one background
# job are time-relative, so a snapshot restored months later is present in the
# database and invisible (or self-deleting) in the app. Each shift below is
# tied to the specific query that demands it — verified by reading them, not
# assumed:
#
#   rss_items     the RSS ingester DELETEs published_at < now() - 7 days
#                 (channels/rss/service/src/database.rs:303). Unshifted seed
#                 articles are purged on its first cycle.
#   tracked_feeds the catalog hides feeds unless last_success_at is NULL or
#                 under 7 days old (api/internal/ingestread/rss.go:158), and
#                 the janitor DISABLES feeds that are NULL and created over
#                 7 days ago (rss.go:727). NULL + fresh created_at satisfies
#                 both: visible, and never auto-disabled. is_enabled is forced
#                 back on for the same reason — whichever machine the snapshot
#                 was captured on had almost certainly let the janitor run and
#                 switch the curated feeds off, and capturing that state ships
#                 a dataset whose RSS catalog is silently empty.
#   markets       predictions only returns close_time > now()
#                 (api/internal/ingestread/predictions.go:89).
#   games         no filter — purely cosmetic, so that 'pre' games are still
#                 in the future and the ticker looks like a real day.
#
# trades, standings, teams and the tracked_* config tables carry no
# time-relative read, so they are restored as-is.
REBASE_SQL="
-- ONE delta for everything, taken from the freshest WRITE in the snapshot.
--
-- The first version of this anchored each table on the max of the column it
-- was shifting -- for games, max(start_time). That is the wrong end of the
-- data. A snapshot contains fixtures scheduled far beyond \"now\": the F1
-- calendar runs months ahead, so pinning the LAST race to now+3h dragged every
-- other league backwards with it and landed the entire MLB and MLS schedule in
-- May, four months in the past. Zero games fell inside the +/-7 day window the
-- widgets filter on, so a correctly working app rendered nothing.
--
-- max(updated_at) is when the ingester last wrote a row, which approximates
-- the moment of capture. Shifting everything by (now - that) preserves each
-- record's true relationship to \"now\": a game that was two days out when the
-- snapshot was taken is two days out today, and a fixture scheduled months
-- ahead stays months ahead.
--
-- updated_at itself is deliberately NOT shifted, so the anchor stays stable
-- across the statements below. Nothing reads it for staleness -- the ingesters
-- track freshness in memory, and the RSS janitor uses tracked_feeds, handled
-- separately below.
-- Every id sequence is left behind by the load itself. The file opens with
-- TRUNCATE ... RESTART IDENTITY, which resets each sequence to 1, and then
-- COPYs rows carrying EXPLICIT ids -- and COPY does not advance a sequence.
-- So after a seed the data runs to (say) id 418088 while the sequence still
-- hands out 1, and the next INSERT that relies on it collides on the primary
-- key. That breaks the RSS ingester (the one service that polls with no API
-- key) and any test that inserts a fixture row. Catch every seeded table up.
DO \$\$
DECLARE t text; seq text; mx bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tracked_symbols','tracked_leagues','tracked_markets','tracked_feeds',
    'trades','games','standings','teams','markets','rss_items'
  ] LOOP
    -- Check the column exists FIRST. pg_get_serial_sequence RAISES on a
    -- missing column rather than returning NULL, and one raise aborts the
    -- whole DO block -- which silently left the tables listed after
    -- tracked_feeds (games, trades, rss_items) still broken.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'id'
    ) THEN
      seq := pg_get_serial_sequence(t, 'id');
      IF seq IS NOT NULL THEN
        EXECUTE format('SELECT COALESCE(max(id), 0) FROM %I', t) INTO mx;
        PERFORM setval(seq, GREATEST(mx, 1));
      END IF;
    END IF;
  END LOOP;
END
\$\$;

UPDATE games SET start_time = start_time + (now() - (SELECT max(updated_at) FROM games))
  WHERE start_time IS NOT NULL
    AND (SELECT max(updated_at) FROM games) IS NOT NULL;

UPDATE rss_items SET published_at = published_at + (now() - (SELECT max(updated_at) FROM games))
  WHERE published_at IS NOT NULL
    AND (SELECT max(updated_at) FROM games) IS NOT NULL;

UPDATE markets SET close_time = close_time + (now() - (SELECT max(updated_at) FROM games))
  WHERE close_time IS NOT NULL
    AND (SELECT max(updated_at) FROM games) IS NOT NULL;

-- Runs LAST on purpose: the shifts above anchor on
-- (SELECT max(updated_at) FROM games), so removing rows before they
-- have all run could move the anchor out from under them.
-- Drop games still marked 'pre' after the shift whose start time has passed.
--
-- A snapshot catches whatever was mid-flight, and 'pre' with a past start
-- time is never a real state -- it is a game that finished without anyone
-- fetching the result. poll_schedule only looks today..+7, so once a
-- fixture falls out of that window nothing ever re-reads it to mark it
-- final; it sits as \"upcoming\" until cleanup_old_games deletes it at 7
-- days. The ticker sorts pre games by start_time ASC, so these sort to the
-- FRONT of upcoming and a finished game presents as the next one to watch.
--
-- The August 2026 snapshot carried 63 of them, including two Formula 1
-- races four months stale -- the permanent-loop bug fixed in REL-152. The
-- parser no longer creates those, but the committed dataset predates the
-- fix, and any future capture can still catch the transient kind. Cheaper
-- to normalise on load than to depend on when the snapshot was taken.
--
-- 12 hours, matching parse_f1_race's guard, so a fixture that kicked off
-- an hour ago and has not been polled to 'in' yet is left alone.
DELETE FROM games WHERE state = 'pre' AND start_time < now() - interval '12 hours';

UPDATE tracked_feeds SET last_success_at = NULL,
                         created_at = now(),
                         consecutive_failures = 0,
                         last_error = NULL,
                         last_error_at = NULL,
                         is_enabled = true;
"


# -- Content checks ---------------------------------------------------
# Row counts prove the FILE loaded. They do not prove it still describes
# the app. A snapshot taken before a feature existed loads perfectly
# cleanly -- the COPY header names only the columns that existed at
# capture time, and every column added since quietly takes its default --
# and the feature then looks broken in the UI with nothing anywhere
# saying why.
#
# That is not hypothetical. The August 2026 snapshot predated the trade
# chip's sparkline and day-range columns, so `make seed` silently wiped
# them and the chips rendered flat for three weeks before anyone worked
# out that seeding was the cause.
#
# So: name the columns a widget cannot render without, and say so at load.
#
# Format: table|column|what breaks without it
CONTENT_CHECKS='
trades|price|every finance chip
trades|sparkline|the trade chip sparkline
trades|day_low|the trade chip day-range rail
trades|day_high|the trade chip day-range rail
games|start_time|every sports surface
games|state|the ticker live/upcoming/final split
rss_items|published_at|headline ordering and the freshness pill
markets|close_time|prediction chip countdowns
'

# Columns known to be empty because the feature that fills them has not
# reached production yet, so no capture can contain them. Each entry is a
# promise to delete this line when that ships.
#
# Empty right now: the one known gap, trades.sparkline/day_low/day_high,
# is filled by backfill_derived above rather than excused here, so these
# checks genuinely assert that a trade chip can render.
CONTENT_EXPECTED_EMPTY=''

check_content() {
  local spec table column breaks total filled stale=0 expected=0
  echo "[seed] checking content"
  # Read the list into an array FIRST. Iterating with `while read` fed by a
  # here-string silently stops after ONE pass, because the body calls
  # psql_in -> `docker compose exec`, which inherits stdin and drains it.
  # Same trap as SPECS above, and it fails the same quiet way: every check
  # after the first simply never runs and the guard reports all-clear.
  local rows=()
  while IFS= read -r spec; do
    [ -n "$spec" ] && rows+=("$spec")
  done <<< "$CONTENT_CHECKS"

  for spec in "${rows[@]}"; do
    table="${spec%%|*}"; spec="${spec#*|}"
    column="${spec%%|*}"; breaks="${spec#*|}"

    # A column absent from the LOCAL schema is a different problem -- the
    # migration chain, not the snapshot -- and migrate-on-boot owns it.
    if [ "$(psql_in "$LOCAL_DB" -At -c "SELECT count(*) FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = '$table'
               AND column_name = '$column'")" = "0" ]; then
      continue
    fi

    total="$(psql_in "$LOCAL_DB" -At -c "SELECT count(*) FROM $table")"
    [ "$total" = "0" ] && continue
    filled="$(psql_in "$LOCAL_DB" -At -c "SELECT count($column) FROM $table")"
    [ "$filled" != "0" ] && continue

    case " $CONTENT_EXPECTED_EMPTY " in
      *" $table.$column "*)
        printf "  known gap  %-22s %s (feature not in production yet)\n" "$table.$column" "$breaks"
        expected=$((expected + 1))
        continue ;;
    esac
    printf "  EMPTY      %-22s breaks %s\n" "$table.$column" "$breaks"
    stale=$((stale + 1))
  done

  if [ "$stale" -gt 0 ]; then
    echo "" >&2
    echo "[seed] $stale column(s) loaded empty. The snapshot is older than the" >&2
    echo "       code -- re-record it:  make seed-capture-prod" >&2
    echo "       To seed anyway:        SEED_ALLOW_STALE=1 make seed" >&2
    [ -n "${SEED_ALLOW_STALE:-}" ] || exit 1
  fi
  [ "$expected" -gt 0 ] && echo "  ($expected known gap(s) -- see CONTENT_EXPECTED_EMPTY in seed.sh)"
  return 0
}


# -- Derived columns the snapshot cannot carry -------------------------
# trades.sparkline / day_low / day_high are filled by REL-157, which is
# still on a branch. Production's schema does not have those columns, so
# no capture can contain them and every trade chip on a seeded stack
# renders a flat line and an empty rail -- including in CI, which
# therefore cannot cover that path at all.
#
# This DERIVES them from the two real prices each row already carries,
# previous_close and price. The shape between those endpoints is INVENTED:
# it is a smooth interpolation with a deterministic wiggle, not market
# data, and nobody should read anything into its form. The endpoints and
# the direction are real.
#
# Deterministic (seeded from the symbol, not random) so a reseed produces
# the same chart and a visual diff of the app stays meaningful. The wiggle
# is tapered to zero at both ends by sin(pi*i/29), so point 0 is exactly
# previous_close and point 29 is exactly the current price -- otherwise
# the last point of the sparkline would disagree with the price printed
# next to it.
#
# Guarded on IS NULL, so the day this ships and a real capture carries the
# columns, this stops doing anything. Delete it then.
SYNTH_SQL="
WITH src AS (
  SELECT symbol,
         price,
         COALESCE(NULLIF(previous_close, 0), price) AS base,
         (abs(hashtext(symbol)) % 100)::numeric / 16 AS phase
    FROM trades
   WHERE sparkline IS NULL AND price > 0
), pts AS (
  SELECT src.symbol,
         i,
         -- ::numeric because sin() yields double precision, and the column
         -- (and round/2) are numeric(20,8).
         GREATEST(
           src.base + (src.price - src.base) * (i::numeric / 29)
           + GREATEST(abs(src.price - src.base) * 0.5, src.price * 0.005)
             * (sin(pi() * i / 29) * sin(i * 0.9 + src.phase))::numeric,
           src.price * 0.0001
         )::numeric AS v
    FROM src, generate_series(0, 29) AS i
), agg AS (
  SELECT symbol,
         jsonb_agg(round(v, 8) ORDER BY i) AS series,
         min(v) AS lo,
         max(v) AS hi
    FROM pts
   GROUP BY symbol
)
UPDATE trades t
   SET sparkline = agg.series,
       day_low   = round(agg.lo, 8),
       day_high  = round(agg.hi, 8)
  FROM agg
 WHERE t.symbol = agg.symbol;
"

backfill_derived() {
  # Nothing to do once the columns exist upstream and arrive populated.
  if [ "$(psql_in "$LOCAL_DB" -At -c "SELECT count(*) FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'trades'
             AND column_name = 'sparkline'")" = "0" ]; then
    return 0
  fi
  local n
  n="$(psql_in "$LOCAL_DB" -At -c "SELECT count(*) FROM trades WHERE sparkline IS NULL AND price > 0")"
  [ "$n" = "0" ] && return 0
  psql_in "$LOCAL_DB" -q -c "$SYNTH_SQL"
  echo "[seed] derived sparkline + day range for $n symbols"
  echo "       (endpoints real: previous_close -> price; the shape between them is not)"
}

load() {
  [ -f "$SEED_FILE" ] || { echo "[seed] no dataset at $SEED_FILE (run: make seed-capture)" >&2; exit 1; }

  if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
    echo "[seed] postgres is not running — start the stack first (make up)." >&2
    exit 1
  fi

  echo "[seed] loading $SEED_FILE"
  # The file is one BEGIN/COMMIT with a TRUNCATE at the top, so a re-seed
  # replaces the dataset rather than duplicating it, and a failure part-way
  # leaves the previous contents intact.
  gzip -dc "$SEED_FILE" | psql_in "$LOCAL_DB" -q

  echo "[seed] rebasing timestamps to now"
  psql_in "$LOCAL_DB" -q -c "$REBASE_SQL"

  # Core caches every widget read in Redis for 10-30s (cache:finance,
  # cache:sports, cache:public:feed, ...). Seeding changes the data those
  # entries describe without touching the entries themselves, so without this
  # the app keeps serving the PRE-seed answer for up to half a minute — long
  # enough for a human to conclude the seed did not work, and long enough to
  # fail a CI step that seeds and asserts back to back.
  #
  # Scoped to cache:* rather than FLUSHALL: Redis also holds SSE subscriber
  # sets and channel registrations that have nothing to do with seeding.
  backfill_derived

  echo "[seed] dropping stale read caches"
  local keys
  keys="$(redis_in --scan --pattern 'cache:*' | tr -d '
')"
  if [ -n "$keys" ]; then
    # Unquoted on purpose: split the key list into one DEL with many
    # arguments. (xargs is not an option here — redis_in is a shell function.)
    # shellcheck disable=SC2086
    redis_in DEL $keys >/dev/null 2>&1 || true
  fi

  echo "[seed] loaded:"
  local spec table
  for spec in "${SPECS[@]}"; do
    table="${spec%%|*}"
    printf '  %-18s %s rows
' "$table" "$(psql_in "$LOCAL_DB" -At -c "SELECT count(*) FROM $table")"
  done

  check_content

  echo "[seed] done — no upstream API requests were made."
}

cmd="${1:-}"; shift || true
for arg in "$@"; do
  case "$arg" in
    --from-cluster) FROM_CLUSTER=1 ;;
    *) echo "[seed] unknown option: $arg" >&2; exit 2 ;;
  esac
done

case "$cmd" in
  load)    load ;;
  capture) capture ;;
  *) echo "usage: seed.sh {load|capture [--from-cluster]}" >&2; exit 2 ;;
esac
