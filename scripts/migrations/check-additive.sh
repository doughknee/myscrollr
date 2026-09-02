#!/usr/bin/env bash
# Reject destructive schema changes in NEW migrations.
#
# Why this is a hard gate and not a review habit: core-api runs the migration
# chain inside platform.ConnectDB() at startup. A destructive migration is
# therefore applied the instant the new pod boots — BEFORE any smoke test runs
# and before the deploy pipeline could roll the image back. And rolling an
# image back does not roll a schema back. It is the one part of a bad deploy
# that automation cannot undo, which is exactly why it has to be caught here.
#
# The rule is expand/contract:
#   1. ship the additive change, and code that tolerates both shapes
#   2. deploy, let it bake
#   3. remove the old column in a LATER migration, once nothing reads it
#
# A deliberate destructive change opts out per statement:
#
#   -- allow-destructive: column added and abandoned in the same release
#   ALTER TABLE foo DROP COLUMN bar;
#
# Usage: check-additive.sh [base-ref]     (default: origin/main)
set -euo pipefail

BASE="${1:-origin/main}"
MIGRATIONS_DIR="api/migrations"

# Only migrations introduced or edited by this change. The committed history
# — the squashed baseline especially — is full of statements this would flag,
# and rewriting it is neither possible nor useful.
if git rev-parse --verify --quiet "$BASE" >/dev/null; then
    mapfile -t FILES < <(git diff --name-only --diff-filter=AM "$BASE"...HEAD -- "$MIGRATIONS_DIR/*.up.sql" || true)
else
    echo "note: base ref '$BASE' not found; checking every *.up.sql instead." >&2
    mapfile -t FILES < <(find "$MIGRATIONS_DIR" -name '*.up.sql' | sort)
fi

if [ ${#FILES[@]} -eq 0 ]; then
    echo "No new or modified migrations. Nothing to check."
    exit 0
fi

# Deliberately NOT matching bare `ALTER COLUMN`: `SET DEFAULT` is additive and
# appears a dozen times in the baseline. Only TYPE changes and SET NOT NULL
# break a running reader.
PATTERN='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|DROP[[:space:]]+CONSTRAINT|DROP[[:space:]]+NOT[[:space:]]+NULL|ALTER[[:space:]]+COLUMN[[:space:]]+[^;]*[[:space:]]TYPE[[:space:]]|SET[[:space:]]+NOT[[:space:]]+NULL|RENAME[[:space:]]+COLUMN|RENAME[[:space:]]+TO|TRUNCATE'

violations=0
for f in "${FILES[@]}"; do
    [ -f "$f" ] || continue
    echo "checking $f"

    prev=""
    lineno=0
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))
        stripped="${line%%--*}"

        if printf '%s' "$stripped" | grep -qiE "$PATTERN"; then
            if printf '%s' "$prev" | grep -qiE '^[[:space:]]*--[[:space:]]*allow-destructive:'; then
                echo "  line $lineno: destructive, explicitly allowed"
            else
                echo "::error file=$f,line=$lineno::Destructive schema change. Migrations run at core-api startup, so this is applied before any rollback could fire and cannot be undone by one. Use expand/contract, or add '-- allow-destructive: <reason>' on the line above if this is genuinely safe."
                echo "  line $lineno: $line"
                violations=$((violations + 1))
            fi
        fi

        # Blank lines don't break the association between the opt-out comment
        # and the statement it applies to.
        [ -n "${line// /}" ] && prev="$line"
    done <"$f"
done

if [ "$violations" -gt 0 ]; then
    echo
    echo "$violations destructive statement(s) in new migrations."
    exit 1
fi

echo "All new migrations are additive."
