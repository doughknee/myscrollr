# Security hardening status - 23 October 2026

## Confirmed shipped

PR #516 / main 2696fb8 / deploy 39913018109 passed production readiness. Staff membership mutations serialize with actor revalidation; revoked staff streams expire. Unverified profile email writes are disabled before any partial mutation, while name updates work (SCROLLR-341, SCROLLR-372). All four incident accounts remain suspended on the latest read. Session endpoint response was inconclusive; no claim of independently enumerated sessions.

## Second batch - awaiting CI and deployment

- Exact verified identity matching for invite completion (379).
- Reject empty approval signing keys and nonexpiring tokens; confirmation POST before support send/skip; Discord actions restricted to configured guild/application administrators/managers (378).
- Remove other customers' raw case histories from reply generation, including defensive rejection of supplied Similar context (382).
- Remove OAuth request/navigation details and tracing from client error telemetry (374).
- Restrict the development command bus to loopback and its own origin, with JSON-only mutations (375).
- Remove embedded Motion registry credentials; private installer suppresses token-bearing failure output and logs, build uses a BuildKit secret (376).
- Patch Go/JS/Rust dependencies, pin channel binary lockfiles, check advisories on PR/main (373).
- Strip unused Kubernetes service-account token mounts and block link-local egress for all application workloads, with explicit DNS and core-to-ingester paths (384).
- Strip finance HTTP request URLs from errors before logging (380).

## Validation so far

Full Go suite with race detector and disposable PostgreSQL passed. Finance Rust tests, including schema contract and synthetic credential-error checks, passed. Website 416 tests and desktop 1002 tests passed. Website production build and desktop typecheck passed. Network policy server-side dry-run passed. Independent reviewers' build/network issues are corrected. Clean Docker embed build passed; the npm no-save install preserved the lockfile byte-for-byte. Signed Discord nonstaff handler regression passed. No production customer writes, feed cleanup, or attack requests used in these checks.

## Bounded dependency exceptions and remaining work

- Go govulncheck: no vulnerable calls after Go 1.26.10 and library upgrades. Production npm audits: zero advisories. Website development-only dependency advisories remain; do not expose dev servers publicly.
- Rust optional rsa (SQLx MySQL) and rkyv are absent from compiled graphs; CI asserts this before advisory exceptions. Tauri Windows updater still uses zip 4 even in upstream 2.14.0. The zip >=9 fixes cannot be applied by a lock-only compatible update. Current updater verifies a release signature before archive extraction. Three zip advisories remain explicitly excepted and tracked in 373; signed malicious archives or signer compromise remain a risk. No claim of a fully clean cargo audit.
- Motion credential was already present in git history. Repository cleanup does not revoke it. Owner rotation remains pending (376); no value retained in this report.
- Verified profile mailbox-change flow (377), Stripe failed-event retryability (381), desktop token storage/native permissions/CSP (383), and webhook replay-window hardening remain follow-ups. No exploitable renderer injection was demonstrated during this audit.
- Support email links now require confirmation; Discord operators need Administrator or Manage Server permission. Website staff tools remain available.
- DigitalOcean's investigation of potential worker observability credential exposure remains unresolved. Current hardening cannot prove historic non-access or absence of customer-data theft. This was a source/configuration/dependency review with isolated tests, not an independent penetration test.
