# Feed activation preparation — 3 November 2026

**Preparation completed; not ready to activate today. No live changes made.**

SCROLLR-425. Prepared on `codex/feed-qualification` from the tested channel commit
`6846f60039dce1a4358986e67b899f0011d714bc`. PR530 and PR531 remain open. Their
heads and the installed test build were left intact.

## Verified evidence

| Area | Result | Limit |
| --- | --- | --- |
| Public host | Raw GitHub HTTPS control file returned 200 without authentication; matching ETag returned 304 | This tests the intended host, not nonexistent live feeds |
| Cache | Control response advertises max-age=300; missing feed responses have an expiry about five minutes later | Observed from this machine; no guarantee of a global five-minute propagation bound |
| Actual feed URLs | Stable and Beta both return 404 | `desktop-updates` branch does not exist |
| Protection | Effective rules for the proposed branch are empty | Only main has an active ruleset today; metadata ruleset payload is prepared, not applied |
| Activation switch | `DESKTOP_CHANNEL_FEEDS_ENABLED` is absent | Nothing enabled |
| Existing stable release | 1.7.2 tag resolves to its recorded source; six updater packages match GitHub digests and verify with the app's public key | Integrity check only, not new publisher approval |
| Stable build proof | Neither matching successful build run has proof artifacts; release has no verification.json | No eligible Stable baseline exists under the new contract |
| Publisher rehearsal | CLI dry-run, atomic update, stale-race refusal, missing/unprotected branch refusal and idempotent retry passed | Local fake GitHub in a container with networking disabled; no production ref was written |
| Public visibility gate | Exact-byte check waits through stale/negative cache, rejects HTTP/network/wrong-byte failures and has a bounded deadline | Added locally to run after metadata updates and before announcements; not deployed |
| Legacy updates | Generic Latest still points to server-2026.10.26.4 and its manifest URL returns 404 | Separate SCROLLR-414 repair remains unapplied |

Machine-readable details, hashes and request headers: `qualification.json`.
Windows installer Authenticode checks: `windows-authenticode.json`. Native macOS
notarization and actual OS installation/upgrade behavior are not claimed here.

The existing 1.7.2 release's successful runs are 39991274744 and 39991271920,
both at source `631d7826b815332ffd2e6baf523f609ce98db3bf`. Missing proof is not
the same as a bad signature. It prevents claiming that today's downloaded bytes
are those measured by a particular trusted build. No proof was reconstructed or
invented, and no synthetic test manifest is included in the activation packet.

## Concrete activation packet

- `metadata-ruleset.request.json`: exact branch match, active deletion and
  non-fast-forward protection, no bypass actors. No pull-request requirement on
  this metadata-only branch: the contents-write finalizer must fast-forward it.
- `bootstrap-tree.request.json`: a standalone tree containing only an empty
  schema-1 approval registry. No application code, feed manifests or workflows.
- `desktop/scripts/qualify-release-feeds.mjs`: GET/download/verification only;
  repeatable inventory and existing-package integrity checks. It has no apply mode.
- `desktop/scripts/verify-release-feeds.mjs`: public URL byte verification against
  the publisher's exact plan; no authentication or cache-busting URL. Both feeds
  must match during a successful round. Default deadline is seven minutes.
- `desktop/scripts/release-channels-cli.test.mjs`: isolated publisher rehearsal.

The protection payload prevents force pushes and deletion. It does **not** make
the branch writable only by one workflow. Trusted repository writers and approved
contents-write workflows retain normal write access. A separate service identity
is not introduced. Verify the actual workflow can write under the selected rules
at activation; administrator access alone is not proof of GITHUB_TOKEN access.

