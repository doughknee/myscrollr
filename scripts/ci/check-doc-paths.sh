#!/usr/bin/env bash
# Fail when a backticked repo path in the AI contributor docs no longer
# exists: .claude/skills/*/SKILL.md, CONTRIBUTING.md and AGENTS.md's
# "Before building anything new" section. Keeps the recipes honest as code
# moves. Only tokens that look like a plain repo-relative path (contain a
# "/", no spaces, no <placeholders>, no globs, not starting with "/") count.
#
# Usage: check-doc-paths.sh [repo-root]     (default: current directory)
set -uo pipefail
cd "${1:-.}"

paths_in() { grep -o '`[^`]*`' | tr -d '`' | grep -E '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/?$' | grep / || true; }

fail=0; seen=0
while IFS=$'	' read -r label p; do
    seen=$((seen+1))
    if [ ! -e "${p%/}" ]; then
        echo "::error::$label names \`$p\`, which does not exist"
        fail=1
    fi
done < <(
    for f in .claude/skills/*/SKILL.md CONTRIBUTING.md; do
        [ -f "$f" ] && paths_in < "$f" | sed "s#^#$f	#"
    done
    awk '/^## Before building anything new/{on=1;next} /^## /{on=0} on' AGENTS.md | paths_in | sed "s#^#AGENTS.md (Before building anything new)	#"
)

[ "$seen" -gt 0 ] || { echo "::error::no paths found to check; is the doc layout broken?"; exit 1; }
[ "$fail" = 0 ] && echo "Doc paths OK: $seen named paths all exist."
exit "$fail"
