# Beta channels and shared updater validation

Branch: codex/beta-update-channels, based on foundations PR530 commit5bfdc08f.
Scope: SCROLLR-424, SCROLLR-421, SCROLLR-422. Version remains1.7.2.

## Implemented

- Atomic Stable/Beta metadata reconciliation in the existing repository; approval uses the existing run-bound signature/provenance verification, selected published assets are rechecked, and CAS rejects competing pointer updates. Dry-run is default. Workflow activation remains disabled until separately approved.
- Fixed native channel selection, main-window-only update resources, strict newer-version policy, bounded native manifest/download requests, no generic frontend check capability.
- One controller across startup, required-update overlay and Settings. Progress/pending restart survive navigation; stale offers cannot install; leaving Beta waits for a newer Stable release; failed restart does not download again.
- Device-local durable selection with partial-write rollback; fresh Beta defaults and preserved explicit choices; Settings opt-in copy, installed build identity, waiting/unavailable/error states and manual recovery links.
- Existing operations status labels and generated support KB updated with the new controls.

## Verification

| Check | Result |
| --- | --- |
| Desktop npm test | 108 files, 1,083 tests passed |
| Desktop npm run build | Passed production build and TypeScript check |
| Release policy and channel Node fixtures | 24 passed |
| cargo test --lib --target x86_64-pc-windows-gnu | 33 passed; existing shell-open deprecation warning |
| Browser updates.spec.ts on Microsoft Edge | 2 passed at960x740 and400x740; actual Settings/controller with substituted OS/network effects |
| Go operations and KB generator tests | Passed in golang:1.26.10 container |
| KB generation | Regenerated with expected channel row/provenance only |
| actionlint1.7.12 | Changed workflows passed; shellcheck/pyflakes explicitly disabled |
| git diff --check | Passed |

Browser scenarios verify explicit enrollment without installation, available offer, disabled selection while downloading, progress after unmount/remount, restart rejection, and one download only. Screenshots in desktop/test-results show settled channel selection and wrapping without horizontal overflow at400px. Release-history network failure in the isolated fixture is its existing recovery card, not a live-feed claim.

Controller/adapter/hook tests cover concurrent callers, stale offers, same/lower/invalid versions, Stable prerelease refusal, Beta exit, minimum-version gating, unknown-length progress, failed checks/download/signature verification, restart-only retry, partial preference writes, StrictMode timers, and explicit failed toast retries.

## Review and boundaries

Focused app-audit security and resilience reviews produced two recovery findings: partial preference writes and disappearing install-failure toasts. Both were fixed with regression tests, including a failed follow-up check from the toast. See SECURITY.md, RESILIENCE.md and TRIAGE.md.

No push, PR creation, merge, version bump, release publication, feed branch creation/write, activation-variable change, deployment, tester contact or installed-app replacement occurred. The existing signed artifact tested by the user is from the prior foundations phase; it does not contain these changes. This phase has local validation, not new remote CI or signed-build qualification.

Remaining release gates: bootstrap/protect and publicly qualify the metadata host after approval, establish a complete verified Stable baseline, then test real signed version-to-version upgrades and native fault recovery on Windows/macOS/Linux. Existing legacy Latest repair remains separate and unapplied. Synthetic tests do not qualify signatures or OS installation by themselves.
