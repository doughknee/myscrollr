# Desktop release and update foundations

The existing Desktop Release workflow builds Windows x64, macOS Apple Silicon,
and Linux x64. Finish Desktop Release is the explicit publication boundary.
Stable/Beta feeds and device-local enrollment extend this same app and release
pipeline. There is no second app, backend, account, or entitlement system.

## Current implementation boundary

The desktop version remains 1.7.2. Implementing this foundation does not publish
a release or repair the live legacy update URL. The legacy repair below is a
separate production metadata change. No tester build is qualified by unit tests.

The native updater is pinned to 2.13.3 and application configuration forbids
downgrades. Its required Tauri dependency update raises the Rust minimum to 1.90.
Do not weaken that policy to implement Beta exit: a lower stable version requires
a separately designed recovery path. Full SemVer governs minimum-version checks
and release history; malformed minimum-version policy fails open.

## Build a candidate after approval

1. Use a reviewed main commit with a new, consistent version in desktop
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

## Finalize only after the release decision

Dispatch **Finish Desktop Release** on main with the exact `desktop-v<version>`
tag and, preferably, its build run ID. This workflow **publishes**; do not use it
just to inspect a candidate. The underlying `finalize-release.mjs resolve` and
`verify` commands are read-only and require GITHUB_REPOSITORY, TAG, BUILD_RUN_ID,
GITHUB_OUTPUT (resolve), RUNNER_TEMP (verify), authenticated gh and Minisign.

Before publication the finalizer checks:

- Exact source SHA, actual tag resolution (or absent tag for a draft), trusted
  repository/main workflow/event, and successful completion of that build run.
- One Actions proof per platform, from that exact run, version and source.
- Final downloadable bytes matching the proofs, all required installers,
  canonical URLs bound to that release, and each updater artifact's signature.
- Tag, manifest version and GitHub prerelease flag agreement.

The finalizer uploads `verification.json` before publication. Stable becomes
GitHub Latest; Beta does not. Stable announcement and KB refresh are separate
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
Finish Desktop Release sets Latest explicitly for stable releases. Any separate
backend publisher using GITHUB_TOKEN must preserve desktop Latest explicitly or
run the repair; an event guard cannot observe a suppressed event.

## Stable support evidence

Beta, draft and backend events cannot announce a stable desktop fix or consume
its shipped-follow-up marker. Manual workflow dispatch re-reads GitHub metadata
and follows the same policy as release events.

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

1. Qualify a complete, signed Stable baseline using the existing finalizer. Old
   releases without run-bound proofs cannot be silently grandfathered in. If
   current proofs have expired, build a newly versioned Stable candidate after
   release approval. A beta-only bootstrap is deliberately refused.
2. Create the metadata branch with `index.json` containing
   `{"schema":1,"releases":[]}`. Protect it against force pushes and deletion;
   restrict changes to trusted release maintainers/workflows. The chosen protection
   must allow the authorized contents-write workflow to fast-forward this branch
   (not require an impossible GITHUB_TOKEN bypass of a pull-request rule). The
   publisher refuses to create an unprotected branch or force a ref.
3. Run **Reconcile Desktop Update Feeds** with the published Stable tag/build run
   and `apply=false`. Review all three plan files and both selected versions.
   Approval re-downloads the Actions proofs and independently verifies signatures.
4. After approval, set repository variable `DESKTOP_CHANNEL_FEEDS_ENABLED=true`
   and run the same reconciliation with `apply=true`. This is a live metadata
   change. Verify both raw URLs without authentication, correct content and cache
   behavior from supported hosts before distributing a client that uses them.
5. Qualify actual signed upgrades on Windows, macOS and Linux: Stable→newer Stable,
   Stable→Beta, Beta→newer Beta/Stable, leaving Beta while ahead, interrupted
   download, invalid signature, restart failure, and preference retention. A
   branch artifact installing successfully is not proof of version-to-version updates.

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
