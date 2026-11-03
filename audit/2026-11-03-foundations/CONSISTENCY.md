# Consistency review — release/update foundations

Reviewed 2026-11-03. Scope: current Go support proof/follow-up diff, release webhook, and release-event policy. Read-only review; no production calls, drafts, messages, workflow dispatches or Linear edits. Root owns test execution and product edits. Locations below describe the reviewed snapshot; root may address them while review is in progress.

## Findings

### C1 — P1: A related PR is still treated as the closing fix

Locations: `api/internal/support/proven_fix.go:165-178`; `api/internal/support/release_proof.go:57-73`.

`linearClosingMerge` accepts every `sourceType=github` attachment and chooses the latest GitHub-verified merged PR. `closingPull` validates repository, merge timestamp and SHA, but never establishes that this PR closes this particular issue. A completed issue with an attached investigation/reference/partial PR, and no merged closing PR, therefore gets a positive fix record when that attached PR is contained in a release. A later related PR can also replace the real closing PR and incorrectly change the reported fixed version. This is an inherited gap retained in the new stronger proof contract, not a newly introduced attachment behavior.

Fix: query the issue's current identifier and require an explicit exact closing relation from trusted GitHub PR metadata (for example a supported Closes/Fixes/Resolves reference to the current identifier or stored legacy identifier). Plain related mentions must not count. No canonical Linear closure parser or richer attachment metadata contract was found in api, .github, docs or .claude. The osTicket `[fixes #NNN]` parser in `.github/workflows/auto-close-osticket.yml:45-57` addresses different identifiers and should not be reused blindly. Current production PR wording was not inspected; requiring explicit closure may conservatively withhold old fixes lacking that evidence.

### C2 — P1: Installer presence is not bound to the claimed release version

Locations: `api/internal/support/release_proof.go:76-89`, `api/internal/support/release_proof.go:119-136`; evidence fixture `api/internal/support/proven_fix_test.go:82-87`.

`hasDesktopInstallers` checks only filename suffixes plus the existence of a file named latest.json. A release tagged desktop-v1.8.0 containing Scrollr_1.6.3 installers and an old/empty manifest passes. If the tag contains the closing merge, the bot may then claim a fix that its downloads do not deliver. The existing fixture itself supplies 1.6.3 installer names for every tag, including the positive 1.6.2 case. The finalizer's manifest/source/binary checks are stronger, but support does not establish that the publication passed that finalizer; manual publication is still an event path.

Fix: bind expected installer names and valid updater manifest version/platform URLs to this release, or consume independently verified publication provenance that binds the binaries to the source. At minimum reject mismatched-version assets and incomplete/foreign-target manifests. Add negative fixtures before trusting the new proof predicate. This review does not claim a currently published release has mismatched binaries.

### C3 — P2: Admin explanation claims facts that the new proof no longer establishes

Location: `api/internal/support/handlers_admin_console.go:178-185`.

After a nil proof, any merged PR produces “no published release has gone out since.” The nil may instead mean GitHub comparison failed, a release lacks installers, or published releases do not contain the merge. The new hotfix-without-feature fixture is a direct example where a newer published release exists. The error branch also labels failures from `closingPull` as unreachable Linear.

Fix: describe the actual uncertainty (“no available stable release containing the closing merge could be verified”), or return typed proof failure reasons. Identify upstream verification failures without attributing every one to Linear. Positive wording should state containment rather than only chronology.

### C4 — P3: Obsolete timestamp selector survives as test-only product code

Locations: `api/internal/support/proven_fix.go:218-231`; `api/internal/support/proven_fix_test.go:235-255`.

`firstReleaseAfter` no longer has a production call site. `rg` over api found only its definition and its own test; no string-based invocation applies to this unexported Go function. The old test still calls it the whole “which version carried it” rule, which conflicts with the new containment contract and gives a misleading maintenance signal.

Fix: remove the orphan helper and its timestamp-only test; keep coverage on computeProvenFix and releaseContains.

## Verified invariants and limits

- GitHub compare requires ahead/identical, the requested base SHA, and the same merge-base SHA. This correctly rejects a release from a diverged hotfix branch that does not contain the closing merge.
- PR URLs are constrained to github.com, repository path and positive PR number. The actual canonical repo is checked in GitHub's response; SHA must be 40 lowercase hex characters.
- Stable tag gating rejects beta/rc/backend tags before follow-up DB work. A stable-shaped tag falsely marked prerelease is rejected by fetched publication metadata. Follow-ups use the fetched canonical release URL.
- No beta path found that reaches draft creation or the stable follow-up marker. The webhook returns ignored before the goroutine for beta tags; the drafting function independently rechecks actual publication.
- Cache namespace advances v1 to v2, so old chronology-only positive proofs are not reused after deployment. Existing ten-minute positive and negative caching remains; no event invalidation was found for reopening an issue or withdrawing release assets. That bounded staleness is inherited, not asserted here as a new regression.
- The release-event policy and API agree on normal stable/beta/backend announcement handling. KB workflow intentionally admits published backend releases; it rejects prereleases. Live known-issues/public-release context still includes prerelease notes because fetchRecentReleases filters only Draft. It explicitly forbids treating those notes as fix proof, so no stable-marker violation follows; labeling/filtering beta context is a separate policy choice.
- Release-list HTTP errors still collapse to nil and can cache a negative proof for ten minutes. This is inherited availability behavior, despite comments describing all lookup errors as uncached.
- No dependency/token/UI audit was expanded outside the requested diff. No missing deferred beta channel UI is reported as a defect.

