#!/usr/bin/env bash
# Fail when the DB-IP country file pinned in api/Dockerfile is neither this
# UTC month's release nor last month's. db-ip.com removes old months, so a stale
# pin breaks every image build, and the API treats an embedded file older than
# 45 days as unusable. Nothing is fetched from db-ip.com.
#
# Usage: check-dbip-pin.sh [dockerfile]     (default: api/Dockerfile)
# DBIP_CHECK_MONTH=YYYY-MM overrides "now" (the fixture test uses it).
set -euo pipefail

DOCKERFILE="${1:-api/Dockerfile}"
now="${DBIP_CHECK_MONTH:-$(date -u +%Y-%m)}"
pin=$(sed -n 's/^ARG DBIP_COUNTRY_RELEASE=\([^[:space:]]*\).*/\1/p' "$DOCKERFILE" | head -1)

if ! [[ "$pin" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
    echo "::error::$DOCKERFILE has no 'ARG DBIP_COUNTRY_RELEASE=YYYY-MM' line (found '${pin}')"
    exit 1
fi

y=${now%-*}
m=$((10#${now#*-}))
if [ "$m" -eq 1 ]; then prev=$(printf '%04d-12' $((10#$y - 1))); else prev=$(printf '%04d-%02d' "$((10#$y))" $((m - 1))); fi

if [ "$pin" = "$now" ] || [ "$pin" = "$prev" ]; then
    echo "DB-IP pin OK: $pin (current $now, previous $prev)"
    exit 0
fi

echo "::error::The DB-IP country file pinned in $DOCKERFILE is $pin; only $now or $prev are accepted"
cat <<MSG
db-ip.com removes old monthly files, so image builds fail once the pin is two months old.
To fix, in api/Dockerfile:
  1. Download dbip-country-lite-$now.mmdb.gz from
     https://download.db-ip.com/free/dbip-country-lite-$now.mmdb.gz
     (listed on https://db-ip.com/db/download/ip-to-country-lite).
  2. Run: sha256sum dbip-country-lite-$now.mmdb.gz
  3. Update both lines together:
       ARG DBIP_COUNTRY_RELEASE=$now
       ARG DBIP_COUNTRY_SHA256=<the hash from step 2>
  4. Open a pull request (SCROLLR-458 has the history).
MSG
exit 1
