#!/usr/bin/env bash
# Pull the Kalshi credentials from the DO cluster secret `scrollr-secrets`
# into the Docker secret files under secrets/. Secret VALUES are piped
# straight to files and never printed. Needs kubectl + cluster access.
#
# WHAT THIS ACTUALLY COPIES: the credential in `scrollr-secrets` is the
# PRODUCTION, REAL-MONEY Kalshi key. This script used to run unprompted and
# default KALSHI_ENV to "prod", so `make kalshi-key` silently pointed a
# developer laptop at a live trading account. It now refuses unless you say
# --prod and mean it.
#
# Predictions is optional. Nothing else in the stack needs it, and
# `make seed` gives you a populated app without any upstream credential at
# all — reach for that first.
set -euo pipefail

PROD=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    *) echo "usage: pull-kalshi-key.sh [--prod]" >&2; exit 2 ;;
  esac
done

if [ "$PROD" -ne 1 ]; then
  cat >&2 <<'MSG'
[kalshi-key] refusing to copy a production credential without --prod.

  `scrollr-secrets` holds the LIVE, REAL-MONEY Kalshi key. Copying it here
  puts it in your working tree and points local dev at the production
  trading environment.

  If you only need a working app locally, you do not need this at all:

      make seed          # populated stack, zero upstream credentials

  To use predictions locally, prefer your own Kalshi DEMO credentials —
  write them to secrets/predictions.docker.env and drop the matching PEM at
  secrets/kalshi-private-key.pem:

      KALSHI_API_KEY_ID=<your demo key id>
      KALSHI_ENV=demo

  If you genuinely need the production credential, re-run deliberately:

      scripts/dev/pull-kalshi-key.sh --prod
MSG
  exit 1
fi

echo "[kalshi-key] WARNING: copying the PRODUCTION real-money Kalshi credential." >&2

# Resolution order: an explicit KUBECTL wins; then kubectl on PATH, which
# covers macOS, Linux, and any Windows install that puts it there; then the
# default Windows location, since `winget install kubectl` lands it under
# LOCALAPPDATA without touching PATH. Defaulting to that Windows path
# unconditionally — as this did — made the script unusable everywhere else,
# because LOCALAPPDATA is unset and the path collapsed to
# "/kubectl/kubectl.exe".
if [ -z "${KUBECTL:-}" ]; then
  if command -v kubectl >/dev/null 2>&1; then
    KUBECTL=kubectl
  elif [ -n "${LOCALAPPDATA:-}" ] && [ -x "$LOCALAPPDATA/kubectl/kubectl.exe" ]; then
    KUBECTL="$LOCALAPPDATA/kubectl/kubectl.exe"
  fi
fi
if [ -z "${KUBECTL:-}" ] ||
   { [ ! -x "$KUBECTL" ] && ! command -v "$KUBECTL" >/dev/null 2>&1; }; then
  echo "kubectl not found on PATH — install it, or set KUBECTL=/path/to/kubectl and retry." >&2
  exit 1
fi

get() { "$KUBECTL" -n scrollr get secret scrollr-secrets -o "jsonpath={.data.$1}" | base64 -d; }

mkdir -p secrets
echo "[kalshi-key] pulling from scrollr-secrets..."

get KALSHI_PRIVATE_KEY > secrets/kalshi-private-key.pem
KID="$(get KALSHI_API_KEY_ID)"
# Mirror whatever the cluster says; only fall back to "prod" because that is
# what this credential actually is, and mislabelling it "demo" would be worse
# than saying so plainly.
KENV="$(get KALSHI_ENV 2>/dev/null || true)"; [ -n "$KENV" ] || KENV="prod"
{
  echo "# Pulled from scrollr-secrets by make kalshi-key — do not edit."
  echo "KALSHI_API_KEY_ID=$KID"
  echo "KALSHI_ENV=$KENV"
} > secrets/predictions.docker.env

chmod 600 secrets/kalshi-private-key.pem secrets/predictions.docker.env 2>/dev/null || true
echo "[kalshi-key] wrote secrets/kalshi-private-key.pem + secrets/predictions.docker.env (values not shown)."
echo "[kalshi-key] KALSHI_ENV=$KENV — this is a real account. Both files are gitignored; delete them when you are done." >&2
