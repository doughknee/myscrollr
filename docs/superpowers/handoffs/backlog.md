## Backlog

### In Progress
- (none)

### Pending
- [ ] Cut a public macOS release with `notarize=true` once a stable build is ready (verifies the toggle's "on" path end-to-end). With the new `timeout-minutes: 25` cap, a flaky runner now fails at ~25 min instead of ~50, so re-runs are cheap.
- [ ] Optional: split notarize into its own retryable job so future runner-network flakes cost ~5 min instead of ~25. Could pair with a switch to API-key notarization (`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_ID`) for cleaner credential rotation.

### Done
- [x] Diagnosed run #25578604859 failure — **not** an Apple notary issue. The macos-14 runner lost network connectivity (`NSURLErrorDomain -1009`, `_NSURLErrorNWPathKey=unsatisfied (No network route)`) while polling notarytool for submission `43b5a62e-ea70-4c70-b67b-97ad02303a11`. Codesigning fully succeeded before the network drop; the submission may have been accepted on Apple's side but is moot now (no live release artifact).
- [x] Added `notarize` boolean workflow_dispatch input (default `false`) to `.github/workflows/desktop-release.yml`. Gates `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` via `${{ inputs.notarize && secrets.X || '' }}`. Codesigning creds stay always-on. Push-triggered builds skip notarize (intended behavior — public releases are deliberate dispatches).
- [x] Added `timeout-minutes: 25` to the `build` job. Bounds notarize-poll hangs to ~25 min (vs. the 51-min run that killed PR throughput) while leaving 2.5x headroom over healthy ~10 min builds.
