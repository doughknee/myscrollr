# Fill UI states audit — 2026-11-02

Baseline: PR #529 at `75a74c4b`, compared with `origin/main`. This report records **pre-fix** observations; root is addressing UI-1 as SCROLLR-401. No source was changed by this audit worker. Temporary mocks were browser response intercepts, removed when their contexts closed. The dedicated Vite process on port 5197 was stopped after capture. The user's native app and preferences were untouched.

Read: inventory, UI-states lens, and full `docs/CHIP_SPEC.md`, especially §P.16. Severity: P0 blocker, P1 before release, P2 backlog. No P0 found. Browser fixtures establish rendered behavior, not native placement, DPI, monitor discovery, taskbar release, cursor hardware behavior, or physical readability.

## UI-1 — P1: Grid empty-state recovery disappears outside a portrait display

**Reproduction:** 720×1280 browser viewport; `/ticker-shim.html?fixture=empty&pages=1&fill=grid&utils=`. The grid's Auto scale produces a 420px logical canvas, but `PagedBar` returns the unchanged docked empty bar. Its nonwrapping message overflows both directions: it overlaps the EMPTY label, and the Browse catalog action is entirely beyond the right edge. The all-off variant (`fixture=off`) also loses its widget recovery action.

**Measured evidence:** Browse catalog rect x=733.69 to 991.05 in a 720px viewport; `elementFromPoint` cannot hit its right-hand area. The all-off MLB action is x=890.11 to 993.67. The screenshot shows no recovery action on either state. Fill's separate Settings and Exit controls remain usable, so this is not a total lockout.

**Source at baseline:** `desktop/src/components/pages/PagedBar.tsx:729` (return empty before grid rendering); `desktop/src/components/EmptyBar.tsx:35`–37 (single flex row); `desktop/src/components/EmptyBar.tsx:62`–63 and 83–84 (nonshrinking messages). The new smaller grid canvas exposes a limitation in the shared old empty layout. The line number in PagedBar shifts during root's hover fix; the statement is `if (empty && widgets.length === 0 && edge.utilities.length + edge.pins.length === 0) return <>{empty}</>`.

**Evidence:** [empty portrait](states/grid-empty-portrait.png), [all-off portrait](states/grid-off-portrait.png), measured rectangles in [extra.json](results/ui-states/extra.json). Landscape comparison: [empty 1280×720](states/grid-empty.png).

**Suggested fix:** Pass grid presentation/height to the shared empty component and wrap/stack the recovery copy and buttons within the logical canvas. Use available container space rather than physical-viewport Tailwind breakpoints. Keep the docked one-row layout. Verify both empty kinds in portrait at Auto/Larger/Largest and that CTA center is actually hit-testable. Root owns fix and after evidence (SCROLLR-401).

## UI-2 — P2: Loading and initial dashboard failure are presented as an empty account

**Reproduction:** Delay the `dashboard.pages.json` response with a Playwright route hold while signed in; use `pages=1&fill=grid&utils=` or `pages=1&fill=strip&utils=`. Before the installed-widget dashboard resolves, the screen announces `NO SOURCES / You haven’t added any sources yet`. Releasing the held response replaces it with a populated page. An unknown fixture makes the shim answer dashboard HTTP 500 and produces the same incorrect empty-account DOM. Continuous strip also gives the no-sources copy after that failure.

**Source:** `desktop/src/App.tsx:89` only consumes query `data`; `desktop/src/App.tsx:786`–790 derives `showSourcelessCTA` from authentication and `widgets.length === 0` without requiring a successfully loaded dashboard. This behavior exists before Fill; it is an inherited backlog issue rather than a new Fill blocker. No raw error string leaked in the observed surface; the problem is the incorrect state and absent local error/retry explanation.

**Evidence:** [grid held response](states/grid-loading.png), [strip held response](states/strip-loading.png), [grid after response](states/grid-loaded.png), [strip after response](states/strip-loaded.png), [interaction state log](results/ui-states/interaction.json). HTTP-500 DOM observations are in `grid-error` / `strip-error` entries of [captures.json](results/ui-states/captures.json). The corresponding early screenshots (`grid-error.png`, `strip-error.png`) are first-paint timing samples and should not be used as proof of the final rendered text.

**Suggested fix:** Distinguish pending, failed, and successfully empty dashboard states. Gate the no-sources CTA on successful data, preserve cached data on background failure, and expose a compact recovery/retry state for a cold failure. Do not infer that a failed data fetch means no configured widgets.

## Verified behavior

