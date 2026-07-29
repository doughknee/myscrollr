# Desktop main-app animation performance closeout

Final scan date: 2026-07-29.

**Calibration:** MyScrollr is a long-running Tauri desktop app, so sustained
frame cost, animation overlap, timer cleanup, and hidden/off-screen work rank
above cold-start cost. This closeout covers the main app mounted by
`desktop/src/app-main.tsx` into `#app-shell`. The ticker entry, ticker chips,
Motion+ ticker, and double-decker ticker paths are explicitly excluded.

## Motion Performance Audit

**Scope:** Desktop main-app Motion and CSS animation sites
**Files scanned:** 219 TypeScript/TSX/CSS files (generated route tree and
ticker-only entry/components excluded)
**Animation implementation files:** 17
**Animations found:** 22 distinct visual animation sites

### Post-audit resolution

The only D-tier path is resolved. The Sidebar selector now applies measured
width/height immediately and springs only `transform`; scroll measurements are
coalesced with `requestAnimationFrame`. Shared widget-bar and loading motion
adds only compositor-safe `transform`/`opacity` work. The loading glyph repeats
only while an operation is pending and inherits the root reduced-motion policy.

Current static tier distribution: 19 S-tier, 6 bounded B-tier FLIP/layout
setups, 0 C/D/F-tier paths. Runtime frame timing remains unverified because no
Browser backend was available.

### Original audit scorecard

```text
Overall: A

:::'███::::
::'██ ██:::
:'██:. ██::
'██:::. ██:
.█████████:
.██.... ██:
.██:::: ██:
..:::::..::

S █████████████████░░░░░░░░ 15 · 68%
A ░░░░░░░░░░░░░░░░░░░░░░░░░  0 ·  0%
B ███████░░░░░░░░░░░░░░░░░░  6 · 28%
C ░░░░░░░░░░░░░░░░░░░░░░░░░  0 ·  0%
D █░░░░░░░░░░░░░░░░░░░░░░░░  1 ·  4%
F ░░░░░░░░░░░░░░░░░░░░░░░░░  0 ·  0%
```

Fifteen animations are already S-tier: route entry; backdrop, dialog,
popover, tooltip, toggle, and chevron motion; and all overlay surfaces animate
only direct `transform` and `opacity` values through Motion. The shared values
live at `desktop/src/lib/motion.ts:5-109`; their longest visual duration is
550ms and none repeats.

### Findings

#### P2 — `desktop/src/components/Sidebar.tsx:241-250` — Tier D

**What:** The persistent active selector animates `transform`, `width`, and
`height` from measured row geometry.

**Why Tier D:** `width` and `height` trigger layout and paint on every spring
frame; worst-tier wins even though `transform` is compositor-safe.

**Impact:** One absolutely positioned element incurs layout for up to 280ms per
selection or sidebar-size change. The absolute positioning contains most of
the blast radius, so this is P2 rather than release-blocking.

**Verification:** Select Home, Customize, Add, and differently sized source
rows while recording Rendering/Layout in DevTools; layout work should coincide
with the selector spring. Static verification is the numeric `width` and
`height` values in the `animate` object.

**Suggested fix:** Apply measured width/height immediately via `style` and
spring only the selector's `transform`, upgrading the recurring animation from
D to S.

#### P2 — `desktop/src/components/Sidebar.tsx:295-303` and `desktop/src/widgets/github/FeedTab.tsx:260-271` — Tier B

**What:** Source and GitHub repository additions/removals use Motion
`layout="position"` plus opacity/transform lifecycle motion.

**Why Tier B:** Motion performs a one-time FLIP measurement for each
participating list row, then runs compositor animation.

**Impact:** One layout read per participating row occurs only on explicit
add/remove actions; there is no per-frame layout and no background loop.

**Verification:** Add/remove a widget source or GitHub repository and capture
one Layout event at transition setup followed by compositor frames.

**Suggested fix:** No practical upgrade is warranted; the list sizes are small
and user-driven, which is the intended B-tier use of layout animation.

#### P2 — `desktop/src/components/settings/SettingsControls.tsx:139-163` and `desktop/src/components/widget-bar/Segmented.tsx:61-66` — Tier B

**What:** Segmented-control selection backgrounds move with `layoutId`.

**Why Tier B:** Shared layout animation measures the old and new button bounds
once before animating the indicator with transforms.

**Impact:** Two button bounds are measured per user selection; the subsequent
280ms spring is compositor work.

**Verification:** Switch any shared widget segment and any settings segmented
row; the only setup cost should be one layout pass per selection.

**Suggested fix:** No practical upgrade; manual offsets would duplicate layout
knowledge and be less resilient than the current bounded FLIP.

#### P2 — `desktop/src/components/WidgetStateTransition.tsx:11-21` and `desktop/src/datawidgets/rss/FeedManager.tsx:483-493` — Tier B

**What:** Widget view/state swaps and RSS follow-icon swaps use
`AnimatePresence mode="popLayout"` with the shared state transform/opacity
variants.

