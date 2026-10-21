#!/usr/bin/env bash
# Fixture test for check-repo-shape.sh: builds a scratch repo and runs the
# script against it. Run: bash scripts/ci/check-repo-shape.test.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-repo-shape.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T"
git init -q -b main . && git config user.email t@t && git config user.name t
printf '# A\n\n## Repository Layout\n\n- `api/` — core\n\n## Next\n' > AGENTS.md
mkdir api && echo '{}' > api/package.json
git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD

fails=0
expect() { # <name> <want-exit> <must-contain>
    out=$(bash "$SCRIPT" origin/main 2>&1); rc=$?
    if [ "$rc" != "$2" ] || ! grep -qF -- "$3" <<<"$out"; then
        echo "FAIL $1 (rc=$rc)"; echo "$out"; fails=1
    else echo "ok   $1"; fi
}
commit() { git add -Af && git commit -qm "$1"; }

expect "no changes pass" 0 "Repo shape OK"

mkdir -p api/node_modules/x api/dist; echo '{}' > api/node_modules/x/package.json; echo '{}' > api/dist/package.json
commit generated
expect "generated paths ignored" 0 "Repo shape OK"

mkdir tv && echo hi > tv/a.txt
commit tv
expect "new top-level dir fails with message" 1 "Before building anything new"

sed -i 's|^- `api/` — core|&\n- `tv/` — overlay|' AGENTS.md
commit doc
expect "documented dir passes" 0 "Repo shape OK"

mkdir api/tool && echo '{}' > api/tool/package.json
commit manifest
expect "new nested manifest fails" 1 "api/tool/package.json"

sed -i 's|^- `api/` — core|&\n- `api/tool/` — x|' AGENTS.md
commit doc2
expect "documented manifest passes" 0 "Repo shape OK"

exit $fails
