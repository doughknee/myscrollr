# Consistency lens: animation

## P1 — Equivalent app state changes use unrelated animation contracts

Evidence:

- Route content uses shared opacity variants in
  `desktop/src/lib/motion.ts:8`.
- Feed edit mode uses wait-mode presence in
  `desktop/src/routes/feed.tsx:449`.
- Support cards use delayed entrance and hover translation in
  `desktop/src/components/support/SupportHub.tsx:206`.
- Utility cards use CSS keyframes, for example
  `desktop/src/widgets/weather/WeatherCard.tsx:71`.

Verification: compare the duration, easing, transform, and presence modes at
the references above.

Suggested fix: for the main app, render state changes immediately and keep
animation only in the independently mounted ticker.
