#!/usr/bin/env bash
# Fail when a change adds a new top-level folder, or a new package.json /
# go.mod / Cargo.toml anywhere, without naming it in AGENTS.md's
# "Repository Layout" section. Scrollr is one product with several hosts;
# a new app should be an adapter on what exists (see "Before building
# anything new" in AGENTS.md). Existing folders are grandfathered: only paths
# ADDED relative to the base count.
#
# Usage: check-repo-shape.sh [base-ref]     (default: origin/main)
set -euo pipefail

BASE="${1:-origin/main}"
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "base ref '$BASE' not found" >&2; exit 2; }

# The Repository Layout section: from its heading to the next "## " heading.
layout=$(awk '/^## Repository Layout/{on=1;next} /^## /{on=0} on' AGENTS.md)

added=$(git diff --name-only --diff-filter=A "$BASE"...HEAD)
base_top=$(git ls-tree --name-only "$BASE")
fail=0

report() { # <what> <path-to-name-in-AGENTS.md>
    echo "::error::$1 is not named in AGENTS.md > Repository Layout"
    echo "  Added: $1"
    echo "  Scrollr is one product with several hosts. Extend what exists (a new host adapter, widget, ingestread source or route) instead of starting a new app."
    echo "  Read 'Before building anything new' in AGENTS.md. If this really is new, add \`$2\` to Repository Layout in this PR."
    fail=1
}

# New top-level directories (a top-level name the base did not have).
while IFS= read -r top; do
    [ -n "$top" ] || continue
    grep -qxF "$top" <<<"$base_top" && continue
    grep -qF "$top/" <<<"$layout" || report "top-level folder $top/" "$top/"
done < <(grep / <<<"$added" | cut -d/ -f1 | sort -u)

# New manifests anywhere. Generated trees are never source.
while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "/$f" in */node_modules/*|*/dist/*|*/dist-embed/*|*/target/*|*/vendor/*|*/.git/*) continue ;; esac
    dir=$(dirname "$f"); [ "$dir" = . ] && name="$f" || name="$dir/"
    # A new top-level folder already reported above; don't say it twice.
    [ "$dir" != . ] && ! grep -qxF "${f%%/*}" <<<"$base_top" && continue
    grep -qF "$name" <<<"$layout" || report "$f" "$name"
done < <(grep -E '(^|/)(package\.json|go\.mod|Cargo\.toml)$' <<<"$added" || true)

[ "$fail" = 0 ] && echo "Repo shape OK: no undocumented new apps or top-level folders."
exit "$fail"
