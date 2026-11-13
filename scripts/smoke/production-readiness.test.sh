#!/usr/bin/env bash
# Fixture test for check_data_flow in production-readiness.sh: fake kubectl and
# curl serve a canned /public/feed and /events status, no cluster needed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf '#!/bin/sh\nexit 0\n' >"$tmp/kubectl"
cat >"$tmp/curl" <<'S'
#!/bin/bash
for a in "$@"; do last="$a"; done
case "$last" in
    */public/feed) cat "$FEED" ;;
    */events) printf '%s' "$EVENTS_STATUS" ;;
esac
exit 0
S
chmod +x "$tmp/kubectl" "$tmp/curl"
sed -n '/^check_data_flow() {/,/^}/p' "$here/production-readiness.sh" >"$tmp/fn.sh"

feed() { # finance_updated_at rss_rows
    printf '{"data":{"finance":[{"last_updated":"%s"}],"sports":{"sports":[{"id":1}]},"rss":%s}}' "$1" "$2" >"$tmp/feed.json"
}
now="$(date -u +%Y-%m-%dT%H:%M:%S.123456Z)"
old="$(date -u -d '-7 hours' +%Y-%m-%dT%H:%M:%S.123456Z)"

fails=0
expect() { # name want-rc events_status
    local out rc=0
    out="$(PATH="$tmp:$PATH" NAMESPACE=x PORT_FORWARD_TIMEOUT=5 FEED="$tmp/feed.json" EVENTS_STATUS="$3" \
        bash -c ". '$tmp/fn.sh'; check_data_flow")" || rc=$?
    if [[ "$rc" != "$2" ]]; then
        echo "FAIL $1: rc=$rc want $2 ($out)"
        fails=$((fails + 1))
    else
        echo "ok   $1 ($out)"
    fi
}

feed "$now" '[{"id":1}]';  expect "fresh feed passes" 0 401
feed "$old" '[{"id":1}]';  expect "7 h old finance fails" 1 401
feed "$now" '[]';          expect "empty rss fails" 1 401
feed "$now" '[{"id":1}]';  expect "/events 500 fails" 1 500
exit $((fails > 0))
