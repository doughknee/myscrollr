# Release/update foundation implementation

Implementation is isolated in `myscrollr-foundations`, branch
`codex/release-update-foundations`, based on main `c45fc08d`. No version bump,
merge, release publication, live pointer change, deployment or tester message.
The original Fill checkout and running Windows app were left untouched.

## Implemented

- SCROLLR-414: read-only-by-default legacy Latest inspection/repair, published-event
  guard, explicit desktop-tag website fallback. Live repair deliberately unapplied.
- SCROLLR-415: pinned/digest-checked AppImage repackager, locked signer and independent
  Minisign verification. Platform proof follows final signing/repackaging/stapling.
- SCROLLR-416: exact source/run/tag/version/cohort binding, final-byte hashes and
  updater signature verification before explicit publication; retryable separate
  downstream effect jobs. Thirty-day build evidence and Windows staging retention.
- SCROLLR-417: exact updater 2.13.3 JS/Rust pins, required Tauri dependency refresh,
  Rust 1.90 minimum, explicit application-owned no-downgrade policy.
- SCROLLR-418: stable-only desktop announcements and shipped-fix intake; prereleases
  excluded from stable KB refresh on manual and event paths.
- SCROLLR-419: actual closing PR merge, dedicated affirmative issue closure, stable
  release containment, versioned installers, GitHub asset digests and verified
  source record required before automatic shipped-fix claims/drafts.
- SCROLLR-420: SemVer precedence for desktop/website release history and minimum
  version gate, with malformed gate policy failing open.
- Sentry build registration now uses validated package version rather than `main`.
  SCROLLR-35's historical commit-association failure remains unqualified in CI.

No new app, service, package or production data collection. Operator instructions:
[DESKTOP_RELEASES.md](../../docs/DESKTOP_RELEASES.md).

## Verification completed locally

| Check | Result |
|---|---|
| Release policy Node fixtures | 19 passed, including malicious URLs, source/run/tag mismatch, changed bytes, invalid signatures, Linux deb/rpm, published retry and actual macOS local/upload filename mapping |
| Desktop Vitest | 104 files / 1,049 tests passed |
| Website Vitest | 43 files / 420 tests passed |
| Desktop frontend build/typecheck | Passed |
| Website build/typecheck/postbuild | Passed, including prerender, Sentry tunnel and mobile viewport checks |
| Modified website files | Prettier + ESLint passed |
| Go support + core suites | Passed with real disposable PostgreSQL 16; no production environment or data |
| Native Windows GNU cargo check/tests | Locked check passed; 32 Rust library tests passed |
| Workflows | actionlint 1.7.7 passed; shellcheck/pyflakes not installed and explicitly disabled |
| npm production dependency audits | Desktop and website report zero vulnerabilities |
| Legacy routing dry-run | Existing Latest server-2026.10.26.4; proposed desktop-v1.7.2; apply=false |
| GitHub tag resolution | Read-only encoded refs/tags lookup confirmed against desktop-v1.7.2 |

Fresh-worktree frontend checks initially lacked the licensed Motion+ package and
its DOM dependency; copied the already installed packages from the original
checkout without reading/exposing tokens. Builds and tests subsequently passed.
The Windows MSVC target is not installed locally; native verification used GNU.
Existing build chunk-size and jsdom scrollTo warnings remain non-failing.

## Audit dispositions

Security, resilience and consistency reviewers inspected the bounded diff. All
reported findings are resolved and re-reviewed in the companion reports:

- Actual tag resolution must agree with target/build source; canonical asset URLs
  reject traversal and cross-release paths.
- Linux deb/rpm entries are accepted and independently signature-checked.
- Published retry verifies existing bytes; downstream jobs resume independently.
- macOS proof keys match tauri-action's uploaded archive naming.
- Failed build attempts can replace their own staging/proof artifacts.
- Related, negated, partial and quoted issue mentions do not prove closure.
- Support evidence binds version, manifest, asset digests and source; admin copy
  distinguishes unavailable/unproven evidence from a claim that no release exists.

## Limits and next gates

This is local implementation evidence, not remote CI or release qualification.
No actual signed release build, Windows MSVC CI, macOS/Linux runtime install,
updater download/relaunch, or packaged Fill cursor test ran in this phase.
Policy fixtures inject a signature verifier; they do not replace native signing.
The upgraded Tauri stack needs packaged pointer/paging regression checks.

GitHub publisher authority remains the trust boundary for verification.json;
the backend verifies digests and source, not Actions provenance independently.
Old releases without verification records no longer produce automatic fix claims.
Downstream dispatch success does not prove downstream completion, and rerun-all
or a new dispatch can duplicate announcements; use failed-jobs recovery.

SCROLLR-279 (version-qualified KB facts), channel metadata/enrollment/exit,
shared update controller, stalled-operation recovery (421/422), diagnostics (423),
and actual cross-platform pilot remain separate. SCROLLR-414's live repair is
still an explicit production action. Nothing here enrolls Stable users in Beta.
