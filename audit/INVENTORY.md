# Desktop main-app animation re-audit

Scope: the Tauri main app mounted by `desktop/src/app-main.tsx` into
`#app-shell`. The ticker mounted by `desktop/src/main.tsx` into
`#desktop-shell` remains intentionally animated and is excluded.

Final scan date: 2026-07-29.

- Every main-app route now shares one Motion fade-and-lift entry owned by
  `desktop/src/components/layout/RouteTransition.tsx`.
- Shared Motion variants in `desktop/src/lib/motion.ts` cover backdrops,
  overlay surfaces, popovers, tooltips, and zero-bounce control motion.
- The shared confirmation dialog, sign-in/update overlays, timer confirmation,
  prediction detail, Options menus, and main-app tooltips use that vocabulary.
- Sidebar selection, shared segmented controls, settings segmented rows, and
  settings toggle knobs use the shared control transition.
- Sports, RSS, and Fantasy use one shared keyed widget-state transition for
  direct user-driven view changes.
- Sidebar widget sources and GitHub repositories use bounded Motion layout
  animation for explicit add/remove actions; RSS uses Motion for its
  tracked-state icon swap.
- Widget-bar menus/chevrons and all main-app loading indicators use shared
  Motion presets with reduced-motion fallback behavior.
- The Sidebar selector is transform-only and coalesces scroll measurements to
  one animation frame.
- Theme-transition timers, live-data flashes, success delays, and the
  orphaned scroll-logo animation were removed from the main app.
- Widgets and routes retain no independent mount choreography or timing
  literals.
- `#app-shell` retains a defensive `animation: none` / `transition: none`
  rule for third-party and shared styles.

Verification:

```text
npm run build
npm test
rg "motion/react|motion-plus/react|AnimatePresence|motion\.|@keyframes|animation:|transition:|animate-|active:scale|hover:.*translate" desktop/src
```