## Ranked cleanup priorities (up to ten, without inventing findings)

1. Require an exact closing issue relation before accepting a merged PR (C1).
2. Bind platform assets/manifest to the claimed release version and source (C2).
3. Make the admin explanation reflect containment and verification uncertainty (C3).
4. Remove the timestamp-only helper and test to keep one proof model (C4).

Only four actionable findings were identified in the assigned scope. Root will execute Go tests with the isolated database; this report's evidence is source/fixture inspection, not a claim of executed integration tests.

## Re-review after remediation

Reviewed current changes again on 2026-11-03. C3 is resolved by neutral unavailable-evidence/containing-release explanations. C4 is resolved: the timestamp helper and its test are gone. C2 is substantially resolved: version-exact installers, a verification record, GitHub asset digests, manifest version/target URLs, actual tag SHA and source containment now fail closed when evidence is missing or mismatched. Old releases without verification.json correctly produce no automatic fix claim. GitHub release writers remain the trust boundary for the published verification record; the API does not independently establish the record's workflow-run provenance. No currently published artifact was accessed.

C1 is improved: the current Linear identifier and stored legacy key are passed to a GitHub title/body closing-reference check. Plain related mentions and longer numeric identifiers are rejected. One remaining concrete false-positive is below.

### C1 follow-up — P1: Negated or partial closure prose still counts

Location: `api/internal/support/release_proof.go:50-60` (`closesIssue`).

The regex searches anywhere in the PR title/body, so “This does not fix SCROLLR-419” and “This only partially fixes SCROLLR-419” both match the affirmative keyword alternative. An attached merged partial/investigation PR with that explicit disclaimer can still be treated as the closing fix.

Fix: recognize dedicated affirmative closing directives, anchored to their own line (optionally a bullet), and reject surrounding prose; treat unsupported phrasing as no proof. Add negated, partial and quoted-reference negative fixtures. This is safer than attempting general natural-language interpretation.

### C5 — P1: macOS build proof uses a different name from the uploaded artifact

Locations: `desktop/scripts/release-policy.mjs:99-102` (recordProof's basename key), `desktop/scripts/release-policy.mjs:125-126` (validateArtifacts' same-name lookup); caller `.github/workflows/desktop-release.yml:564`.

The build records local `bundle/macos/Scrollr.app.tar.gz`. tauri-action v0 uploads those bytes under `Scrollr_aarch64.app.tar.gz`: its build.ts reads the unqualified local filename, and getAssetName in utils.ts adds the architecture for app tarballs. Thus a normal macOS proof will contain `Scrollr.app.tar.gz`, while release.assets contains `Scrollr_aarch64.app.tar.gz`; finalization fails with “Missing built artifact Scrollr.app.tar.gz”. The Go support gate expects the correct uploaded filename. Current fixtures manually construct proof names using uploaded names and therefore hide this failure.

Fix: in recordProof, map the darwin-aarch64 tarball proof key to the uploaded architecture-qualified name while hashing the original local path. Add a recordProof test with a realistic local `Scrollr.app.tar.gz` and final uploaded name. Preserve the byte hash and reject duplicate keys.

Primary-source verification (public upstream source only): [tauri-action v0 build.ts, macOS artifact construction](https://raw.githubusercontent.com/tauri-apps/tauri-action/v0/src/build.ts) lines 114-125; [tauri-action v0 utils.ts, getAssetName](https://raw.githubusercontent.com/tauri-apps/tauri-action/v0/src/utils.ts) lines 95-125; [upload-release-assets.ts](https://raw.githubusercontent.com/tauri-apps/tauri-action/v0/src/upload-release-assets.ts) lines 41 and 75-80 uses that generated name with the original file bytes.

Current ranked priorities: fix C5's deterministic macOS finalization failure; finish C1's strict affirmative closing directive; retain current negative evidence tests and independently test legacy identifier resolution. Product files remain unchanged by this reviewer.

## Final remediation verification

Re-reviewed the final fixes on 2026-11-03. All five consistency findings (C1-C5) are resolved in the reviewed source.

- C1: `closesIssue` now anchors an affirmative closing directive at the start of a line, optionally preceded by a list bullet. Tests explicitly reject unrelated, longer-number, negated, partial and blockquoted mentions. Current/legacy identifier matching remains supported.
- C2: version-exact installer names, digest-bound verification and manifest records, platform-specific artifact URLs and actual tag/source containment remain required. Legacy releases without verification.json fail closed by design. Documentation states that authorized release publishers are the verification record's trust boundary.
- C3: admin explanations distinguish unavailable/unestablished evidence rather than claiming no release exists.
- C4: the obsolete timestamp helper and its test remain removed.
- C5: `recordProof` now hashes the local macOS archive under the architecture-qualified uploaded key. The added direct recorder fixture creates local `Scrollr.app.tar.gz`, asserts the hash under `Scrollr_aarch64.app.tar.gz`, and asserts the local-only name is absent. This matches the reviewed tauri-action upload naming behavior.

The release runbook documents the conservative closure convention and legacy-proof limitation. This final pass inspected source and test assertions; root owns executed suite results and future signed packaging/runtime acceptance. No product files were changed by this reviewer. No additional unresolved finding was identified in this bounded re-review.
