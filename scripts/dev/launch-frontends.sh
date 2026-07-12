#!/usr/bin/env bash
# Open the two native front-ends, each in its own terminal window so you can
# watch their logs: the marketing site (Vite :3000) and the Tauri desktop app.
# Best-effort — if spawning a window fails, just run `make web` / `make desktop`
# in two terminals yourself.
set -uo pipefail

# Windows-style absolute repo root (this script lives in scripts/dev/).
ROOT_WIN="$(cd "$(dirname "$0")/../.." && pwd -W 2>/dev/null || pwd)"
ROOT_WIN="${ROOT_WIN//\//\\}"

spawn() { # $1 = window title, $2 = subdir, $3 = npm command
  powershell.exe -NoProfile -Command \
    "Start-Process cmd.exe -ArgumentList '/k','title $1 && cd /d \"$ROOT_WIN\\$2\" && $3'" \
    >/dev/null 2>&1 \
    && echo "  launched $1 ($2: $3)" \
    || echo "  could not spawn $1 — run it manually: (cd $2 && $3)"
}

echo "[dev] launching front-ends in separate windows..."
spawn "Scrollr Web" "myscrollr.com" "npm run dev"
spawn "Scrollr Desktop" "desktop" "npm run tauri:dev"
echo "[dev] Close those windows (or Ctrl+C in them) to stop the front-ends; 'make down' stops the backend."
