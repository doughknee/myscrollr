#!/usr/bin/env bash
# Entry point of the `dev-clock` sidecar in docker/compose.dev-remote.yml.
#
# Seeds an EMPTY database once, then hands over to live.sh, which keeps the
# dataset moving. Runs inside a postgres:16-alpine container (psql local, no
# docker), which is what SCROLLR_DEV_DIRECT=1 tells seed.sh/live.sh.
#
# Idempotent by construction: a redeploy or restart finds rows and skips the
# seed (seed.sh load TRUNCATEs, so it must never run over moved data), and
# live.sh's start-up rebase only shifts by "now - freshest games.updated_at",
# which the previous tick already stamped.
set -euo pipefail

cd "$(dirname "$0")/../.."
export SCROLLR_DEV_DIRECT=1

# Only seed-owned tables count. rss_items is filled by the keyless rss
# ingester on its own within seconds of boot, so counting it made the very
# first boot skip the seed (found on the first Coolify deploy, SCROLLR-249).
rows="$(psql "$DATABASE_URL" -At -c "SELECT (SELECT count(*) FROM games) + (SELECT count(*) FROM trades)")"
if [ "$rows" = "0" ]; then
  echo "[dev-clock] empty database - seeding"
  bash scripts/dev/seed.sh load
else
  echo "[dev-clock] $rows content rows present - not re-seeding"
fi

exec bash scripts/dev/live.sh
