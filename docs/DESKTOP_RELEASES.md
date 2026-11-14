# Desktop release and update foundations

The existing Desktop Release workflow builds Windows x64, macOS Apple Silicon,
and Linux x64. Finish Desktop Release is the explicit publication boundary.
Stable/Beta feeds and device-local enrollment extend this same app and release
pipeline. There is no second app, backend, account, or entitlement system.

## Current implementation boundary

The first unpublished candidate is 1.8.0-beta.1. Preparing a candidate does not
publish a release or repair the live legacy update URL. The legacy repair below is a
separate production metadata change. No tester build is qualified by unit tests.

The native updater is pinned to 2.13.3 and application configuration forbids
downgrades. Its required Tauri dependency update raises the Rust minimum to 1.90.
Do not weaken that policy to implement Beta exit: a lower stable version requires
a separately designed recovery path. Full SemVer governs minimum-version checks
and release history; malformed minimum-version policy fails open.

## Build a candidate after approval

1. Use a reviewed main commit (or the restricted maintenance source below) with a new, consistent version in desktop
   package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json.
   `node desktop/scripts/release-policy.mjs version` checks those identities.
   Prerelease versions produce GitHub prereleases; final versions produce stable
   drafts. The main workflow creates drafts, never publishes them.
2. Build all three targets in one Desktop Release run. A single-platform run is
   diagnostic and cannot satisfy the full publication gate. Existing drafts must
   name exactly the same source SHA; use a new version for changed source.
3. Check native signing/notarization and the actual packaged application on each
   advertised target. In particular, retest Fill keyboard/wheel paging and cursor
   behavior after the Tauri upgrade. Test install, update, relaunch, preferences,
   restart, sleep/wake and monitor reconnect. Never infer runtime success from CI.
4. Review notes, known issues, recovery instructions, source SHA and build run ID.
   Publishing is a separate release decision, not part of a routine code merge.

The AppImage repackager is version-and-digest pinned. Its changed output is signed
with the repository-locked Tauri CLI and independently checked with Minisign.
Windows proof follows Authenticode verification; macOS proof follows app and DMG
verification/stapling. Proof hashes use uploaded asset names, including Tauri
Action's architecture suffix on the macOS updater archive.

The candidate's MSI numeric version is explicitly `1.8.0.1`: the pinned WiX
bundler cannot derive a numeric version from `beta.1`. App/package/Cargo/updater
identity remains `1.8.0-beta.1`; the version guard rejects a numeric MSI override
with different major/minor/patch. Qualify Beta-to-final MSI replacement before
Stable promotion; installer numbering is not the updater's SemVer policy.

