# Fill audit disposition

Scoped review of PR #529, starting at `75a74c4b`. The lens reports preserve baseline findings; this file records the subsequent fixes. The user requested continued improvements, so the implementation batch includes verified defects as well as the audit. No merge or release is authorized.

## Fixed in this review batch

| Finding | Priority | Change | Tracking |
|---|---|---|---|
| R1: orphaned follower hover stops docked paging | P1 | Release hover on unmount; prune destroyed-window holds on native membership updates | SCROLLR-400 |
| UI1: portrait recovery controls offscreen | P1 | Shared empty state fills the grid canvas, wraps controls and permits vertical overflow | SCROLLR-401 |
| PERF1: clock ticks repaint unchanged cells | P2 | Memoize the shared Cell adapter while preserving live item updates and click handlers | SCROLLR-402 |
| C1: grouped utilities permanently skip items | P1 | Select utility items by each utility's appearance count; all-visible/docked turns stay unchanged | SCROLLR-403 |
| C2: previous grid page enters from wrong side | P2 | Pass backward direction to the incoming Motion element | SCROLLR-404 |
| C3: utility pins consume an empty footer | P2 | Share active data-pin eligibility between footer budgeting and rendering; keep missing-data reservations | SCROLLR-404 |

## Backlog, outside this fix batch

| Finding | Priority | Next owner / acceptance | Tracking |
|---|---|---|---|
| R2: hidden placement error has no reachable retry | P2 | Desktop lifecycle: show failure/retry in settings; inject transient placement failure and verify safe recovery | SCROLLR-405 |
| UI2: cold loading/failure resembles no sources | P2 | Desktop data state: distinguish pending/error/empty, retain cached data and test failure recovery | SCROLLR-406 |
| PERF2: hidden/suspended utility polling continues | P2 | Desktop lifecycle: stop display-only intervals and refresh on resume without disturbing shared SSE | SCROLLR-407 |
| PERF3: ticker imports utility feed screens | P2 | Desktop startup: retain shared eager metadata and lazy-load feed screens | SCROLLR-408 |

These are standalone Scrollr backlog issues. No duplicate registry, ticker, host, API or service is proposed. No confirmed new security vulnerability was found by the bounded review; inherited permissions and browser-flag compatibility remain documented constraints.

## Verification

- Production frontend build and all 1,035 Vitest tests passed.
- All 42 focused browser cases passed: 34 Fill/hover/edge-budget cases plus 8 cell-reservation cases. They verify live quote updates and click IPC, backward animation direction, follower Fill/disconnect releases, grid/strip geometry and Escape, empty recovery actions at 100%/150%, and expanded cell reservations.
- Visually inspected the resulting 720x1280 portrait and 1920x360 empty grid at 150%; text/buttons remain within the canvas. Original page slides/wipes are preserved. Independent source reviews found no remaining actionable issue in this fix batch.
- Direct served-module counters on identical 20-second clock/grid samples measured 396 to 36 QuoteCell function calls (including StrictMode), with 24 commits in both; inclusive root render time fell from 238.2ms to 114.6ms. This is development fixture evidence, not a mini-PC production benchmark. Earlier fiber-subtree counts were discarded because memo bailouts retain stale flags. An earlier hidden after-profile was invalidated by dev reload and is not used.
- Initial new click assertion named the wrong Tauri plugin (`opener` rather than the existing `shell`); the assertion was corrected and passed. No app behavior was changed to satisfy it.
- See `NATIVE-SAMPLE.md` for a 60-second sample on the user's actual Windows desktop; `PERFORMANCE.md` records the isolated baseline soak and measurement limitations.
- The 15-minute baseline soak completed: GC JS heap 15.30 → 17.27 → 17.69MB at 0/5/15m; DOM/listener/fiber counts did not accumulate and query counts stayed stable. Remaining heap slope is uncertain; no production leak or long-term stability claim. Both isolated audit servers were stopped and the baseline worktree removed.
- Source reviews and browser shims do not certify physical hotplug, mixed DPI, sleep/wake, target mini-PC performance, or native macOS/Linux/Wayland. Those remain release gates. The Windows rendering workaround needs runtime/hardware revalidation.

Raw profiler/heap artifacts and fixture screenshots are local ignored evidence under `results/` and `states/`; report conclusions state their limits. The user's running app on port 5174 and account preferences were left in place.
