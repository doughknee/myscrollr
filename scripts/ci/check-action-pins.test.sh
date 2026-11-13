#!/usr/bin/env bash
# Fixture test for check-action-pins.sh.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sha=0123456789abcdef0123456789abcdef01234567
fails=0
run() { # name want-rc yaml-line
    printf 'jobs:\n  j:\n    steps:\n      %s\n' "$3" >"$tmp/w.yml"
    bash "$here/check-action-pins.sh" "$tmp" >/dev/null 2>&1; rc=$?
    if [ "$rc" != "$2" ]; then echo "FAIL $1: rc=$rc want $2"; fails=$((fails+1)); else echo "ok   $1"; fi
}
run "pinned with tag comment passes" 0 "- uses: actions/checkout@$sha # v6"
run "local action passes"           0 "- uses: ./.github/actions/x"
run "tag fails"                     1 "- uses: actions/checkout@v6"
run "branch fails"                  1 "- uses: dtolnay/rust-toolchain@stable"
run "short sha fails"               1 "- uses: actions/checkout@0123456"
run "CRLF pinned passes"            0 "- uses: actions/checkout@$sha # v6"$'\r'
exit $((fails > 0))
