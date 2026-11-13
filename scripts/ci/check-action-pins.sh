#!/usr/bin/env bash
# Fail when a `uses:` line under .github/workflows is not pinned to a full
# 40-character commit SHA. A tag or branch can be moved by its owner; a SHA
# cannot. Local actions (./...) are exempt. Put the tag in a trailing comment.
#
# Usage: check-action-pins.sh [workflows-dir]     (default: .github/workflows)
set -uo pipefail
dir="${1:-.github/workflows}"

bad=$(grep -rnE '^[[:space:]]*(-[[:space:]]+)?uses:' "$dir" --include='*.yml' --include='*.yaml' \
    | tr -d '\r' \
    | grep -vE 'uses:[[:space:]]*\./' \
    | grep -vE 'uses:[[:space:]]*[^[:space:]@]+@[0-9a-f]{40}([[:space:]]|$)' || true)

if [ -n "$bad" ]; then
    echo "$bad" | while IFS= read -r l; do echo "::error::not pinned to a commit SHA: $l"; done
    exit 1
fi
echo "Action pins OK."
