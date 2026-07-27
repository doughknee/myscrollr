# Animation inventory (pre-removal)

Scope: the Tauri main app mounted by `desktop/src/app-main.tsx` into
`#app-shell`. The ticker mounted by `desktop/src/main.tsx` into
`#desktop-shell` is explicitly excluded.

The main app has nine routed surfaces (`feed`, `catalog`, `customize`,
`account`, `status`, `releases`, `support`, widget feed, and widget info),
plus finance, sports, RSS, fantasy, predictions, and utility-widget views.

Animation mechanisms found:

- Motion for React in 28 non-test main-app files.
- Tailwind transition/animation utilities across route, component,
  data-widget, and utility-widget files.
- CSS keyframes and inline `style.animation` for utility-widget cards,
  timers, live indicators, and the animated logo.
- Shared theme-transition behavior in `useTheme` / `style.css`.

Ticker exclusion boundary:

- Preserve `desktop/src/main.tsx`, `desktop/src/App.tsx`,
  `desktop/src/components/ScrollrTicker.tsx`,
  `desktop/src/components/TickerToolbar.tsx`, ticker renderer modules, and
  ticker chip components.
- Preserve shared animation definitions needed by those ticker files.
- Main-app CSS is scoped by `#app-shell`; ticker CSS is scoped by
  `#desktop-shell`.