**Desktop MSI Replacement Rehearsal** (`desktop-msi-rehearsal.yml`, main only,
read-only) is that qualification. Dispatch it with `source_tag` and `target_tag`:
on a disposable Windows runner it installs the source `.msi`, installs the target
over it, requires exactly one Scrollr entry in Windows' installed-apps list and
the installed program to report the target version, then starts the program for
20 seconds. Windows Installer compares only the first three parts of an MSI
version, so Beta-to-Beta and Beta-to-final are same-version installs. Development
run [43612778502](https://github.com/doughknee/myscrollr/actions/runs/43612778502)
showed `1.8.0.2 → 1.8.0.4`, `1.8.0.4 → 1.8.0.2` and `1.7.3.0 → 1.8.0.4` each
replace cleanly. It installs silently as administrator; it does not run the
app's own updater, sign in, or touch physical displays. The update rehearsal
below covers the NSIS installer only.

The main build also runs bounded packaged startup smoke checks on disposable
runners: signed NSIS install and native window on Windows, launch from the
verified mounted DMG copy on macOS, and the final repackaged AppImage under Xvfb
on Linux. Each must stay alive for 30 seconds. These checks do not prove login,
rendered content, real update transport, physical Fill cursor behavior, sleep/wake,
or monitor reconnect. Evidence is retained for 30 days beside build proofs.

### 1.8.0 Stable candidate qualification

The exact 1.8.0 packages from [build 43614083197](https://github.com/doughknee/myscrollr/actions/runs/43614083197),
source `a5a5dca3c4ce99eaa1cc2628b93fa18e17535353`, were an **unpublished draft**
when this was written on 14 November 2026. Under `desktop/`, that source differs
from the published `desktop-v1.8.0-beta.4` only in the five version files,
including the MSI number `1.8.0.0`. No application code changed.

| Path | Run | Result |
|---|---|---|
| Stable 1.7.3 → 1.8.0, native updater: Windows x64 NSIS, macOS ARM64, Linux x64 AppImage | [43615750820](https://github.com/doughknee/myscrollr/actions/runs/43615750820) | passed on all three |
| Beta 4 → 1.8.0, native updater, same three | [43615762926](https://github.com/doughknee/myscrollr/actions/runs/43615762926) | passed on all three |
| `.msi` 1.7.3 (`1.7.3.0`) → 1.8.0 (`1.8.0.0`) | [43615765606](https://github.com/doughknee/myscrollr/actions/runs/43615765606) | one installed-apps entry, program 1.8.0, started |
| `.msi` Beta 4 (`1.8.0.4`) → 1.8.0 (`1.8.0.0`) | [43615772621](https://github.com/doughknee/myscrollr/actions/runs/43615772621) | one installed-apps entry, program 1.8.0, started |

The last row is the Beta-to-final MSI qualification required above. A read-only
review before the version change (#589) traced every place where a prerelease
version behaves differently from a final one: `1.8.0` compares newer than
`1.8.0-beta.4` in the app, the Rust updater and the server; Return to Stable
cannot appear on a final build; a 1.7.3 user stays on Stable.

Carried over from Beta 4, which has the same application code: the owner's
by-hand checks on Windows on 14 November 2026 with a real signed-in profile
(browser sign-in, Cancel then sign in again, wake from sleep with the bar
reconnecting, windows around the docked bar).

Not qualified by any of this: no person has opened a 1.8 build on a real Mac,
and the macOS package comes from `macos-15` build machines, new since 1.7.3; an
in-app update through the production controller on real hardware; Fill this
display on physical monitors beyond the owner's own Beta use. Stable has no
in-app way back: a bad 1.8.0 is corrected by 1.8.1. A candidate rebuild
invalidates this evidence. Build proofs are retained for 30 days from the build,
after which publication needs a new candidate version.

## Maintenance baseline source

The approved maintenance exception is exactly `release/desktop-1.7`, restricted
to final Stable versions `1.7.3` and later within `1.7.x`. No prerelease, other
version line, arbitrary source ref or fork qualifies. Its Desktop Release run
must still bind to the exact source SHA and all three platform proofs.

Before building or finalizing, the read-only source guard verifies effective
deletion, non-fast-forward, pull-request and required `repo-shape` protections.
Frontend/backend/security CI runs on maintenance PRs and pushes. The existing
main rules are unchanged. Finish Desktop Release stays main-only and validates
the maintenance run rather than trusting branch-local publication instructions.
Keep this branch protected and available while its releases may be finalized.

The 1.7.3 baseline starts from the released 1.7.2 desktop source and backports
release/update foundations. Fill from PR #529 is excluded. The current
1.8.0-beta.1 candidate remains separate and newer under SemVer.

## Private native transport rehearsal

`Desktop Update Transport Rehearsal` is a manual main-only workflow taking an
exact candidate tag/build run and an older `from_version`. Its first job uses
the read-only finalizer to verify the complete signed cohort. The Windows x64,
macOS Apple Silicon and Linux x64 jobs then exercise the locked native updater
against those same package bytes over an ephemeral loopback HTTP server.

The opt-in Rust integration test accepts a valid signed download and rejects
corrupted bytes, truncated downloads, stalled bodies, missing platform entries,
malformed manifests, same-version reinstalls and downgrades. The mock Tauri
runtime and loopback URL rewriting exist only in the test target; shipped app
endpoints, URL validation, keys and downgrade policy are unchanged. No installer
is launched, credentials are copied, feed is changed, or release is published.

Local reproduction after read-only finalizer verification:

```powershell
$env:SCROLLR_REHEARSAL_DIR = '<absolute path to release-verify-RUN_ID>'
$env:SCROLLR_REHEARSAL_FROM_VERSION = '1.7.2'
cd desktop/src-tauri
cargo test --locked --test update_transport -- --ignored --nocapture
```

The source version belongs to a mock runtime, not an installed signed app.
Passing this test qualifies transport and signature rejection only. It does not
replace actual source-to-target installation, application restart, preference
retention, shared-controller UI checks, or public HTTPS/CDN endpoint validation.
Those remain separately recorded release gates. Normal `cargo test` compiles
the harness but skips artifact-dependent execution unless explicitly requested.

Supplying both `source_tag` and `source_run_id` also rehearses a real package
transition on disposable GitHub-hosted runners. Both source and target cohorts
must pass finalizer verification first. The runner installs/opens the source,
seeds a synthetic profile with a Beta preference, invokes the native updater's
signed download and installation, independently checks the installed target,
then launches it for 30 seconds and checks retained preferences. Windows NSIS
installation is asynchronous and exits the host, so the external check polls
the actual signed installed executable instead of trusting a successful exit.
macOS verifies the replaced app bundle; Linux verifies the replaced AppImage.

This tests the native installer using a mock updater host with the real source
version. It does not exercise the production shared controller's full install
flow, login, public HTTPS feeds or physical displays. It refuses local and
self-hosted execution and never copies a user's existing profile. Do not run
its prepare/finish script outside this workflow.

For the legacy bootstrap hop only, use `source_tag=desktop-v1.7.2` and
`source_run_id=legacy`. A read-only verifier checks the published release ID,
unchanged Git tag, GitHub asset digests, prior audited package hashes and updater
signatures. Its separate `source-integrity.json` is accepted only as an installed
source, never as target/publication evidence. The destination still requires the
full finalizer. This proves replacement of actual 1.7.2 packages by the current
locked native installer; it does not run 1.7.2's old updater/controller or its live
legacy URL. No general legacy exception is added to the release or feed policy.

## Finalize only after the release decision

Dispatch **Finish Desktop Release** on main with the exact `desktop-v<version>`
tag and, preferably, its build run ID. This workflow **publishes**; do not use it
just to inspect a candidate. The underlying `finalize-release.mjs resolve` and
`verify` commands are read-only and require GITHUB_REPOSITORY, TAG, BUILD_RUN_ID,
GITHUB_OUTPUT (resolve), RUNNER_TEMP (verify), authenticated gh and Minisign.
Use an identity with push access when inspecting drafts. GitHub's release-by-tag
endpoint can return 404 for an unpublished draft; the shared read-only lookup
falls back to authenticated, paginated release listings and re-reads the exact
release ID. Missing Git tags are checked through the Git-ref endpoint, since the
commits endpoint returns 422 for an absent draft tag. Authentication/network
errors remain errors. Build preflight uses this same source-bound draft lookup
on trusted main; unchanged-version pushes skip without rebuilding the draft.

Before publication the finalizer checks:

- Exact source SHA, actual tag resolution (or absent tag for a draft), trusted
  repository/approved branch/workflow/event, and successful completion of that build run.
- One Actions proof per platform, from that exact run, version and source.
- Final downloadable bytes matching the proofs, all required installers,
  canonical URLs bound to that release, and each updater artifact's signature.
- Tag, manifest version and GitHub prerelease flag agreement.

The finalizer uploads `verification.json` before publication. Publication itself
uses `--latest=false`; Stable finalization then runs the existing signed legacy
reconciler under the artifact lock to select the greatest published Stable
SemVer. A delayed older Stable cannot move Latest backward, and published retries
repeat reconciliation. Beta never changes Latest. Stable announcement and KB refresh are separate
downstream jobs; website refresh is another job. A successful dispatch means the
downstream workflow started, not that its deployment or announcement succeeded.
Inspect those runs before declaring the release finished.

Use **Re-run failed jobs**, not Re-run all jobs, after a partial failure. The
published retry path re-verifies bytes and does not replace published assets.
Separate effect jobs avoid re-dispatching already successful siblings on a
failed-jobs retry. A fresh dispatch or rerun-all can still duplicate announcements;
this is not an exactly-once notification system. If an announcement workflow
itself failed after posting, inspect its steps before retrying it.

Build proofs and staged Windows artifacts are retained for 30 days. Failed build
attempts can replace their own staging/proof artifacts under the shared workflow
lock. After evidence expires, use a new candidate version and fresh build; do not
weaken verification or rebuild into a published release. Old drafts without an
exact source SHA are deliberately ineligible for this finalizer.

## Preserve updates for already-installed clients

Older clients use GitHub's generic `releases/latest/download/latest.json` URL.
A newer backend release can steal Latest and leave that URL without a manifest.
The website fallback now links to an explicit stable desktop release tag.

Read-only inspection from the repository root:

```sh
node desktop/scripts/repair-desktop-latest.mjs
```

It prints the current and proposed Latest tags and checks manifest structure.
It does not verify installer signatures until the apply path, and it does not
change GitHub by default. Following explicit approval, a maintainer with gh
write access and Minisign can run the same command with `--apply`. That path
downloads and independently verifies each advertised updater artifact before
changing Latest, then reads Latest back. It never publishes a draft or replaces
installer bytes. It accepts the historical repository owner alias for old URLs.

The release-published guard repeats this protection for non-prerelease events.
GitHub does not start release-event workflows for GITHUB_TOKEN publications:
Finish Desktop Release explicitly reconciles the greatest signed Stable after
publication, including on retries. Any separate
backend publisher using GITHUB_TOKEN must preserve desktop Latest explicitly or
run the repair; an event guard cannot observe a suppressed event.

## Stable support evidence

Beta, draft and backend events cannot announce a stable desktop fix or consume
its shipped-follow-up marker. Manual workflow dispatch re-reads GitHub metadata
and follows the same policy as release events. Desktop Announce/KB entry points
require the finalizer-published verification record and manifest to match current
GitHub asset digests, the successful trusted main build and the actual tag source.
Like support verification, this trusts the authorized finalizer record; it does
not download/reverify all installer signatures again. When channel feeds are
enabled, the entry points also require an unchanged, non-withdrawn approval in
the registry, valid selected release assets, and both public feeds matching that
registry. Direct dispatch cannot bypass failed readiness. Historical releases
without the record fail closed. Backend KB refresh stays a separate policy.

Automatic support claims require a completed Linear issue, an actual merged PR
in this repository with a dedicated affirmative closing line (`Closes SCROLLR-123`,
or its Linear URL/Markdown link), and Git ancestry proving that merge is contained
in the verified stable release. Related mentions and attachment timestamps are
not proof. Current and historical Linear issue identifiers are supported.

The support API trusts the authorized release publisher's `verification.json`.
It checks the record and manifest bytes against GitHub asset digests, verifies
all recorded installer digests and version/platform bindings, resolves the actual
tag to the recorded source, then checks merge containment. It does not independently
query Actions or download every installer. Old releases without this record
produce no automatic shipped-fix claim; staff can still assess them manually.
Follow-ups remain ordinary pending support drafts and are never sent by this gate.

SCROLLR-279 remains separate: suppressing Beta refresh events does not make KB
facts read from main accurately describe an older released desktop app.

## Stable and Beta channels (SCROLLR-424)

Settings → Updates selects Stable or Beta **for this device**. Selection never
downloads or installs. Stable excludes prereleases. Beta selects the highest
approved SemVer from Beta and Stable, so a final release supersedes its betas.
The installed build label is independent of the saved channel preference.

A fresh beta installation defaults to Beta. Existing explicit choices survive
manual installs and updates. A manually installed beta over an existing install
without a channel choice stays on Stable and offers opt-in. Leaving Beta stops
beta offers; an installation ahead of Stable waits for a newer stable release.
There are no automatic downgrades or same-version reinstall offers.

The main window owns one controller for startup checks, Settings and the
required-update overlay. Navigating away retains progress and installed/restart
state. Channel changes invalidate unused offers and are disabled during checks,
installation and pending restart. Failed restarts retry restart without download.
Native manifest checks time out after 20 seconds (25-second outer cancellation);
downloads have a 180-second native request deadline, including the response body.
Failures remain distinct from a verified current version. These limits do not
impose a timer on an OS installer after it has started.

### Feed storage and publication

The fixed native endpoints are `https://raw.githubusercontent.com/doughknee/myscrollr/desktop-updates/stable.json`
and the corresponding `beta.json`. They do not use GitHub Latest or a fallback
endpoint array. Missing feeds fail visibly; they do not certify currency.

The `desktop-updates` metadata branch contains `index.json` (schema 1, approved
release records with immutable manifest/proof bytes and withdrawal flags),
`stable.json`, and `beta.json`. Each selection is a complete verified platform
cohort. The publisher creates one Git tree/commit for all three files, then uses
a non-force ref update against the observed parent. Concurrent changes fail with
a non-fast-forward error; retry reads the new registry before recomputing. An old
finalizer can add its release but cannot move a channel behind a newer approved
one. Equivalent SemVer precedence with different build metadata is rejected.

`release-channels.mjs` is dry-run by default and writes a local plan. It consumes
the same run-bound verification output as the existing finalizer, then rechecks
published status, source/tag and current GitHub asset digests. It refuses partial
cohorts, changed approved bytes, automatic reinstatement of withdrawn releases,
or removal of the last Stable baseline. Withdrawal changes future offers only;
it cannot remove installed software. A broken installed version needs a newer fix.

**Activation is a separate, explicit operation. Nothing in a code merge creates
the metadata branch or enables publishing.** Before first use:

1. Review/merge the prerequisite code, select a new Stable version and build a
   complete signed draft from the reviewed main source. Keep the activation
   switch off. Old releases without run-bound proofs cannot be grandfathered in;
   expired proofs require a fresh candidate, and beta-only bootstrap is refused.
2. Create the exact metadata-branch protection and empty registry using the
   [prepared payloads](../audit/2026-11-03-feed-qualification/READINESS.md).
   Protect against force pushes and deletion while allowing the authorized
   contents-write workflow to fast-forward. Verify effective rules and branch
   content. Do not alter main protection or force an existing metadata ref.
3. Qualify the draft with read-only finalizer `resolve`/`verify`, the exact source
   and run, signatures/notarization, and packaged-app/upgrade rehearsals. Review
   the version, notes, recovery path and evidence. A draft's artifacts cannot be
   advertised by live public feeds. Do not use Finish Desktop Release as a dry-run.
4. Only at the separately approved release/activation boundary, enable
   `DESKTOP_CHANNEL_FEEDS_ENABLED=true`, then run Finish Desktop Release for that
   exact tag/build. It publishes the verified baseline, reconciles legacy Latest,
   approves and commits both feeds, and verifies public bytes before follow-ups.
   Initially both feeds select the approved Stable. Do not publish/announce the
   channel-only baseline first with the switch off and promise to activate later.
5. Verify public feed access from Windows, macOS and Linux before inviting testers.
   Qualify real Stable→newer Stable, Stable→Beta, Beta→newer Beta/Stable, leaving
   Beta while ahead, interrupted download, invalid signature, restart failure and
   preference retention. A branch artifact installing is not a version-to-version
   upgrade test. Any uncompleted OS checks remain explicit launch gates.

This is the canonical first-activation order. For an already-published baseline
or recovery, Reconcile Desktop Update Feeds may first run with `apply=false` to
review its exact plan, then with explicitly authorized `apply=true`; that is not
an alternative first-launch order. Both flows verify published approval evidence
and public bytes. A failed public check can be retried without republishing or
replacing signed assets.

Once enabled, Finish Desktop Release advances both feeds after publication and
verifies both public URLs against the exact plan before release follow-ups. The
read-only check allows up to seven minutes for CDN convergence and never uses
authentication or a cache-busting URL. An atomic Git commit does not imply
simultaneous global cache visibility. A feed failure leaves the published release intact
and follow-ups blocked. A failed metadata write preserves existing feeds; a failed
public check may occur after the new metadata is committed. First activation has
no previous feeds to fall back to. Resolve the cause and rerun failed jobs.
The standalone reconciliation workflow can retry an approval, withdraw one
tag, or recompute feeds. It defaults to dry-run and shares the build/finalizer
artifact lock. Approval and withdrawal must be separate actions.

The legacy Latest repair remains separate for already-installed older clients.
Do not retire that route when channel feeds are enabled. Never use a test run to
publish a release, enable the variable, write metadata, or enroll a tester.

For read-only pre-activation evidence, run `node desktop/scripts/qualify-release-feeds.mjs
--out desktop/test-results/feed-qualification` from the repository root. This
collects actual host/cache/protection/build-proof state and independently verifies
the existing Stable packages. It does not approve historical releases or activate
anything. The [prepared activation packet](../audit/2026-11-03-feed-qualification/READINESS.md)
distinguishes completed checks from the baseline and live-host gates.

## Local verification

Run the release-policy Node fixtures, both frontend test suites/builds, support
and core Go tests against a disposable database, native desktop checks/tests,
and actionlint for workflow edits. Policy fixtures use synthetic artifacts and
an injected signature verifier; they test refusal rules, not real package signing.
Real signed install/update tests remain a candidate qualification gate.
