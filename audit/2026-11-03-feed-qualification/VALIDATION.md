# Validation — 3 November 2026

Local preparation on `codex/feed-qualification`, based on channel PR531 commit
`6846f60039dce1a4358986e67b899f0011d714bc`.

- **34/34 Node tests passed**, zero skipped, in `node:22-alpine` with networking
  disabled and a read-only repository mount: release policy, channel selection,
  publisher CLI rehearsal and public-byte verification.
- The six CLI scenarios cover first Stable bootstrap, dry-run with zero API
  mutations, atomic publication, losing a concurrent publication race, refusing
  missing/unprotected branches and idempotent retry. All apply calls used a local
  fake GitHub CLI; no actual GitHub write permission was exercised.
- Public-byte tests cover both exact client URLs, stale/negative cache recovery,
  network/HTTP failure, deadline expiry and oversized response refusal.
- `go test ./internal/ops` passed using Go 1.26.10 in Docker; changed Go files
  formatted with gofmt. The progress label and workflow step contract include
  the new public-feed check.
- Actionlint 1.7.12 passed for all three modified workflows. External ShellCheck
  and Pyflakes integrations were disabled for this check.
- `git diff --check` passed.
- Existing 1.7.2: all six distinct updater packages match published GitHub
  SHA-256 digests and pass Minisign verification with the app's configured key.
  Both Windows installers have valid, timestamped Scrollr, LLC Authenticode
  signatures. See the adjacent JSON evidence.

The public host control returned 200 and conditional 304; both actual feed URLs
returned 404. The metadata branch, effective branch rules and activation variable
remain absent. The current Stable release lacks the new run-bound verification
proof. These are activation prerequisites, not passed live-feed checks.

This phase changes release tooling, documentation and an operator progress label.
It does not change desktop runtime code or rebuild/reinstall the app. Prior signed
test-build results belong to PR531's existing commit, not to this follow-up.
No cross-version update, macOS notarization assessment or multi-OS runtime test
is claimed by these checks. See READINESS.md for the remaining approval gates.
