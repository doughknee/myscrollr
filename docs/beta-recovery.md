# Returning from Beta to Stable

Choosing **Stable** in Settings → Updates stops future Beta offers. It does not replace the installed app. A newer installed Beta can remain installed until a newer Stable release is available.

The new **Return to Stable** action is being prepared for a future build. It is not present in the published 1.8.0-beta.1. It will only offer a tested source/target pair and installer. A separate confirmation shows the versions before any download or installation.

## If a Beta will not open

Quit Scrollr completely, including its tray/menu-bar process. Use the official [Stable 1.7.3 release](https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.7.3) for recovery from **1.8.0-beta.1**. This removes Fill this display; the ticker returns to docking.

- **Windows x64, installed with the EXE:** run the signed 1.7.3 EXE installer over the existing installation. Use the same installation location. Do not uninstall or select an option to delete app data.
- **Apple Silicon macOS:** replace Scrollr in Applications with the 1.7.3 app from the official DMG, then reopen it. Do not delete its Application Support data.
- **Linux x64 AppImage:** replace the Beta AppImage with the 1.7.3 AppImage and retain its executable permission. If a launcher points to a versioned filename, update that launcher to the replacement file.

MSI, DEB/RPM, different CPU architectures and other version pairs are not covered by these instructions. [Contact support](https://myscrollr.com/support) with the installed version, OS and installer type before attempting those paths.

Open Settings → Updates after recovery, choose **Stable**, and check that Installed shows **1.7.3**. Manual installation retains your existing channel choice, so this step prevents another Beta offer. Compatible preferences and account storage stay in place. Never restore an old copy of your profile or tokens: refresh tokens may have rotated. If sign-in has expired, sign in normally.

## Implementation and qualification contract

The native updater reads the existing protected Stable feed. A separate recovery command accepts no caller-provided URL, version, package type or comparator. `desktop/src-tauri/src/commands/stable-recovery.json` pins the exact source versions, target version, package URLs and signatures. A changed or withdrawn feed entry fails closed. Ordinary checks still accept only newer releases, with `plugins.updater.allowDowngrades` remaining false.

The initial package set is NSIS on Windows x64, the app bundle on Apple Silicon macOS, and AppImage on Linux x64. Unknown/dev, MSI, DEB and RPM packages get guidance instead of an in-app recovery offer. Recovery must also meet the server's required minimum version. Confirmation is tied to an offer ID; cancellation, channel changes, failed verification and stale confirmations cannot install it.

Before adding any source version (including the next Beta that ships this UI), run the signed source → target installation rehearsal and review changes to preferences, authentication, storage, app identifier and package layout. The exact published cohort is tested by `desktop-update-rehearsal.yml` with `recovery=true`. This verifies native replacement, signatures, packaged restart and synthetic preferences on disposable hosted runners. The test never installs on a developer's machine or copies a real profile. Record run IDs and limitations in the PR. Build/transport tests do not prove live login, physical displays or sleep/wake behavior.

Do not broaden the allowlist automatically when bumping a version. Keep published releases immutable. A new Beta needs its own signed candidate and qualification before publication; this PR does not publish a build or change feeds.
