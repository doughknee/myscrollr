# Security review — release/update foundations

Scope: current uncommitted release workflows and `desktop/scripts/{release-policy,finalize-release,release-event,repair-desktop-latest}.mjs`, plus the updater config/dependency changes. Read `INVENTORY.md` and the complete security lens. No production calls, workflow dispatch, publication, contact, or product-file edits were performed.

## Findings

### SEC-1 — Resolved (originally High / P1): Release source proof does not resolve the Git tag

**Location:** `desktop/scripts/finalize-release.mjs:12–13` (also build preflight `.github/workflows/desktop-release.yml:118–119`).

The finalizer treats the release object's `target_commitish` as the resolved release source, then matches the build run/proofs against it. It never resolves the actual `refs/tags/<tag>`. These are distinct values: GitHub documents that `target_commitish` is unused when the tag already exists. A retained/mistaken tag pointing to commit B can coexist with draft metadata naming build commit A. Complete valid A artifacts then pass this finalizer while the published tag/changelog and support containment proof identify B. This defeats the intended source-to-release binding even though the artifacts themselves are signed.

**Concrete reproduction:** In an isolated repository or mocked API, provide draft `desktop-v1.8.0` with `target_commitish=A`, a successful main build and all proof hashes for A, and an existing tag `desktop-v1.8.0` resolving to B. The script never reads the tag ref, so nothing rejects B. This was established by tracing all finalizer API calls, not by modifying a live release. GitHub behavior verified against [Create a release documentation](https://docs.github.com/en/rest/releases/releases#create-a-release).

**Fix:** Resolve/peel any existing tag to its commit, compare it to the exact build SHA, and fail on mismatch before reruns/publication. If the tag does not yet exist for the draft, explicitly handle that case using the exact draft target and ensure the publication creates the expected tag. Repeat the check at the publish boundary; record the actual tag commit in evidence.

### SEC-2 — Resolved (originally Medium / P2): URL-prefix validation accepts paths outside the verified tag

**Locations:** `desktop/scripts/release-policy.mjs:128–131`; `desktop/scripts/repair-desktop-latest.mjs:22–25`.

Raw-string `startsWith` validation precedes URL normalization. For example, `https://github.com/doughknee/myscrollr/releases/download/desktop-v1.8.0/../desktop-v0.0.1/Scrollr_1.8.0_amd64.AppImage` passes the prefix test, and its final basename matches a verified local asset. The URL parser/client resolves the request under `desktop-v0.0.1`, so the finalizer publishes an updater manifest whose actual download is outside the validated release. It can 404 or fail signature verification for clients. The legacy repair can similarly promote such a broken manifest.

**Concrete reproduction:** Ran the existing fixture suite via stdin, replacing only the `wrong URL` scenario's URL with the example above. Result: 14 tests passed; the wrong-URL case failed with `Missing expected rejection`, confirming `validateArtifacts` accepted it. No source files were changed. Existing ordinary wrong-host URL fixture rejects correctly.

**Fix:** Require exact canonical origin and pathname for the expected repository/tag and one encoded asset filename; reject extra path components/dot traversal, including encoded forms. Use the same helper in legacy repair. Add negative tests for literal and percent-encoded dot segments and extra nested paths. This is a binding/availability failure; independent signature checking still prevents arbitrary replacement bytes from being accepted, so code execution was not demonstrated.

## Surface coverage

| Surface | Result |
|---|---|
| Platform configuration | New `allowDowngrades: false` strengthens update policy. No scoped CSP/capability expansion found; generated updater schemas add SDK definitions, not a new capability grant. |
| Native/IPC | No new UI-callable native command in this change. Existing app command audit is outside this diff-only inventory. |
| Injection | Scoped scripts use argument-array `execFileSync`, not a shell; tag/run outputs are validated before workflow use. Release notes pass through files and `jq --arg`/`--rawfile`. No new HTML/SQL/eval surface. URL canonicalization defect is SEC-2. |
| Secrets | Build signing credentials remain CI environment inputs. New finalizer uses public updater key; hashes/proofs do not contain credentials. No new hardcoded secret observed. Whole-history secret scanning is outside the supplied diff-only inventory. |
| Release callbacks | Announcement/KB guards fetch current release state and reject drafts/prereleases. Product webhook authentication/containment is assigned to the consistency reviewer; not duplicated here. |
| Network | Scoped script URLs bind to HTTPS GitHub; independent Minisign validates final downloaded updater bytes. AppImage tool pin includes SHA-256. Arbitrary URL fetching is not introduced; SEC-2 weakens path binding. |
| Permissions/races | Build main gate and successful same-repository/source/event run checks are present. Build and publish share a concurrency group, acquired after build reruns complete. This serializes these workflows, not manual API/UI release writers; no external-writer race was exercised. |

### Scoped command entry points

| Entry point | Verdict |
|---|---|
| `release-policy version` | Read-only local version identity validation. |
| `release-policy record <target> <dir> <out>` | CI-only filesystem hash/proof write; target/source/run validated. |
| `release-policy verify-signature <file>` | Local independent Minisign verification; argument-array process invocation. |
| `finalize-release resolve` | Reads draft/run metadata and emits validated outputs; SEC-1. |
| `finalize-release verify` | Downloads current draft assets and bound run proofs, validates hashes and signatures; SEC-1/SEC-2. |
| `release-event announce/kb` | Reads actual release state and emits eligibility/body files; no new executable-content interpolation. |
| `repair-desktop-latest` | Default dry-run; `--apply` verifies signatures then changes Latest metadata; SEC-2. |

## Verification and limits

- Existing Node release-policy fixtures: 15/15 passed.
- In-memory dot-path adversarial variant: 14/15 passed; expected rejection failed, confirming SEC-2.
- `npm audit --omit=dev --json`: zero vulnerabilities.
- Full desktop `npm audit --json`: five moderate package entries from two advisories (`glob` abort cancellation, `minimatch` glob amplification), zero high/critical. They are in the existing Sentry build-plugin chain, not the new SemVer dependency. No user-controlled glob path was identified in the scoped changes; no new actionable finding asserted from this output.
- `cargo audit --json` could not run because cargo-audit is not installed. No tool was installed and no claim of Rust advisory clearance is made.
- Signed cross-platform CI packaging and live publication were intentionally not executed. Existing 15 fixtures stub signature verification, so they prove policy behavior, not real signer interoperability.

## Summary

| Severity | Findings |
|---|---|
| High / P1 | SEC-1 resolved on re-review |
| Medium / P2 | SEC-2 resolved on re-review |
| Critical / Low | None established in scoped review |


## Fix re-review

Re-read current finalizer/policy/legacy repair, `finish-release.yml`, `api/internal/support/release_proof.go`, and evidence fixtures. No concrete remaining security blocker established within the stated trust boundary of authorized GitHub release publishers and Actions proofs.

- SEC-1 is resolved: finalizer reads `/commits/refs/tags/<tag>` and compares the resolved commit to the exact source SHA. Missing tag is allowed only for a draft; a published release requires the actual tag. The publish job performs this verification after acquiring the build/publish lock. Backend evidence separately checks the actual tag against `proof.source`.
- SEC-2 is resolved: shared URL helper requires a canonical URL, exact origin, exact seven path segments and matching repository/tag, with no credential/query/fragment or slash-containing filename. Legacy repair uses this helper too. Literal and encoded traversal fixtures reject.
- Published `verification.json` records final binary hashes and the `latest.json` hash; only the verified draft path uploads it. The backend validates the record's own GitHub asset digest, checks all claimed hashes against current GitHub asset digests, verifies required installers and manifest target bindings, then resolves the Git tag/source and merge containment. Missing historical proof fails closed.
- Backend intentionally trusts the authorized publisher's verification record; it does not independently download Actions proof artifacts or re-run Minisign. Under the parent-specified trust boundary this is not a remaining defect. A compromised authorized release publisher remains outside that boundary.
- Node release-policy tests now pass **18/18**, including source-tag mismatch, missing published tag, URL normalization and published retry coverage. Go verification tests were inspected; I did not independently rerun them in the shared backend container. No production read/write or release workflow was performed.
