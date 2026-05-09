## Backlog

### In Progress
- (none)

### Pending
- [ ] Optional: switch to API-key notarization (`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_ID`) instead of Apple-ID + app-specific password. Cleaner credential rotation; no user-facing benefit. Both `tauri-bundler` and `xcrun notarytool` support this auth mode.
- [ ] Optional: split notarize into its own retryable job after the main build. With `continue-on-error: true` + an explicit retry step, a runner-network flake costs ~5 min and one click instead of ~25 min and a full re-build. Defer until the timeout cap proves insufficient.

### Done
- [x] Diagnosed run #25578604859 — macos-14 runner lost network mid-poll on notarytool (`NSURLErrorDomain -1009`, `_NSURLErrorNWPathKey=unsatisfied`). Not an Apple notary issue.
- [x] Added `timeout-minutes: 25` to the desktop-release build job. Bounds notarize-poll hangs to ~25 min vs. the 51-min run that killed PR throughput.
- [x] Reverted the broken `notarize` workflow_dispatch toggle (run #25605423069: `Team ID must be at least 3 characters`). Tauri's bundler gates notarize on env-var *presence*, not value; GitHub Actions' `env:` map sets vars even when values are `''`.
- [x] Verified `Scrollr.app` notarization end-to-end: `spctl --assess --type exec` → `accepted, source=Notarized Developer ID`; `xcrun stapler validate` → `The validate action worked!`.
- [x] Added `Notarize and staple DMG` step to close the unnotarized-DMG-container gap. Verified against published `Scrollr_1.0.9_aarch64.dmg`: `spctl --assess --type install` → `accepted, source=Notarized Developer ID`. Zero Gatekeeper warnings on download.
