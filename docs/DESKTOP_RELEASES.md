# Desktop release and update foundations

The existing Desktop Release workflow builds Windows x64, macOS Apple Silicon,
and Linux x64. Finish Desktop Release is the explicit publication boundary.
This foundation does not add beta enrollment, channel manifests, a new app,
or a second backend. Those are separate work under SCROLLR-299.

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
facts read from main accurately describe an older released desktop app. Shared
update-controller lifecycle, channel opt-in/exit, update timeouts and diagnostics
also remain later work. No Stable user is enrolled in Beta by these changes.

## Local verification

Run the release-policy Node fixtures, both frontend test suites/builds, support
and core Go tests against a disposable database, native desktop checks/tests,
and actionlint for workflow edits. Policy fixtures use synthetic artifacts and
an injected signature verifier; they test refusal rules, not real package signing.
Real signed install/update tests remain a candidate qualification gate.
