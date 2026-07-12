#!/usr/bin/env bash
# Poll the Core API health endpoint, then wait for it to discover the channel
# services (each Go API registers itself in Redis within ~10s of starting).
set -uo pipefail

CORE="http://localhost:18080"

echo "[wait] Core API health..."
# Core returns 200 when everything's green and 503 when "degraded" (a channel
# is still warming up). Both mean core itself is up and serving — only treat a
# non-response (connection refused / timeout) as not-ready, so a slow channel
# never stalls `make up`.
ok=""
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$CORE/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ] || [ "$code" = "503" ]; then
    ok=1
    echo "  core is up (HTTP $code)"
    [ "$code" = "503" ] && echo "  note: a channel is still warming up — normal on first boot; it goes green shortly."
    break
  fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "  core did not respond in time — check 'make logs svc=core-api'." >&2
  exit 1
fi

echo "[wait] channel discovery (up to ~60s)..."
for _ in $(seq 1 30); do
  line="$(docker logs scrollr-core 2>&1 | grep 'Discovery] Channels updated' | tail -1 || true)"
  if [ -n "$line" ]; then
    echo "  ${line#*INFO }"
    break
  fi
  sleep 2
done

echo ""
echo "[ready] Backend is up. Ports: core 18080 · rss 8083 · finance 8181 · sports 8082 · fantasy 8084 · predictions 8085"
echo "[ready] Front-ends:  make web   (marketing site :3000)   |   make desktop   (Tauri app)"
