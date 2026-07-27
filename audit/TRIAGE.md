# Animation audit triage

- P0: 0
- P1: 2 (one shared root cause)
- P2: 0

Recommended action: remove Motion wrappers, CSS keyframes, Tailwind
transition/animation utilities, and animation-only helpers from the main app;
retain ticker-only animation code. Tracked by REL-84.

Result: completed. The main app has no Motion imports or animation utilities,
and `#app-shell` disables motion inherited from ticker-shared components.
Direct ticker paths are unchanged from checkpoint `feae91d1`.
