# Scrollr promo

Remotion project for the promo film and the website hero loop. Both are
rendered from the app's own page cells and fixtures in `desktop/src`, so the
video cannot drift from the product.

- `npm run dev` opens Remotion Studio. Compositions are registered in
  `src/Root.tsx`: `Film`, `FilmPortrait`, `HeroLoop`, `HeroLoopLight`.
- `npm run typecheck` type-checks the project.
- How the film is built, cued and rendered: [`src/film/README.md`](./src/film/README.md).
- `scripts/preview-alpha.mjs` and `scripts/corner-bg.mjs` composite a
  transparent frame over a backdrop to judge it.
