#!/usr/bin/env bash
# Fail when a tracked file refers to the old GitHub owner `brandon-relentnet`
# (renamed to `doughknee`; the old name is unclaimed, so URLs under it work only
# through GitHub's redirect). Allowed: the Go module path
# (github.com/brandon-relentnet/myscrollr/api...), lockfiles, the documented
# legacy alias in desktop/scripts/release-policy.mjs and support/release_proof.go,
# docs/ and audit/ (history), and this check with its fixture test.
#
# Usage: check-old-owner.sh [repo-root]     (default: current directory)
set -euo pipefail

cd "${1:-.}"
hits=$(git grep -nI 'brandon-relentnet' -- . \
    ':!*package-lock.json' ':!*go.sum' ':!*Cargo.lock' ':!docs' ':!audit' \
    ':!desktop/scripts/release-policy.mjs' ':!desktop/scripts/release-policy.test.mjs' \
    ':!api/internal/support/release_proof.go' ':!api/internal/support/release_proof_test.go' \
    ':!scripts/ci/check-old-owner.sh' ':!scripts/ci/check-old-owner.test.sh' \
    | grep -v 'github\.com/brandon-relentnet/myscrollr/api' || true)

if [ -n "$hits" ]; then
    echo "::error::A runtime reference to the old GitHub owner 'brandon-relentnet' was added; use 'doughknee'"
    echo "$hits"
    exit 1
fi
echo "No runtime references to brandon-relentnet"
