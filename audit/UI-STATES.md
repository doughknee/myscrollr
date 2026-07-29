# Desktop main-app animation closeout — UI States

Audit date: 2026-07-29

## Scope and evidence

This is a UI States lens audit of the Tauri **main app only**. The ticker,
double-decker ticker, ticker rows, and ticker-only components are excluded.
Scoped surfaces are the shared route transition, overlays and popovers,
Sidebar, Sports, RSS, Fantasy, and GitHub.

Runtime target: `http://localhost:5174/app.html` / the existing Tauri main
window. The required Browser connection was unavailable during this audit:
browser discovery returned no available browser backends. Therefore no app
state was visually reachable and no new screenshots could be captured under
`audit/states/`. Each runtime-only check is marked **VERIFIED UNREACHABLE:
browser backend unavailable** rather than counted as a pass.

No response mocks or instrumentation were installed, so there was nothing to
revert.

Static and runnable evidence:

- The main window minimum is 720×480:
  `desktop/src-tauri/tauri.conf.json:58-67`.
- Route reduced-motion behavior has a focused regression test:
  `desktop/src/components/layout/RouteTransition.test.tsx:35-61`.
- `npm.cmd test -- --run src/components/layout/RouteTransition.test.tsx
  src/components/Sidebar.test.tsx` passed: 2 files, 11 tests.
- Main-app Motion inherits the OS preference through
  `MotionConfig reducedMotion="user"`:
  `desktop/src/app-main.tsx:26-34`.
- The Sidebar source scroller and its unclipped persistent indicator are
  structurally separated:
  `desktop/src/components/Sidebar.tsx:232-255,289-319`.
- Default page content owns one stable-gutter scrollport:
  `desktop/src/components/layout/PageLayout.tsx:124-166`.

## Findings

Animation findings UI-02 through UI-05 were resolved after this audit:

- UI-02: async data handoffs are intentionally immediate, while only direct
  user view changes own pane motion. This prevents nested route/widget
  transforms from competing.
- UI-03: widget-bar panels now use `AnimatePresence` + `popoverMotion`, and
  chevrons use `controlTransition`.
- UI-04: Sports chooses native `"auto"` scrolling when reduced motion is
  requested.
- UI-05: signing-in, GitHub, Fantasy, Predictions, Uptime, Profile, and Support
  loading states share a Motion loading glyph and retain visible status text.

UI-01 remains deferred as a non-animation resilience finding.

### UI-01 — P1 — Async error states have no direct recovery action

**Files:** `desktop/src/datawidgets/sports/StandingsTab.tsx:172-175,242-259`;
`desktop/src/datawidgets/rss/FeedManager.tsx:235-243`;
`desktop/src/components/QueryErrorBanner.tsx:12-19`;
`desktop/src/widgets/github/FeedTab.tsx:228-230`

Sports Standings ends an exhausted query with only “Failed to load
standings.” RSS replaces the entire catalog with “Check your connection and
try again,” but provides no way to try again. GitHub renders the raw
`error.message` through `QueryErrorBanner`, also without a retry action. These
are terminal in-place states; the user must discover that leaving/re-entering
or waiting for an automatic refetch may recover them.

**Reproduce/verify:** reject the Standings query, RSS catalog query, or GitHub
repository query until retries are exhausted. Inspect the cited render
branches: none receives or invokes `refetch`, and the shared banner exposes
the underlying message directly. Screenshot: **VERIFIED UNREACHABLE — browser
backend unavailable**.

**Suggested fix:** render one friendly shared query-error state with an
explicit Retry action wired to `refetch`, and keep technical error text out
of the default user-facing banner.

### UI-02 — P2 — Nested loading/error/content handoffs bypass the shared state transition

**Files:** `desktop/src/components/WidgetStateTransition.tsx:11-25`;
`desktop/src/datawidgets/sports/FeedTab.tsx:207-255`;
`desktop/src/datawidgets/sports/StandingsTab.tsx:242-262`;
`desktop/src/datawidgets/rss/FeedTab.tsx:435-550`;
`desktop/src/datawidgets/rss/FeedManager.tsx:235-243,407-442`;
`desktop/src/datawidgets/fantasy/FeedTab.tsx:279-338`;
`desktop/src/datawidgets/fantasy/YahooConnectFlow.tsx:326-378`;
`desktop/src/widgets/github/FeedTab.tsx:317-350`

The shared wrapper animates only when its `stateKey` changes. Sports keeps the
key at `content-standings` while Standings switches between loading, error,
empty, and table content. RSS keeps the key at `feeds` while FeedManager
switches between catalog loading, error, empty, and list content. Fantasy
keeps the key at `account` through the Yahoo connection phases. GitHub swaps
each row from its loading glyph to workflow status without a keyed state
handoff. Those common nested transitions still snap even though the
top-level widget view transition is consistent.

**Reproduce/verify:** open Sports → Standings on a cold query; open RSS →
Feeds on a cold catalog; run Yahoo discovery/import; or add a GitHub
repository. The cited state branches change without changing the enclosing
`WidgetStateTransition` key. Screenshot: **VERIFIED UNREACHABLE — browser
backend unavailable**.

**Suggested fix:** extend the nearest existing `stateKey` with the nested
async phase, or reuse `WidgetStateTransition` once at the nested state owner;
do not add per-branch timing values.

### UI-03 — P2 — Widget-bar popovers still open and close abruptly

**Files:** `desktop/src/components/widget-bar/Menu.tsx:32-50,98-143,214-255`;
`desktop/src/style.css:973-980`; `desktop/src/lib/motion.ts:49-67`

