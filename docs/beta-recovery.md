# Returning from Beta to Stable

Choosing **Stable** in Settings → Updates stops future Beta offers. It does not replace the installed app. A newer installed Beta can remain installed until a newer Stable release is available.

**Return to Stable** is available in 1.8.0-beta.2 for the supported packages below. In Settings → Updates, select Stable, check for updates, then choose **Return to Stable 1.7.3**. A separate confirmation shows the versions before any download or installation. The action is not present in 1.8.0-beta.1; use the manual instructions below if that version cannot be updated.

## If a Beta will not open

Quit Scrollr completely, including its tray/menu-bar process. Use the official [Stable 1.7.3 release](https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.7.3) for recovery from **1.8.0-beta.1 or 1.8.0-beta.2**. This removes Fill this display; the ticker returns to docking.

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

### Beta 3 candidate

Beta 3 uses the same app identity, package types, updater and Stable 1.7.3 signed artifacts. Election follows are server-side; an older desktop does not need to migrate local election data to recover. Its exact source version is included for private recovery qualification. Before publication, rehearse the final signed Beta 3 artifacts in both directions and record the build and rehearsal evidence here. Beta 2's runs do not qualify Beta 3.
