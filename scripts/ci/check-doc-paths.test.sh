#!/usr/bin/env bash
# Fixture test for check-doc-paths.sh. Run: bash scripts/ci/check-doc-paths.test.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-doc-paths.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T"
mkdir -p .claude/skills/a api docs
touch api/real.go docs/X.md
printf '# A\n\n## Before building anything new\n\nSee `docs/X.md` and `api/real.go`.\n\n## Next\n\n`gone/nothing.go`\n' > AGENTS.md
printf 'Read `api/real.go`, `api/<x>/y.go`, `npm run web`, `/health`.\n' > .claude/skills/a/SKILL.md
echo 'Start at `docs/X.md`.' > CONTRIBUTING.md

fails=0
expect() { # <name> <want-exit> <must-contain>
    out=$(bash "$SCRIPT" 2>&1); rc=$?
    if [ "$rc" != "$2" ] || ! grep -qF -- "$3" <<<"$out"; then echo "FAIL $1 (rc=$rc)"; echo "$out"; fails=1
    else echo "ok   $1"; fi
}
expect "all paths exist (placeholders, commands, URLs and text outside the section ignored)" 0 "Doc paths OK"
echo 'Also `api/moved.go`.' >> .claude/skills/a/SKILL.md
expect "missing path in a skill fails and names it" 1 "api/moved.go"
sed -i '$d' .claude/skills/a/SKILL.md
sed -i 's#See `docs/X.md`#See `docs/Y.md`#' AGENTS.md
expect "missing path in the AGENTS section fails" 1 "docs/Y.md"
exit "$fails"
