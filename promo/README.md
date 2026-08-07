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
| `src/motionClock.ts` | Pins Motion's clock to Remotion's frame. Required by any composition using Motion. |
| `stubs/tauri-store.ts` | Aliased in for `@tauri-apps/plugin-store`, which the chip's import chain reaches but never calls. Every method throws on purpose. |

## Motion in Remotion

Any composition using Motion must call `useMotionClock()` above its
Motion components. Motion animates on requestAnimationFrame; Remotion
has no clock — it sets a frame, waits, and screenshots. Left alone, an
animation advances by WALL CLOCK between screenshots and the same
composition renders differently every run.

There are two clocks to pin and only one is documented:

- Motion's batcher, via `MotionGlobalConfig.useManualTiming` plus
  pumping `frameSteps` by hand. Supported API, not a trick.
- The browser's, because Motion hands transform and opacity to WAAPI,
  which runs on the document timeline and ignores manual timing
  entirely. Remotion doesn't seek those either. `AnimateNumber`'s digit
  roll is exactly this, and it was the whole bug.

Both fixed in `motionClock.ts`, with the remaining sub-pixel ceiling
documented there.

### Don't let Motion animate a value in a composition

Pinning the clock is necessary but not sufficient. Motion's TRANSITIONS
still don't advance across Remotion's frame-stepping: a score stepped
from 149.9 to 151.8 snapped over inside one frame at every duration
tried, 0.28s through 1.2s.

The rule that came out of it — **Remotion owns timing, Motion owns
presentation**. Interpolate the value per frame with Remotion's
`spring`/`interpolate` and hand Motion a fresh value to format. Give
`AnimateNumber` `transition: { duration: 0 }` when you do; anything
longer restarts a slide every frame and leaves every digit stuck between
glyphs, which on screen is a smear, not a roll.

`FantasyStatChip`'s own `rollScore` is therefore NOT used here. In the
app it's correct — there's a real clock and the digits genuinely roll.
Under Remotion it turns to mush.

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
