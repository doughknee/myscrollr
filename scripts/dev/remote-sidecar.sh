#!/usr/bin/env bash
# Entry point of the `dev-clock` sidecar in docker/compose.dev-remote.yml.
#
# Seeds an empty database (or one holding an older seed), then hands over to
# live.sh, which keeps the dataset moving. Runs inside a postgres:16-alpine
# container (psql local, no docker), which is what SCROLLR_DEV_DIRECT=1 tells
# seed.sh/live.sh.
#
# Idempotent by construction: a redeploy or restart finds the same seed hash
# and skips the load (seed.sh load TRUNCATEs, so it must never run over moved
# data of an unchanged seed), and live.sh's start-up rebase only shifts by
# "now - freshest games.updated_at" in whole days, which the previous tick
# already stamped.
set -euo pipefail

cd "$(dirname "$0")/../.."
export SCROLLR_DEV_DIRECT=1

# Only seed-owned tables count. rss_items is filled by the keyless rss
# ingester on its own within seconds of boot, so counting it made the very
# first boot skip the seed (found on the first Coolify deploy, SCROLLR-249).
rows="$(psql "$DATABASE_URL" -At -c "SELECT (SELECT count(*) FROM games) + (SELECT count(*) FROM trades)")"

# Reseed when the committed dataset CHANGED (SCROLLR-256), not only when the
# database is empty: the sha256 of scripts/dev/seed.sql.gz is recorded in the
# dev DB after every load, and a redeploy that finds a different one reloads.
# So recapturing the seed and redeploying is the whole reseed procedure -- no
# volume wipe. Reloading is safe here because the data is dev-only content.
psql "$DATABASE_URL" -q -c "CREATE TABLE IF NOT EXISTS dev_seed_meta (k text PRIMARY KEY, v text NOT NULL)"
want="$(sha256sum scripts/dev/seed.sql.gz | cut -d' ' -f1)"
have="$(psql "$DATABASE_URL" -At -c "SELECT v FROM dev_seed_meta WHERE k = 'seed_sha256'")"

if [ "$rows" = "0" ] || [ "$have" != "$want" ]; then
  echo "[dev-clock] seeding (rows=$rows, loaded=${have:-none}, wanted=$want)"
  bash scripts/dev/seed.sh load
  psql "$DATABASE_URL" -q -c "INSERT INTO dev_seed_meta VALUES ('seed_sha256', '$want') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v"
else
  echo "[dev-clock] $rows content rows present, seed unchanged - not re-seeding"
fi

exec bash scripts/dev/live.sh
