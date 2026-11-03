# First signed Beta candidate

Candidate: `1.8.0-beta.1` / `desktop-v1.8.0-beta.1`.
Tracks SCROLLR-431 under SCROLLR-299. Builds from reviewed main through the
existing Desktop Release workflow, as an unpublished GitHub draft/prerelease.
Finish Desktop Release and live feed operations are outside this authorization.

## Scope

- Fill this display, responsive page grids/pins, and the preserved slide animation.
- Windows cursor rendering workaround.
- Stable/Beta device preference and shared update controller.
- Release evidence, signing, monotonic selection and readiness guards.

Canonical app/package/Cargo/manifest identity is `1.8.0-beta.1`. MSI uses numeric
`1.8.0.1` because the locked Tauri CLI's WiX conversion rejects `beta.1`.
Reference: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.10.1/crates/tauri-bundler/src/bundle/windows/msi/mod.rs
The release version guard binds the numeric major/minor/patch to the app version.
MSI Beta-to-final replacement remains an explicit promotion qualification gate.

## Required evidence

| Target | Automated candidate checks | Hardware checks |
| --- | --- | --- |
| Windows x64 | Authenticode/timestamps, updater signatures, NSIS install, installed app signature/publisher, 30-second native-window launch | Available on Doni's Windows machine; actual results recorded separately |
| macOS Apple Silicon | App and DMG signing/notarization/Gatekeeper, updater signature, 30-second launch from mounted DMG copy | Not available; user requested CI only |
| Linux x64 | Final repackaged AppImage hash/signature, 30-second Xvfb launch with visible Scrollr window | Not available; user requested CI only |

All three proofs must bind to one successful source/run. Run the existing
`finalize-release.mjs resolve` and `verify` read-only commands against the draft.
Record exact hashes, source, run and test artifacts in qualification evidence.
CI startup is not login/rendered-content/physical-device qualification.

## Boundaries and remaining cases

No feeds are active; Settings must report an unavailable check, not "current".
This is a manual-install candidate. No public updater transport, Stable-to-Beta,
Beta-to-Beta/final, withdrawal/cache or downgrade-recovery claim follows from it.
Feed activation requires the separately approved verified Stable baseline.
No tester contact or beta enrollment is performed by this task.

Windows hands-on: installed Beta identity and channel preference; Fill grid/strip,
reading sizes, pins, keyboard/wheel cursor responsiveness, Escape/docked recovery;
restart and retained preferences; sleep/wake and monitor reconnect where possible.
Use existing user data only with care: never overwrite a store containing rotated
credentials with an old snapshot. Mac/Linux physical checks remain untested.

Known separate follow-ups: SCROLLR-414 live legacy updater routing repair,
SCROLLR-429 progress notification performance, SCROLLR-430 website stable selection.
Their status is not changed by creating this draft.
