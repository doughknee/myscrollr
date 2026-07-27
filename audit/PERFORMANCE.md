# Performance lens: animation

Calibration: Scrollr is a long-running live-data desktop app, so predictable
rendering and low sustained compositor work matter more than decorative
entrance choreography.

## P1 — Main-app animation is distributed across four competing mechanisms

Evidence:

- Global Motion configuration: `desktop/src/app-main.tsx:11`.
- Route/page presence choreography: `desktop/src/components/layout/PageLayout.tsx:151`.
- Widget-local Motion examples: `desktop/src/datawidgets/fantasy/MatchupHero.tsx:93`
  and `desktop/src/datawidgets/rss/FeedManager.tsx:268`.
- CSS keyframes: `desktop/src/style.css:1179`.
- Tailwind transitions appear in 255 source sites across the desktop source
  tree before ticker exclusions.

Verification: run `rg` for `motion/react|AnimatePresence|transition-|animate-|
@keyframes|animation:` under `desktop/src`.

Suggested fix: remove animation from the `#app-shell` graph while retaining the
separate ticker graph.
