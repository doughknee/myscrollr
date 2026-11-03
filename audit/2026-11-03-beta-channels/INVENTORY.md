# Beta update channel implementation inventory

Scope: current diff on codex/beta-update-channels, based on PR530 commit5bfdc08f, checkout myscrollr-foundations. User authorized implementation including settings, not merge/publish/live metadata writes. Version1.7.2 unchanged. One main-window controller; ticker must not acquire updater resources.

Sources: raw.githubusercontent.com/doughknee/myscrollr/desktop-updates/{stable,beta}.json via native commands/updates.rs; GitHub published releases and Actions proof artifacts via existing finalize-release.mjs and new release-channels.mjs. Channel publisher maintains protected branch index.json and atomically stable.json+beta.json via Git tree/commit/non-force ref update. Existing build/finalizer provenance/signature validation retained; publisher selected releases rechecked against GitHub digests and tag/source.

Surfaces: UpdatesPage Stable/Beta selector, installed build label, candidate/install progress/error/ready; startup toast; UpdateRequiredOverlay. Shared lib/updateState.ts class, updateController.ts native/store adapter, initialized in app-main before first-run autostart marker consumed. Channels device-local scrollr.json preference. Beta fresh install defaultsBeta; existing explicit choice remains; legacy manualBeta keepsStable with opt-in suggestion.

IPC: fixed enum check_update_channel main-only, fixed endpoints, strictnewer comparator plus Stable prerelease refusal, boundednative check, plugin Update resource passed to JS download/install. Main capability removes generic check and combined downloadAndInstall, retains download/install. Native checks signatures. No newpackages/service/backend.

Long operations: init store, single-flightcheck/download/install/restart; native20srequest/25soutercheckdeadline, download180s; restart failures preserve installedready state. Resourceclosed on candidateinvalidations. Settingsunmounts, modulespersist. Startupdelay4s.

Release workflows: finish-release optional Advance approved update channels gated DESKTOP_CHANNEL_FEEDS_ENABLED, inexistingartifactlock. desktop-update-feeds manual dry-run default; apply additionallyrequiresgate+protectedexistingbranch. No realbranch/feedscreatedyet. Bootstrap/protection/cache/publicaccess and real signedversion-to-version qualification remainlaunchgates.

Audit focus: functional correctness, unsafepublication, staleoffers andoperationraces, channelpolicy, UIrecovery. Existingunrelatedsecuritydebt outofscope. Read-onlyreviews; write reports here, no productedits.
