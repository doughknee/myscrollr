# 1.8.0-beta.3 — Election Results (SCROLLR-439)

## Product contract

A tester can add Election Results from Library, find Tennessee Governor by office or place, follow it, and see a changing count without reopening the widget. Opening the race shows every reported candidate, the reporting percentage when available, the source timestamp and a link crediting civicAPI. Support one curated single-seat contest first (87476). Coverage expands only after someone verifies the individual contest and voting rules. Elections occupies one normal widget slot; following a race is a selection within that widget.

civicAPI permits commercial use with attribution and makes its own race calls. Fetch the race detail directly, display the provider's timestamp and link the race back to civicAPI. Provision the active-election worker for a shared check roughly every 30 seconds. Publication time and the provider's availability determine how current the displayed tally is. [Provider FAQ](https://civicapi.org/faq) · [Tennessee Governor race detail](https://civicapi.org/api/v2/race/87476)

## Recursive audit and implementation sequence

| Boundary | Evidence and decision | Acceptance |
| --- | --- | --- |
| Provider → core | The searchable governor list lagged individual race 87476. The direct detail endpoint returned real data, a test flag, per-candidate winner flags, reporting progress and source time; it also timed out. Read only approved race IDs from civicAPI and share one fetch across followers and replicas. | Reject test, malformed and older snapshots. Accept a newer correction even if votes fall. An outage retains the previous count and timestamp. |
| Core → account | The existing widget catalog, CRUD and ingestread dashboard are reusable; releasing a global catalog entry would reach unsupported Stable clients. Gate discovery, account reads and mutation on the preview capability/server rollout flag. | Default-off and old clients retain compatible views. Follow/unfollow persists under the correct account. A follower only receives their selected contests. |
| Persistence → live updates | Store the race snapshot in Postgres. Publish an invalidation after commit using the existing SSE/Redis path. The race read must converge even after a missed event. | A real browser receives new data without refresh. Fast-changing totals do not reorder on-screen items. |
| Feed → ticker | Library visibility alone is insufficient; Home, full-feed detail, Pages and Continuous each require a renderer. Follow the chip spec: one 64px bar, reserved changing values, stable race identity, no selection controls on the bar. | Test before first votes, tie, leader change, delayed data, disputed status and source call. Source time stays visible. Unfollow removes the race. |
| Candidate → tester | Beta 2 source is 1.8.0-beta.2; Beta 3 needs synchronized manifest versions and Windows MSI ordering. Keep recovery pinned to signed Stable 1.7.3. | Local review build and isolated test environment first; protected-main signing, install and recovery rehearsals and human acceptance before public feeds. |

## Release sequence

1. Verify on an isolated backend with scratch Postgres and Redis. Use web mode to exercise the real main and ticker windows with a synthetic local test identity. Keep the provider switch off everywhere else.
2. Test the installed Windows candidate plus macOS ARM64 and Linux x64 after building from reviewed main. Verify old Stable clients, Beta 2 upgrade, Stable-to-Beta installation and Beta-to-Stable recovery with the exact signed bytes. Inspect the supported package/platform matrix and the retained ordinary settings after rollback.
3. Deploy the read path default-off. On a private test backend, enable the preview catalog and run one dedicated elections worker with its own resource budget. The client capability is a compatibility signal. A separate private backend controls tester access. Keep provider failures, source age, SSE delivery and ordinary dashboard latency visible during testing. Observe a fresh upstream snapshot on the final worker before promoting.
4. Only after approval, publish the qualified beta through the Beta channel. If ingestion fails, disable the backend beta flag, retain snapshots/follows, and use the established recovery path when needed. Keep Stable publication a separate decision.

## What to test first

Open the private tester, search the Catalog for **Election Results**, add it and follow **Tennessee Governor**. In the race detail, compare the margin with the candidate table, the reporting percentage and the source time. Pin the race, try Pages and Continuous, then unfollow it. A race that is tied, awaiting votes or disputed should say so. Only an explicit provider call gets a call label.

The fictional replay gives the same race two candidates, Preview A and Preview B. The first count gives A a 40-vote lead. The correction reduces A's total and gives B a 30-vote lead. The delayed phase holds that correction and its timestamp. The called and disputed phases let a reviewer see how the ticker treats a source decision. The reset phase resumes the live path when a worker is running.

## Expansion after the private pilot

Add a mayor or council contest only after verifying its provider ID, city, state, date, seat count, candidate identities and a real update. A council election with several winners or a ranked-choice count requires its own result rules. Retain the one-widget-per-account model as the race picker grows. Following additional contests within the widget uses the same slot. The beta currently supports one Tennessee statewide race.
