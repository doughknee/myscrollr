# Desktop main-app animation re-audit

Scope: the Tauri main app mounted by `desktop/src/app-main.tsx` into
`#app-shell`. The ticker mounted by `desktop/src/main.tsx` into
`#desktop-shell` remains intentionally animated and is excluded.

Final scan date: 2026-07-28.

- Main-app routes, widgets, settings, catalog, tooltips, and controls contain
  no Motion, Motion+, CSS keyframe, transition, movement, or timed-flash
  animation paths.
- Main-app tooltip content is mounted under `#app-shell` and rendered
  statically; the ticker retains the animated tooltip branch.
- Theme-transition timers, live-data flashes, success delays, and the
  orphaned scroll-logo animation were removed from the main app.
- Remaining Motion imports and transition utilities are confined to the
  ticker entry and ticker-only components.
- `#app-shell` retains a defensive `animation: none` / `transition: none`
  rule for third-party and shared styles.

Verification:

```text
npm run build
npm test
rg "motion/react|motion-plus/react|AnimatePresence|motion\.|@keyframes|animation:|transition:|animate-|active:scale|hover:.*translate" desktop/src
```
