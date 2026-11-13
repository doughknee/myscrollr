#!/usr/bin/env bash
# Fixture test for check-old-owner.sh. Run: bash scripts/ci/check-old-owner.test.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-old-owner.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T" && git init -q && mkdir -p api docs desktop/src
fails=0
expect() { # <name> <want-exit>
    out=$(bash "$SCRIPT" "$T" 2>&1); rc=$?
    if [ "$rc" != "$2" ]; then echo "FAIL $1 (rc=$rc)"; echo "$out"; fails=1; else echo "ok   $1"; fi
    git rm -rq --cached . 2>/dev/null; rm -f desktop/src/bad.ts
}
printf 'module github.com/brandon-relentnet/myscrollr/api\n' > api/go.mod
printf 'import "github.com/brandon-relentnet/myscrollr/api/internal/platform"\n' > api/a.go
printf '"resolved": "x/brandon-relentnet/y"\n' > package-lock.json
printf 'old name brandon-relentnet\n' > docs/history.md
git add -A; expect "Go paths, lockfiles and docs pass" 0
printf 'const U = "https://github.com/brandon-relentnet/myscrollr/releases"\n' > desktop/src/bad.ts
git add -A; expect "a runtime URL fails" 1
exit "$fails"
