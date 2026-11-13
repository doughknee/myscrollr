# Returning from Beta to Stable

Choosing **Stable** in Settings → Updates stops future Beta offers. It does not replace the installed app. A newer installed Beta can remain installed until a newer Stable release is available.

**Return to Stable** is available in 1.8.0-beta.2 and in the qualified but unpublished 1.8.0-beta.3 and 1.8.0-beta.4, for the supported packages below. In Settings → Updates, select Stable, check for updates, then choose **Return to Stable 1.7.3**. A separate confirmation shows the versions before any download or installation. The action is not present in 1.8.0-beta.1; use the manual instructions below if that version cannot be updated.

## If a Beta will not open

Quit Scrollr completely, including its tray/menu-bar process. Use the official [Stable 1.7.3 release](https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.7.3) for recovery from **1.8.0-beta.1, 1.8.0-beta.2, 1.8.0-beta.3 or 1.8.0-beta.4**. This removes Fill this display; the ticker returns to docking.

- **Windows x64, installed with the EXE:** run the signed 1.7.3 EXE installer over the existing installation. Use the same installation location. Do not uninstall or select an option to delete app data.
- **Apple Silicon macOS:** replace Scrollr in Applications with the 1.7.3 app from the official DMG, then reopen it. Do not delete its Application Support data.
- **Linux x64 AppImage:** replace the Beta AppImage with the 1.7.3 AppImage and retain its executable permission. If a launcher points to a versioned filename, update that launcher to the replacement file.

MSI, DEB/RPM, different CPU architectures and other version pairs are not covered by these instructions. [Contact support](https://myscrollr.com/support) with the installed version, OS and installer type before attempting those paths.

Open Settings → Updates after recovery, choose **Stable**, and check that Installed shows **1.7.3**. Manual installation retains your existing channel choice, so this step prevents another Beta offer. Compatible preferences and account storage stay in place. Never restore an old copy of your profile or tokens: refresh tokens may have rotated. If sign-in has expired, sign in normally.

## Implementation and qualification contract

The native updater reads the existing protected Stable feed. A separate recovery command accepts no caller-provided URL, version, package type or comparator. `desktop/src-tauri/src/commands/stable-recovery.json` pins the exact source versions, target version, package URLs and signatures. A changed or withdrawn feed entry fails closed. Ordinary checks still accept only newer releases, with `plugins.updater.allowDowngrades` remaining false.

The initial package set is NSIS on Windows x64, the app bundle on Apple Silicon macOS, and AppImage on Linux x64. Unknown/dev, MSI, DEB and RPM packages get guidance instead of an in-app recovery offer. Recovery must also meet the server's required minimum version. Confirmation is tied to an offer ID; cancellation, channel changes, failed verification and stale confirmations cannot install it.

Before shipping any new source version, run the signed source → target installation rehearsal and review changes to preferences, authentication, storage, app identifier and package layout. The exact signed cohort is tested by `desktop-update-rehearsal.yml` with `recovery=true`. This verifies native replacement, signatures, packaged restart and synthetic preferences on disposable hosted runners. The test never installs on a developer's machine or copies a real profile. Record run IDs and limitations in the PR. Build/transport tests do not prove live login, physical displays or sleep/wake behavior.

Do not broaden the allowlist automatically when bumping a version. Keep published releases immutable. A new Beta needs its own signed candidate and qualification before publication.

### Beta 2 qualification

The exact Beta 2 packages from [build 41742821548](https://github.com/doughknee/myscrollr/actions/runs/41742821548), source `6a0155363b9dd6f0a2ba5ff591c0cbbc0b85c9a9`, passed both [Stable → Beta installation](https://github.com/doughknee/myscrollr/actions/runs/41744773834) and [Beta → Stable recovery](https://github.com/doughknee/myscrollr/actions/runs/41744777329) on Windows x64 NSIS, macOS ARM64 and Linux x64 AppImage. Each passed signature/source verification, native replacement, packaged restart and synthetic preference retention. Stable 1.7.3 assets, signatures and build run `41688396593` remain fixed.

These rehearsals use a mock native updater host with actual signed packages. They do not exercise the source app controller, a real signed-in profile or physical hardware. The local signed-in Windows round trip was not performed for this Beta. A candidate rebuild invalidates previous qualification evidence and needs both runs again against the final bytes.

### Beta 3 qualification

The exact Beta 3 packages from [build 43513775231](https://github.com/doughknee/myscrollr/actions/runs/43513775231), source `30ac577a5631a6ff4289e3cf2e8f38a3c2b332c4`, passed both [Stable → Beta installation](https://github.com/doughknee/myscrollr/actions/runs/43524699425) and [Beta → Stable recovery](https://github.com/doughknee/myscrollr/actions/runs/43524711096) on Windows x64 NSIS, macOS ARM64 and Linux x64 AppImage on 13 November 2026. Each passed signature/source verification, native replacement, packaged restart and synthetic preference retention. Stable 1.7.3 assets, signatures and build run `41688396593` remain fixed.

Two things differ from Beta 2 and are recorded so the evidence is read correctly. The macOS package was built on `macos-15`, because GitHub retired the `macos-14` runner on 2 November 2026; its first build attempt failed at notarization until the Apple developer agreement was renewed, and the failed job was re-run inside the same build run, so all three platforms still come from one run and one commit. And the rehearsal harness ran from `main` at `fa20f3ac`, which already held the Beta 4 content, not from the candidate commit; the packages under test were the candidate's.

These rehearsals use a mock native updater host with actual signed packages. They do not exercise the source app controller, a real signed-in profile or physical hardware. The local signed-in Windows round trip was not performed for this Beta. A candidate rebuild invalidates this evidence and needs both runs again against the final bytes.

### Beta 4 qualification

The exact Beta 4 packages from [build 43527096021](https://github.com/doughknee/myscrollr/actions/runs/43527096021), source `425609aed142750666c89fc3b53b871c24bc7589`, passed both [Stable → Beta installation](https://github.com/doughknee/myscrollr/actions/runs/43529051567) and [Beta → Stable recovery](https://github.com/doughknee/myscrollr/actions/runs/43529063593) on Windows x64 NSIS, macOS ARM64 and Linux x64 AppImage on 13 November 2026. Each passed signature/source verification, native replacement, packaged restart and synthetic preference retention. The rehearsal harness ran from the candidate commit. Stable 1.7.3 assets, signatures and build run `41688396593` remain fixed.

Beta 4 changes no storage keys, app identifier or package layout relative to Beta 3. It does change sign-in handling (a cancellable sign-in, stricter refresh rules, account data cleared on an account change), which these rehearsals cannot see: they use a mock native updater host with actual signed packages and a synthetic profile. Before publishing, check by hand on Beta 4: a normal browser sign-in, Cancel then sign in again, wake from sleep with the bar reconnecting within about 45 seconds, and on Windows with the bar docked, the screen work area before and after an in-app update from this version. The local signed-in Windows round trip was not performed for this Beta. A candidate rebuild invalidates this evidence and needs both runs again against the final bytes.

The rehearsal workflow's main-only draft recovery condition accepts the Beta 3 and Beta 4 pairs. Narrow it again when the next candidate is prepared.
