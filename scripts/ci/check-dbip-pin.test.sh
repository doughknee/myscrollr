#!/usr/bin/env bash
# Fixture test for check-dbip-pin.sh. Run: bash scripts/ci/check-dbip-pin.test.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-dbip-pin.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0
expect() { # <name> <pin> <now> <want-exit> <must-contain>
    printf 'FROM scratch\nARG DBIP_COUNTRY_RELEASE=%s\nARG DBIP_COUNTRY_SHA256=abc\n' "$2" > "$T/Dockerfile"
    out=$(DBIP_CHECK_MONTH="$3" bash "$SCRIPT" "$T/Dockerfile" 2>&1); rc=$?
    if [ "$rc" != "$4" ] || ! grep -qF -- "$5" <<<"$out"; then echo "FAIL $1 (rc=$rc)"; echo "$out"; fails=1
    else echo "ok   $1"; fi
}
expect "current month passes" 2026-11 2026-11 0 "DB-IP pin OK"
expect "previous month passes" 2026-10 2026-11 0 "DB-IP pin OK"
expect "two months old fails and says what to do" 2026-09 2026-11 1 "ARG DBIP_COUNTRY_SHA256="
expect "two months old names the file to fetch" 2026-09 2026-11 1 "dbip-country-lite-2026-11.mmdb.gz"
expect "January accepts last December" 2025-12 2026-01 0 "DB-IP pin OK"
expect "January rejects November" 2025-11 2026-01 1 "only 2026-01 or 2025-12"
expect "a pin from the future fails" 2026-12 2026-11 1 "only 2026-11"
printf 'FROM scratch\n' > "$T/Dockerfile"
out=$(DBIP_CHECK_MONTH=2026-11 bash "$SCRIPT" "$T/Dockerfile" 2>&1); rc=$?
if [ "$rc" = 1 ] && grep -qF "no 'ARG DBIP_COUNTRY_RELEASE" <<<"$out"; then echo "ok   missing ARG fails"; else echo "FAIL missing ARG (rc=$rc)"; fails=1; fi
exit "$fails"
