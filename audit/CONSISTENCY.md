# Desktop main-app animation consistency closeout

Scope: the Tauri main app mounted by `desktop/src/app-main.tsx` into
`#app-shell`. The ticker, ticker chips, ticker toolbar, and double-decker
ticker implementation are excluded.

Scan date: 2026-07-29.

## Result

No P0, P1, or P2 animation consistency findings remain.

Post-audit fixes:

- ANIM-C01 resolved: route motion now delegates reduced-motion behavior to the
  root `MotionConfig`.
- ANIM-C02 resolved: Sports, RSS, and Fantasy transition keys now represent
  direct user view choices rather than async loading/content phases.
- ANIM-C03 resolved: compact GitHub rows and the RSS icon swap use the compact
  `tooltipMotion` preset instead of full-pane `stateMotion`.
- Shared widget-bar menus and loading indicators now consume centralized
  Motion presets.

Verified clean:

- All in-scope animation imports resolve through `motion/react`; the only
  `motion-plus/react` import is the excluded ticker.
- Durations, easing curves, and springs are centralized in
  `desktop/src/lib/motion.ts`; no in-scope component owns a duration, ease, or
  spring literal.
- The main app has no CSS keyframes or Tailwind animation/transition utilities.
  `#app-shell` explicitly disables CSS animation and transitions.
- Every export in `desktop/src/lib/motion.ts` has an in-scope consumer.
- List and widget-state presence boundaries use `initial={false}`, so they do
  not replay their entrance animation merely because a route mounted.

## Resolved findings

### ANIM-C01 — P2 — Reduced-motion behavior has two different policies

**Evidence**

- `desktop/src/app-main.tsx:29` sets the app-wide Motion policy to
  `reducedMotion="user"`.
- `desktop/src/components/layout/RouteTransition.tsx:13` separately reads the
  media preference, and lines 23–27 disable the entire route entrance when it
  is enabled.
- `desktop/src/lib/motion.ts:17-104` retains opacity transitions for overlays,
  popovers, tooltips, and widget states; those consumers rely solely on the
  app-wide `MotionConfig`.

**Defect**

Motion's app-wide reduced-motion policy removes transform/layout motion while
retaining non-spatial opacity feedback, but the route wrapper independently
removes both transform and opacity. A reduced-motion user therefore gets no
route feedback while dialogs, tooltips, and widget-state changes still fade.

**Verification**

Enable the OS “reduce motion” preference, navigate between routes, then open a
tooltip or confirmation dialog. Route content appears immediately, while the
transient surface still runs its opacity transition.

**Suggested fix**

Remove the route-local reduced-motion branch and let the existing
`MotionConfig` enforce one reduced-motion policy for every Motion consumer.

### ANIM-C02 — P2 — Route entry and widget-state entry can animate concurrently

**Evidence**

- `desktop/src/routes/__root.tsx:952-954` places the routed outlet inside
  `RouteTransition`.
- `desktop/src/components/layout/RouteTransition.tsx:23-29` animates the outer
  route with opacity plus a 14 px vertical transform for up to 0.55 seconds.
- `desktop/src/components/WidgetStateTransition.tsx:13-19` can simultaneously
  animate a nested keyed state with `stateMotion`.
- `desktop/src/lib/motion.ts:86-103` gives that nested state another opacity
  transition and an 8 px vertical transform.
- The nested boundary is active in Sports
  (`desktop/src/datawidgets/sports/FeedTab.tsx:207-255`), Fantasy
  (`desktop/src/datawidgets/fantasy/FeedTab.tsx:279-338`), and RSS
  (`desktop/src/datawidgets/rss/FeedTab.tsx:435-550`).

**Defect**

`initial={false}` suppresses only the first widget-state entrance. If loading
resolves or a user changes an internal view during the route's 0.55-second
entrance, both nested elements animate opacity and vertical transforms,
compounding displacement and recreating the overlapping-transition condition
the shared route owner was intended to prevent.

**Verification**

Navigate to Sports and immediately switch Scores → Schedule, or open a cold
Sports/RSS/Fantasy route whose loading key resolves during entry. Inspect the
outer route node and inner keyed state: both receive changing transform and
opacity styles at the same time.

**Suggested fix**

Suppress keyed widget-state motion until route entry completes, or limit
widget-state keys to direct user-driven view switches instead of asynchronous
loading resolution.

### ANIM-C03 — P2 — Full-pane state motion is reused for list rows and a 12 px icon

**Evidence**

- `desktop/src/lib/motion.ts:86-103` defines `stateMotion` as an 8 px
  fade-and-lift with a 0.32-second transform spring.
- `desktop/src/components/WidgetStateTransition.tsx:14-19` uses it for
  full widget panes.
- `desktop/src/widgets/github/FeedTab.tsx:264-271` also uses it for individual
  repository rows.
- `desktop/src/datawidgets/rss/FeedManager.tsx:483-493` uses it to swap a
  12 px Plus/Check icon inside a 20 px control.
- `desktop/src/lib/motion.ts:106-110` already provides the shorter shared
  control transition used by selectors and toggle knobs.

**Defect**

One semantic preset now owns three substantially different scales. The RSS
icon travels more than half its own size with full-pane timing, while nearby
selection controls use the shorter control spring, making add/remove feedback
feel inconsistent despite sharing a helper.

**Verification**

Toggle an RSS catalog feed and compare the Plus/Check swap with a segmented
control or settings toggle; then add/remove a GitHub repository and compare
that row's movement with the widget-pane switch.

**Suggested fix**

Keep `stateMotion` for widget panes and use opacity plus the existing
`controlTransition` for compact icon and list feedback.

## Scoped cleanup order

1. **ANIM-C02:** Prevent nested route/widget transforms; it is the only item
   that can visibly recreate overlapping motion.
2. **ANIM-C01:** Consolidate reduced-motion handling in the existing root
   `MotionConfig`.
3. **ANIM-C03:** Keep the full-pane preset at pane scale and reuse the existing
   control transition for compact feedback.

## Preserved resolution history

The prior animation pass already resolved the original inconsistencies:

1. Main-app tooltips render through Motion inside `#app-shell`; ticker
   tooltips retain their isolated behavior.
2. Finance, sports, and predictions no longer run timed visual flashes in the
   main app.
3. Main-app theme changes no longer schedule an inert transition timer.
4. The unused scroll-logo keyframe, class, prop, and animated SVG gradient were
   removed.

Ticker animation remains intentionally unchanged.
