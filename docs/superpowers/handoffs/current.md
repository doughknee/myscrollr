# Current Session Handoff

## Repo State
- Branch: `main`
- Worktree: clean
- Last commit: `6e274d8 ci(desktop): notarize and staple macOS DMG so Gatekeeper accepts the download silently`

## Active Task
None. macOS notarization pipeline is fully working end-to-end.

## What's Working Now
Every push to `main` touching `desktop/**` produces:
- Signed + notarized + stapled `Scrollr.app`
- Signed + notarized + stapled `Scrollr_*_aarch64.dmg`
- Working updater bundle (`Scrollr_aarch64.app.tar.gz`)

User-visible result: zero Gatekeeper warnings on download, mount, install, or first launch.

## Verified (run #25607445470, 2026-05-09)
```
spctl --assess --type install Scrollr_1.0.9_aarch64.dmg
  → accepted, source=Notarized Developer ID
xcrun stapler validate Scrollr_1.0.9_aarch64.dmg
  → The validate action worked!
```
- `.app` notarize submission `bcdc4591-…` accepted in ~25s.
- DMG notarize submission `4c24a6ba-…` accepted in ~24s.
- macOS job total: 7m43s (was 6m07s; +96s for the second notarize submission).

## Workflow Configuration (`.github/workflows/desktop-release.yml`)
- `timeout-minutes: 25` on the build job — bounds the notarize-poll hang from
  run #25578604859 (macos-14 runner network drop, NSURLErrorDomain -1009).
- Apple secrets unconditionally passed to `tauri-action` — Tauri's bundler
  gates notarize on env-var *presence*, not value, so any toggle that
  passes `''` triggers notarize-with-empty-creds and fails at notarytool
  validation (run #25605423069, "Team ID must be at least 3 characters").
- New `Notarize and staple DMG` step after `Build Tauri app`, gated on
  `matrix.platform == 'macos-14'`, with `continue-on-error: true` so a
  runner-network flake doesn't block the pipeline.

## Operator Note
The user wanted "fucking notarization that works." Delivered.

## Risks / Open Questions
- Existing release `desktop-v1.0.9` has been re-uploaded with the stapled
  DMG. Future version bumps will produce stapled DMGs from the start.
- If `continue-on-error: true` ever masks a silent stapling failure, the
  only thing that catches it is the post-deploy `spctl` check. No alerting
  on the GitHub Actions side.

## Reference
- Failed runs: #25578604859 (runner-network hang, 58m), #25605423069 (broken toggle, 8m50s)
- Working runs: #25607083776 (revert verified), #25607445470 (DMG notarize verified)
- Tauri bundler gating: `crates/tauri-bundler/src/bundle/macos/sign.rs::notarize_auth`