GitHub documents that effective branch rules can be inspected before a branch
exists, and that a non-force ref update rejects non-fast-forward replacement:
[branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch),
[Git references](https://docs.github.com/en/rest/git/refs#update-a-reference).

## Ordered execution after explicit merge/release/activation approval

These steps are prepared instructions, **not authorization to execute them**.

1. Merge the reviewed foundation and channel work in dependency order, including
   this qualification follow-up. Rebase as needed after squash merges and rerun
   checks on the resulting main source. Review the chosen new Stable version;
   do not overwrite 1.7.2 or treat the same-version Windows branch artifact as a
   cross-platform baseline. Under the current policy, the first baseline must be
   a newly versioned, fully qualified Stable release. If a Beta-first launch is
   required instead, stop for an explicit baseline-policy decision—do not invent
   historical build proofs or silently weaken verification.
2. Create the proposed metadata ruleset using its reviewed JSON; read effective
   rules back with `gh api repos/doughknee/myscrollr/rules/branches/desktop-updates`.
   Require deletion and non_fast_forward rules, no blocking update/PR rules, and
   confirm the branch is still absent. Do not alter main's rules.
3. Create a Git tree from `bootstrap-tree.request.json`, then a root commit with
   that returned tree SHA, a descriptive bootstrap message and `parents: []`.
   Create `refs/heads/desktop-updates` pointing to that commit. Creation must fail
   if the ref already exists; never overwrite or force it. Read branch protection,
   its SHA, and the exact empty index back. Keep the activation switch off.
4. Build all supported targets (Windows x64, macOS arm64, Linux x64) from the
   reviewed main source into a new draft. Verify exact source/run/target proofs,
   final asset hashes, updater signatures, Windows signing and macOS notarization.
   Perform packaged-app and upgrade rehearsals. Review the actual version, notes,
   source SHA and run ID. A draft is not eligible for public feed advertisement.
5. Run the read-only finalizer `resolve` and `verify` commands for that exact
   tag/run, with a fresh local RUNNER_TEMP and GITHUB_OUTPUT. Keep the resulting
   verification and manifest together. Missing or expired proofs require a new
   candidate; no bypass. The first real channel plan can only be completed after
   the chosen baseline is published; no valid live plan can be manufactured today.
6. At the separately approved release boundary, enable the activation variable
   only after steps 2–5 pass, then use Finish Desktop Release for that exact tag
   and run. It publishes the verified baseline, computes both channel files,
   commits index/Stable/Beta together, and checks the public bytes before allowing
   follow-up jobs. Initially both feeds point to the approved Stable baseline.
   Recheck both public URLs from Windows, macOS and Linux before inviting testers.
7. For a subsequent Beta, build/qualify a complete new prerelease cohort, review
   its notes and recovery path, then approve publication. Stable must remain on
   the approved final release; Beta selects the highest approved Beta or Stable.
   Choosing Beta never itself installs. Test leaving Beta while ahead of Stable.

Use a fresh operator directory for each preparation. The optional standalone
Reconcile Desktop Update Feeds workflow defaults to `apply=false`; its approval
path re-verifies published release artifacts. Do not use Finish Desktop Release
as a dry-run. A live manifest cannot point to a draft's inaccessible assets.

## Failure and recovery

- Metadata write fails: existing feeds remain; published release assets stay
  immutable. Inspect failure, then rerun only failed jobs. A race requires reading
  the latest registry and recomputing; never force the ref to an older snapshot.
- Public byte verification fails after a successful ref update: registry/feeds
  may already be committed, but announcements are blocked. Check cache/network
  behavior and rerun read-only verification. If necessary rerun reconciliation;
  identical approval is idempotent. Do not republish or replace installer bytes.
- Atomic commit does not imply simultaneous global CDN visibility. One URL can
  temporarily serve an older complete cohort. Clients still enforce newer-only
  installs. Negative cache can keep a previously absent feed unavailable briefly.
- Bad approved Beta: explicitly withdraw it using reconciliation. Do not delete
  its assets or force-reset the branch. Existing installations are not rolled back;
  ship a newer fix. Withdrawal cannot remove the final Stable baseline.
- Preserve and separately repair legacy Latest for older installed clients.
  Channel activation alone does not repair that route.

## Reproduce without publishing

From the repository root (gh authenticated, Node and Minisign available):

```powershell
node desktop/scripts/qualify-release-feeds.mjs --out desktop/test-results/feed-qualification
docker run --rm --network none -v "${PWD}:/src:ro" -w /src/desktop node:22-alpine node --test scripts/release-policy.test.mjs scripts/release-channels.test.mjs scripts/release-channels-cli.test.mjs scripts/verify-release-feeds.test.mjs
```

The rehearsal's simulated apply mode talks only to a temporary fake CLI with
networking disabled. It does not touch GitHub. Downloaded package files stay in
ignored test-results; only public evidence and prepared request payloads are
committed. No merge, ref/ruleset write, variable change, release, installed-app
replacement, deployment or customer message was performed in this phase.
