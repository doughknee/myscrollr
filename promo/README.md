# promo

Rendered marketing footage for Scrollr, built with Remotion.

The point of this project is that it renders **the real components**.
`Beat1Hook` imports `FantasyStatChip` from `desktop/src/` and feeds it a
`LeagueResponse`; it is not a recreation of the chip in After Effects.
When the chip design changes, the footage re-renders instead of going
stale, and a beat can never show something the product doesn't do.

## Run

```bash
npm install
npm run dev        # Remotion Studio, scrub the beat
npm run render     # out/beat1.mp4
npm run still      # out/beat1.png at the go-ahead frame
```

## What's here

| | |
|---|---|
| `src/beats/Beat1Hook.tsx` | Beat 01 — the hook. 3s locked camera, one hero chip, the lead changes at 2.0s. |
| `src/data/sundayMoney.ts` | The league. Same numbers as `desktop/fixtures/serve-fantasy-demo.mjs`, so a screen recording and a rendered frame cut together without a seam. |
| `stubs/tauri-store.ts` | Aliased in for `@tauri-apps/plugin-store`, which the chip's import chain reaches but never calls. Every method throws on purpose. |

## Two things that will bite

**Don't wrap a composition in `#desktop-shell` or `#app-shell` to get the
theme.** Those ids carry real layout in `desktop/src/style.css` —
`height: 100vh`, their own background, `width: 100% !important` on the
last child — which exists to make the app's ticker + feed stack behave
and quietly wrecks a video frame. The default `@theme` block is already
the scrollr-dark palette. Another palette means re-scoping the variables
*without* the shell's layout rules.

**Honesty boundary, same as the fixture.** Players are real, stat lines
are representative. Nothing rendered from this gets captioned "live",
"no edits", or a specific real date.

## Storyboard

Beat 1 of 6. See `scrollr-hero-cut-storyboard.html` at the repo root.
