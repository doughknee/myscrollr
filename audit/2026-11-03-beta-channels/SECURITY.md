# Security audit: Beta update channels

Reviewed 2026-11-03 in `myscrollr-foundations`, branch `codex/beta-update-channels`, against the implementation inventory. Scope is the new channel publication path, fixed native check command, shared controller adapter and changed main-window updater capabilities. Product files were not edited. No workflow was dispatched and no remote metadata was written.

## Findings

No new actionable P0/P1/P2 security defect was established in the reviewed diff. This is a source review, not proof of live branch permissions, CDN behavior, packaged installer behavior or platform signing.

## Boundary evidence

| Entry point | Verdict and evidence |
| --- | --- |
| `check_update_channel` | Main window label required (`desktop/src-tauri/src/commands/updates.rs:42`); closed serde enum (`:8`); fixed HTTPS Stable/Beta URLs (`:15`); strict-newer comparison and Stable prerelease refusal (`:52`, `:63`); expected repository/version-bound asset URL (`:66`). No arbitrary endpoint input. |
| Plugin updater download | Main capability exposes download, but removes generic check and combined download/install (`desktop/src-tauri/capabilities/default.json:40`). Download requires the main webview's native Update resource. The pinned plugin clones that resource, applies the timeout, and verifies downloaded bytes/signature before returning a downloaded-byte resource. |
| Plugin updater install | Requires main webview Update and DownloadedBytes resources; ticker capability has no updater permissions. Pinned plugin installs only after download's signature validation. |
| Resource close | Uses Tauri core resource ownership; controller closes unused candidates when selection/check invalidates them (`desktop/src/lib/updateState.ts:63`). |
| Manual feed workflow | Main-ref gated, default dry run; apply also requires the enable variable. Inputs enter environment variables, not interpolated shell code (`.github/workflows/desktop-update-feeds.yml`). Approval reuses read-only finalizer verification and bound build-run proofs. |
| Finalizer feed advance | Runs after verified publication, within the existing build/finalizer artifact lock, and only when enable variable is true (`.github/workflows/finish-release.yml`). |
| Feed publisher | Validates manifest hash and cohort, immutable approval records, live selected asset digests/tag source (`desktop/scripts/release-channels.mjs:14`, `:61`, `:106`). Reads the registry at an exact commit SHA. Writes both manifests and registry in one tree/commit. Ref update is non-force with previous head as parent (`:124`), so a competing commit causes failure rather than overwrite. |

## Data and trust checks

- Channel manifests and installer locations are HTTPS. Runtime command accepts only the channel enum. No new credentials are bundled in the app.
- Workflow credentials use the existing GitHub Actions token. API mutations use `execFileSync` argument arrays and JSON request files, without a shell.
- New Settings candidate notes are text children, not HTML; there is no new HTML injection surface.
- No new webhook, callback, package or dependency was introduced. Unrelated existing HTTP capabilities and dependency debt were outside this review.
- The protected metadata registry remains a trusted publisher-controlled input. The script's `protected` boolean check is a minimum guard, not a substitute for qualifying the actual ruleset, writer restrictions, bypass permissions and no-force/no-delete protections before launch.

## Qualification notes, not new-diff findings

1. No metadata branch was inspected or created. Before enabling `DESKTOP_CHANNEL_FEEDS_ENABLED`, verify public raw URLs, caching, protected-branch writer permissions, baseline verification, and dry-run plans. Unit fixtures do not establish these live conditions.
2. Existing updater configuration does not set `requireSignedVersion` (`desktop/src-tauri/tauri.conf.json:36`). The pinned updater verifies signatures but accepts a legacy signature lacking a signed version unless this option is enabled (upstream local source `updater.rs:1834`). The current publisher verifies source/build/manifest digests and the new native command binds download URLs to advertised version; this inherited hardening consideration is not a new regression. If enabling the stricter option later, first qualify every platform's signature comments, especially the manually re-signed AppImage, so valid updates are not rejected.
3. The existing `allowDowngrades: false` plus strict-newer comparator blocks normal downgrade/same-version offers; end-to-end version-to-version installation and signed-package identity still need candidate qualification.

| Severity | New findings |
| --- | ---: |
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