The shared widget-bar `MenuPopover` conditionally mounts a plain `MenuPanel`
and its chevron is a plain icon with a `rotate-180` class. Main-app CSS
forcibly disables CSS transitions, so both the panel and chevron snap.
Sports, RSS, and Fantasy use these widget-bar controls, while the separate
`OverflowMenu` already uses the shared `popoverMotion` vocabulary.

**Reproduce/verify:** open any Sports/RSS/Fantasy Select or Filter control in
the widget bar. Code mounts/unmounts the panel directly at
`Menu.tsx:136-140`; no Motion presence boundary exists. Screenshot:
**VERIFIED UNREACHABLE — browser backend unavailable**.

**Suggested fix:** reuse `popoverMotion` with `AnimatePresence` for
`MenuPanel`, and use the existing `controlTransition` for the chevron.

### UI-04 — P1 — Sports favorite-row scrolling ignores reduced-motion preference

**File:** `desktop/src/datawidgets/sports/StandingsTab.tsx:168-183`

Whenever standings or favorite teams change, the favorite row is centered
with `scrollIntoView({ behavior: "smooth" })`. This is a native scrolling
animation outside Motion, so `MotionConfig reducedMotion="user"` cannot
disable it. It is the only scoped main-app call that explicitly requests
smooth scrolling.

**Reproduce/verify:** enable reduced motion in the OS, choose a favorite team
that is outside the visible Standings region, then load or change that
league. Static verification is the unconditional `"smooth"` option at line
181. Screenshot: **VERIFIED UNREACHABLE — browser backend unavailable**.

**Suggested fix:** remove smooth behavior or select `"auto"` when
`useReducedMotion()` is true.

### UI-05 — P2 — Several loading affordances look frozen

**Files:** `desktop/src/routes/__root.tsx:966-999`;
`desktop/src/widgets/github/FeedTab.tsx:304-320,347-350`;
`desktop/src/datawidgets/fantasy/ImportProgress.tsx:44-60`;
`desktop/src/datawidgets/fantasy/YahooConnectFlow.tsx:339-378`;
`desktop/src/style.css:973-980`

The signing-in overlay draws a static bordered circle. GitHub displays a
static `Loader2` and an empty status label while repository data is missing.
Fantasy displays static `Loader2` glyphs while waiting/importing and five
static bars during discovery. With CSS animation intentionally disabled for
the main app, these familiar activity shapes can read as stalled rather than
in progress.

**Reproduce/verify:** start app sign-in, add a GitHub repo over a slow
connection, connect Yahoo, or import a league. The cited glyphs have neither
Motion animation nor a changing visual value; GitHub explicitly renders an
empty label while loading. Screenshot: **VERIFIED UNREACHABLE — browser
backend unavailable**.

**Suggested fix:** use one small Motion activity treatment for these
indicators and retain visible loading text so reduced-motion mode remains
clear when transform animation is suppressed.

## Constrained viewport and clipping review

The code contains the expected structural guards: a 720×480 minimum window,
root `min-h-0`/`overflow-hidden` containment, a single page scroll owner with
stable gutter, a separately scrollable Sidebar source list, portaled
Floating UI overlays with `flip`/`shift`, and bounded overlay widths.
However, overlap and clipping are visual outcomes, so the 720×480 checks
remain **VERIFIED UNREACHABLE — browser backend unavailable** and are not
reported as passes.

## Coverage

`UNREACHABLE¹` means the app state required runtime rendering, but no Browser
backend was available. `UNREACHABLE²` means that surface does not own that
state. FAIL cells reference the finding above.

| Surface | Loading | Empty | Error | Overflow | 720×480 | Reduced motion | Transition |
|---|---|---|---|---|---|---|---|
| Global route transition | UNREACHABLE² | UNREACHABLE² | UNREACHABLE² | UNREACHABLE¹ | UNREACHABLE¹ | PASS (focused test) | PASS (focused test) |
| Overlays / shared popovers | FAIL UI-05 | UNREACHABLE² | UNREACHABLE¹ | UNREACHABLE¹ | UNREACHABLE¹ | PASS (global MotionConfig) | UNREACHABLE¹ |
| Sidebar selector + source list | UNREACHABLE² | UNREACHABLE¹ | UNREACHABLE² | UNREACHABLE¹ | UNREACHABLE¹ | PASS (global MotionConfig) | UNREACHABLE¹ |
| Sports | FAIL UI-02 | UNREACHABLE¹ | FAIL UI-01, UI-02 | UNREACHABLE¹ | UNREACHABLE¹ | FAIL UI-04 | FAIL UI-02 |
| RSS | FAIL UI-02 | UNREACHABLE¹ | FAIL UI-01, UI-02 | UNREACHABLE¹ | UNREACHABLE¹ | PASS (global MotionConfig) | FAIL UI-02 |
| Fantasy | FAIL UI-02, UI-05 | UNREACHABLE¹ | UNREACHABLE¹ | UNREACHABLE¹ | UNREACHABLE¹ | PASS (global MotionConfig) | FAIL UI-02 |
| GitHub | FAIL UI-02, UI-05 | UNREACHABLE¹ | FAIL UI-01 | UNREACHABLE¹ | UNREACHABLE¹ | PASS (global MotionConfig) | FAIL UI-02 |
| Sports/RSS/Fantasy widget-bar menus | UNREACHABLE² | UNREACHABLE² | UNREACHABLE² | UNREACHABLE¹ | UNREACHABLE¹ | PASS (no motion) | FAIL UI-03 |
