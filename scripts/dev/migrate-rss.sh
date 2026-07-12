#!/usr/bin/env bash
# Pre-apply the RSS migrations in DEPENDENCY order.
#
# The version prefixes sort 130000000001 (user_custom_feeds) BEFORE
# 20250601000001 (which creates the tracked_feeds table it references), so on
# a FRESH database sqlx's boot migration — which runs in version order — fails.
# All four files are idempotent (IF NOT EXISTS), so applying them here in the
# correct order, then letting rss-service's boot re-run record them, is a clean
# no-op on an already-migrated DB. See LOCAL_SETUP.md.
set -euo pipefail

COMPOSE="docker compose -f docker-compose.dev.yml"
MIG_DIR="channels/rss/service/migrations"
FILES=(
  20250601000001_initial
  20250601000002_add_failure_tracking
  130000000001_user_custom_feeds
  130000000002_cleanup_dup_user_custom_feeds
)

echo "[rss] applying migrations in dependency order..."
for f in "${FILES[@]}"; do
  $COMPOSE exec -T postgres \
    psql -U scrollr -d scrollr -v ON_ERROR_STOP=1 -q \
    < "$MIG_DIR/$f.up.sql" >/dev/null
  echo "  ok  $f"
done