- Real shared renderer booted in isolated Edge contexts; no page exceptions in the ticker capture batch. An initial cold startup sample for `grid-normal` was captured too early, then replaced with a settled screenshot in the extra batch.
- Sports grid renders at 1280×720 Auto and Largest, long names at 720×1280 Largest, and busy sports at 1920×160 Largest. At 420×272 content remains within the viewport, but tiny physical text is not evidence of readability on actual hardware. [Normal](states/grid-normal.png), [largest](states/grid-largest.png), [portrait](states/grid-portrait.png), [short](states/grid-short.png), [small](states/grid-small.png).
- Quotes at Larger use large reserved price, change, chart and range. News at portrait Largest shows three-line-capacity headline and summary grammar; long prose remains inside its column. GitHub retains centered 64px grammar and truncation. [Quotes](states/grid-quotes.png), [news](states/grid-news.png), [GitHub](states/grid-github.png).
- Sparse pages deliberately leave cells empty. No item duplication was treated as a defect. The longnames fixture has two games; the portrait grid correctly leaves spare space. A saved unresolved pin reserves footer space; the small-grid screenshot is consistent with that specification, not a missing-branding-footer finding.
- Pages strips render at portrait 720×1280 and short 1920×160. Continuous strips remain centered with background space in portrait and occupy the short screen. Long names/news are exercised by the existing `longnames` fixture; this was not an arbitrary-maximal-string injection. [Pages portrait](states/strip-pages-portrait.png), [Pages short](states/strip-pages-short.png), [Continuous portrait](states/strip-continuous-portrait.png), [Continuous short](states/strip-continuous-short.png).
- Controls become `opacity:0; pointer-events:none` after 5.3 seconds idle, movement wakes them, focused Settings remains `opacity:1; pointer-events:auto` after 5.3 seconds, and Escape removes the Fill surface. [Idle](states/controls-idle.png), [wake](states/controls-wake.png), [keyboard focus](states/controls-keyboard-focus.png), [measurements](results/ui-states/interaction.json). Overlaying some heading/utility content while controls are awake is the current transient design, not classified as a persistent clipping defect.
- Across recorded settled ticker cases, document scroll width equaled viewport width. This does **not** prove every element is visible: UI-1 is hidden by overflow, which is why its rectangles and hit tests were checked separately.

## Coverage boundaries

Full Settings > Ticker, monitor discovery, Identify, and main-window constrained sizing remain **UNVERIFIED**. The stock app shim represents an expired-session scenario. A response-only main-entry harness failed with duplicate-React/hook/preamble errors; this is a harness limitation, not a product finding. The screenshot `settings-short-initial.png` is diagnostic harness evidence only. A direct-component attempt was stopped without a successful render. Do not call these settings states product-unreachable or passed.

Per-widget backend failures, very long unbroken strings, all theme palettes, fresh-account starter provisioning, toolbar action navigation into a native window, real monitor errors, and reduced-motion settings were not independently exercised in this UI pass. API error coverage above is the dashboard-level failure. The original slide/wipe was left untouched; still screenshots are not an animation-performance verdict.

The table's **UNREACHABLE** means *not reached by this isolated harness*, not proof the product cannot enter it. This distinction is necessary: unavailable native states must not be marked PASS. PASS applies only to the stated representative fixture.

## Coverage table

| Surface | Loading | Empty | Error | Overflow/content bounds | Constrained viewport |
|---|---|---|---|---|---|
| Page grid / shared dashboard | FAIL UI-2 | FAIL UI-1 (portrait); landscape styled | FAIL UI-2 (DOM) | PASS longnames fixture; arbitrary unbroken strings UNREACHABLE | FAIL UI-1; populated 420×272 and 1920×160 PASS |
| Pages strip / shared dashboard | FAIL UI-2 | PASS landscape fixture | FAIL UI-2 (shared branch) | PASS longnames fixture | PASS 720×1280 and 1920×160 |
| Continuous strip / shared dashboard | UNREACHABLE (not delayed independently) | PASS landscape and portrait fixture | FAIL UI-2 (DOM) | PASS longnames fixture | PASS 720×1280 and 1920×160 |
| Sports grid cells | FAIL UI-2 at dashboard level | PASS sparse allocation; individual off-season status not isolated | UNREACHABLE per-source error | PASS existing longnames/busy fixtures | PASS populated sampled sizes |
| Quote grid cells | FAIL UI-2 at dashboard level | UNREACHABLE missing-quote fixture | UNREACHABLE per-source error | PASS googl fixture at Larger | UNREACHABLE portrait quote-specific case |
| News grid cells | FAIL UI-2 at dashboard level | UNREACHABLE empty feed-only case | UNREACHABLE per-source error | PASS npr portrait prose | PASS 720×1280 Largest |
| GitHub grid cells | UNREACHABLE utility fetch loading | UNREACHABLE empty board | UNREACHABLE GitHub error | PASS repo/thing truncation fixture | PASS 1280×720; narrower UNREACHABLE |
| Utility header / saved-pin footer | UNREACHABLE individual data loading | PASS absent footer / reserved unresolved pin | UNREACHABLE native/provider failure | PASS clock/weather samples | PASS portrait / small fixture |
| Fill controls | PASS immediate availability | UNREACHABLE not a data state | UNREACHABLE placement-error alert | PASS observed labels | PASS sampled sizes; idle/wake/focus/Escape PASS |
| Settings Ticker / MonitorMap / Identify | UNREACHABLE harness failed | UNREACHABLE | UNREACHABLE | UNREACHABLE | UNREACHABLE; native short-window sizing UNVERIFIED |
