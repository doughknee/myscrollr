#!/usr/bin/env bash
# Pull the Kalshi credentials from the DO cluster secret `scrollr-secrets`
# into the Docker secret files under secrets/. Use this if you don't have a
# channels/predictions/.env locally. Secret VALUES are piped straight to
# files and never printed. Needs kubectl + cluster access.
set -euo pipefail

KUBECTL="${KUBECTL:-$LOCALAPPDATA/kubectl/kubectl.exe}"
if [ ! -x "$KUBECTL" ] && ! command -v "$KUBECTL" >/dev/null 2>&1; then
  echo "kubectl not found at '$KUBECTL' — set KUBECTL=/path/to/kubectl and retry." >&2
  exit 1
fi

get() { "$KUBECTL" -n scrollr get secret scrollr-secrets -o "jsonpath={.data.$1}" | base64 -d; }

mkdir -p secrets
echo "[kalshi-key] pulling from scrollr-secrets..."

get KALSHI_PRIVATE_KEY > secrets/kalshi-private-key.pem
KID="$(get KALSHI_API_KEY_ID)"
KENV="$(get KALSHI_ENV 2>/dev/null || true)"; [ -n "$KENV" ] || KENV="prod"
{
  echo "# Pulled from scrollr-secrets by make kalshi-key — do not edit."
  echo "KALSHI_API_KEY_ID=$KID"
  echo "KALSHI_ENV=$KENV"
} > secrets/predictions.docker.env

chmod 600 secrets/kalshi-private-key.pem secrets/predictions.docker.env 2>/dev/null || true
echo "[kalshi-key] wrote secrets/kalshi-private-key.pem + secrets/predictions.docker.env (values not shown)."
