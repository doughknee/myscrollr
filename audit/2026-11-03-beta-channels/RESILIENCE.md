# Beta update resilience and UI state review

Read-only review of the in-progress SCROLLR-424 implementation. No app restart, native installation, publication, or live metadata mutation was performed.

| Source | Network loss | 429 | 500 / malformed | Auth expiry | Suspend / resume |
| --- | --- | --- | --- | --- | --- |
| Stable/Beta raw GitHub manifest | OK: native deadline, explicit error, manual retry | OK: no automatic retry loop | OK: parser/target errors fail closed | OK: public unauthenticated feed | OK by source inspection: one operation, no polling backlog |
| Signed installer download | OK after R2 fix: bounded request and actionable error | OK after R2 fix | OK after R2 fix: signature rejection prevents install and surfaces error | OK: public assets | OK by source inspection: deadline includes response body, no competing operation |
| Local update-channel store | OK after R1 fix (disk failure rather than network) | N/A | OK after R1 fix | N/A | OK after R1 fix: partial write restored or rollback failure reported |
| GitHub release history | Existing unchanged handling; outside changed controller path | Existing unchanged handling | Existing unchanged handling | Public endpoint | Existing component cancellation |
| GitHub approval metadata and Actions artifacts | Fail closed via bounded gh requests; publication review owned by security lens | Fail closed; rerun required | Validation/refusal; no blind retries | Authorized workflow token failure stops publication | Actions job rather than desktop lifecycle |

## R1 — RESOLVED (originally P1): Failed preference save leaves a different channel in the native store

References: `desktop/src/lib/updateController.ts:16`, `desktop/src/lib/updateState.ts:85`, `desktop/src/lib/store.ts:98`.

The adapter calls `setStorePersisted`, which mutates the JS cache and native store before awaiting disk save. If native `set` succeeds but `save` rejects, `selectChannel` reports an error and retains the prior channel in the controller, but the shared native value already contains the new channel. An unrelated subsequent settings save, a successful store autosave, or clean store shutdown can persist that value. On restart, `readStoreShared` enrolls the app in the new channel despite the failed-selection UI.

Verification: mock the actual store adapter so `set` changes an in-memory map, the first `save` rejects, and a later save succeeds. Initialize Stable, select Beta, verify the controller remains Stable while the map contains Beta, then initialize a second controller from that map; it becomes Beta. The existing `saveChannel` rejection test mocks the dependency before its partial mutation, so it does not cover this. The pinned native store 2.4.2 confirms `Store::set` mutates memory then triggers autosave (`store.rs:455`), with default 100ms autosave (`store.rs:68`).

Suggested fix: implement channel preference persistence with rollback of the old native/cache value on save failure, and surface an indeterminate persistence state if rollback itself cannot be completed; add an adapter-level partial-write failure test.

## R2 — RESOLVED (originally P1): User-started download/install failures silently dismiss the update toast

Reference: `desktop/src/hooks/useStartupUpdateCheck.ts:31`.

The error branch always dismisses the toast to keep automatic startup check failures quiet. The same branch handles a user clicking Update in the available-version toast and then encountering a timeout, signature rejection, or installation error. In that path the loading toast simply disappears and the current page shows no explanation or retry action. Recovery exists only if the user independently finds Settings > Updates, contrary to the purpose of the shared user-facing flow.

Verification: initialize an available offer, click the toast's Update action, reject `candidate.download` with a timeout or invalid-signature error, and observe the hook calls `toast.dismiss` rather than `toast.error`. The controller correctly retains the error; the regression is its presentation.

Suggested fix: distinguish silent automatic-check failures from user-started download/install failures and show the latter with an actionable error toast that opens Updates or retries checking.

## Confirmed protections

- The operation lock is established before subscribers are notified. Concurrent checks share the operation; downloading/installing and ready-to-restart states reject channel changes and new installs.
- Candidate invalidation increments offer identity and closes native resources; a stale toast cannot install a replacement candidate.
- Stable refuses prereleases, all offers must be strictly newer, and leaving Beta waits for a newer Stable release.
- A minimum version is checked during candidate acceptance and again before downloading; too-old offered builds are not installed.
- Restart rejection preserves ready state, so recovery does not redownload an already-installed update.
- Native updater request timeout is passed through plugin download into reqwest ClientBuilder, and applies while consuming the response byte stream. Signature verification precedes successful download resolution.

## UI coverage limitation

This lens reviewed state branches and controller/native source, not a running packaged application. Parent owns component/browser tests and screenshots. Loading/empty/error/overflow/constrained-viewport visual checks are **not claimed as passed** here. Native failure behavior on actual Windows/macOS/Linux installers remains a signed-candidate qualification gate.

| Surface | Loading | Empty / first run | Error | Overflow | Constrained viewport |
| --- | --- | --- | --- | --- | --- |
| Updates Settings | Source handled | Source handled | R1 | Pending parent browser evidence | Pending parent browser evidence |
| Startup update toast | Source handled | Quiet check intended | R2 | Pending parent browser evidence | Pending parent browser evidence |
| Required-update overlay | Source handled | Required release unavailable has error | Source handled, retry retained | Pending parent browser evidence | Pending parent browser evidence |

Initial review found 0 P0, 2 P1, 0 P2. Final re-review: both findings resolved; no remaining actionable findings in this scoped lens. Historical evidence above is retained.


## Follow-up review

The channel adapter now restores the previous native/cache preference after save failure and reports rollback failure explicitly. `updateController.test.ts` covers partial mutation, absent previous preference, and rollback failure. R1 is resolved.

The controller now records `errorOperation`, and the toast displays installation failures even if React batches away intermediate downloading/installing renders. This resolves the original R2 failure. However, its new **Check again** action calls plain `check()`: if that user-triggered retry also fails, `errorOperation` is `checking` and the hook dismisses the toast again. Keep an actionable failure for this explicit retry while keeping unattended startup checks quiet. This follow-up was sent to root.

Verification command: `npx --no-install vitest run src/lib/updateController.test.ts src/lib/updateState.test.ts src/hooks/useStartupUpdateCheck.test.tsx` from desktop. Result: 2 files, 29 tests passed; the hook test file did not exist at review time. No product code edited.


## Final re-review

R2's explicit **Check again** retry now sets `retryFromToast`, so a subsequent check failure retains an actionable error toast. Automatic startup failures remain quiet. The new hook regression test uses the real controller and covers StrictMode startup replay, immediate signature failure, failed explicit retry, and quiet automatic failure.

Independently ran `npx --no-install vitest run src/hooks/useStartupUpdateCheck.test.tsx`: 1 file, 2 tests passed. Combined with the earlier 29 passing adapter/controller tests and final source inspection, both R1 and R2 are resolved. Root reports the complete 1,083-test suite and two browser scenarios at 960px/400px passed; that broader evidence belongs to the parent verification log, not an independently repeated suite here. No product edits or native installations performed by this reviewer.
