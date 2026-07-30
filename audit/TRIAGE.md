# Desktop main-app animation closeout triage

Closeout date: 2026-07-29. Ticker, ticker rows, and double-decker ticker work
remain intentionally out of scope.

## Result

- All animation-related P1/P2 findings from the final audit are resolved.
- Route and widget motion no longer re-key together when async data resolves.
- `MotionConfig reducedMotion="user"` owns the shared policy; native Sports
  scrolling also respects reduced motion.
- Widget-bar menus, chevrons, compact row/icon feedback, and loading indicators
  now use the shared Motion vocabulary.
- The Sidebar selector animates only `transform`; scroll geometry reads are
  coalesced to one animation frame.
- Production build passed and all 527 desktop tests passed.
- Runtime screenshots/profiling remain unverified because no Browser backend
  was connected during the audit.

## Deferred, non-animation findings

1. Async error states in Sports Standings, RSS, and GitHub still need a direct
   Retry action. This is a resilience task, not part of the animation pass.
2. Lazy widget loading could reduce the shared startup chunk. This predates
   the animation work and belongs in a startup-focused change.