**Why Tier B:** `popLayout` snapshots the exiting element once before removing
it from flow; the visible 140-320ms animation is then compositor-only.

**Impact:** At most the outgoing and incoming nodes overlap during one
user-driven state change; no state animation is continuous or keyed to live
data updates.

**Verification:** Switch Sports Scores/Schedule/Standings or toggle RSS follow;
one setup layout pass should precede the two composited nodes.

**Suggested fix:** No practical upgrade; `popLayout` prevents the surrounding
content from reflowing throughout the exit.

### Anti-patterns

#### P2 — Uncoalesced scroll-time geometry reads

**Location:** `desktop/src/components/Sidebar.tsx:190-213` and
`desktop/src/components/Sidebar.tsx:233-235`

**Problem:** Every captured widget-list scroll event calls two
`getBoundingClientRect()` reads and schedules a React state update. This is not
F-tier read/write thrashing—the writes occur in the later render—but it is
D-tier main-thread work at native scroll-event frequency.

**Verification:** Scroll a long source list while profiling; calls to
`measureIndicator` should equal captured scroll events, with two rectangle
reads per call.

**Suggested fix:** Coalesce `measureIndicator` through Motion's frame scheduler
so it runs at most once per frame, and keep the selector animation
transform-only.

No animated root CSS variables, `will-change`, animation-frame loops,
scrollTop-driven effects, large animated blur, View Transitions, or
off-screen/infinite main-app animations were found. The CSS rules at
`desktop/src/style.css:973-981` disable legacy CSS animation/transition inside
`#app-shell`; Motion's direct WAAPI animation remains active.

### Accessibility

No issue found. `desktop/src/app-main.tsx:29` wraps the main app in
`MotionConfig reducedMotion="user"`, so transform/layout movement yields to the
OS preference while opacity remains a meaningful reduced alternative. Route
entry also explicitly suppresses its initial transform under reduced motion at
`desktop/src/components/layout/RouteTransition.tsx:13-27`, covered by
`desktop/src/components/layout/RouteTransition.test.tsx:35-61`. The CSS
fallback is at `desktop/src/style.css:1195-1201`.

### Concurrency and overlap

- Route transitions have entry only, so old and new route choreography never
  overlaps (`desktop/src/components/layout/RouteTransition.tsx:20-31`).
- `popLayout` state changes intentionally overlap at most two nodes.
- Dialogs intentionally run one backdrop and one surface together.
- No scoped animation exceeds 550ms or repeats; animation code adds no custom
  timers, subscriptions, or animation-frame loops.
- Listeners adjacent to animated UI are cleaned up: Overflow Menu blur/resize
  at `desktop/src/components/OverflowMenu.tsx:149-157`, Predictions Escape at
  `desktop/src/datawidgets/predictions/MarketDetail.tsx:109-116`, and Timer
  Escape/tick at `desktop/src/widgets/timer/Timer.tsx:319-357` and
  `desktop/src/widgets/timer/Timer.tsx:445-459`.

## Bundle and startup

### P2 — Main app still loads two production chunks over the 100KB audit threshold

**Location:** eager widget discovery at
`desktop/src/widgets/registry.ts:10-12` and
`desktop/src/datawidgets/registry.ts:10-12`; build configuration at
`desktop/vite.config.ts:60-72`.

**Evidence:** `npm run build` completed in 7.20s and emitted
`app-BrgLjw8C.js` at 209.87KB (69.64KB gzip) and the shared
`style-jihLX0m1.js` at 820.46KB (248.10KB gzip). The shared source map contains
all eager widget FeedTabs; its Motion-family sources account for 470,076
source-map characters, but source-map size is not equivalent to shipped
minified bytes.

**Verification:** Run `npm run build` and inspect Vite's gzip table.

**Suggested fix:** In a separate startup-focused change, replace eager widget
glob loading with lazy manifest/component loading before adding manual chunk
rules; this finding predates and is not a blocker for the animation pass.

## Runtime and memory verification limits

- `npx --yes motionscore http://localhost:5174/app.html --agent` could not run:
  MotionScore is not installed locally, the sandboxed fetch failed with
  `EPERM`, and executing a freshly downloaded package against localhost was
  not permitted.
- The approved browser runtime reported `No browser is available` and returned
  an empty backend list, so measured frame timing, max concurrent GPU layers,
  and 0/5/15-minute heap snapshots could not be captured in this pass.
- No temporary instrumentation was added, so there was nothing to revert.

These are verification gaps, not performance findings; no runtime measurement
has been inferred from static code.

### Top 3 recommendations

1. **Make the sidebar selector transform-only** — upgrades the only D-tier
   animation to S-tier.
2. **Coalesce sidebar scroll measurements** — caps geometry reads and React
   updates at one per frame during source-list scrolling.
3. **Lazy-load widget implementations separately** — addresses the 820.46KB
   shared startup chunk outside this animation closeout.
