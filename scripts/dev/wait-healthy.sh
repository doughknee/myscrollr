#!/usr/bin/env bash
# Poll the Core API health endpoint, then wait for its local ingestion
# sources (finance/sports/rss) to report ready.
set -uo pipefail

CORE="http://localhost:18080"

echo "[wait] Core API health..."
# Core returns 200 when everything's green and 503 when "degraded" (an
# ingester is still warming up). Both mean core itself is up and serving —
# only treat a non-response (connection refused / timeout) as not-ready, so
# a slow ingester never stalls `make up`.
ok=""
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$CORE/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ] || [ "$code" = "503" ]; then
    ok=1
    echo "  core is up (HTTP $code)"
    [ "$code" = "503" ] && echo "  note: an ingester is still warming up — normal on first boot; it goes green shortly."
    break
  fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "  core did not respond in time — check 'make logs svc=core-api'." >&2
  exit 1
fi

echo ""
echo "[ready] Backend is up."
echo "[ready] API:       core 18080 (serves every widget route)"
echo "[ready] Ingesters: finance 3001 · sports 3002 · rss 3004"
echo "[ready] Front-ends:  make web   (marketing site :3000)   |   make desktop   (Tauri app)"
