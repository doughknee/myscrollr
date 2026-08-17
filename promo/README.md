# Scrollr promo chips

Transparent, 60fps overlays of the **real** ticker chips, for compositing
over screen captures in DaVinci Resolve.

The compositions import `FantasyStatChip` and `FollowedPlayerChip`
straight out of `desktop/src`. They are the shipped components, not
recreations, so an overlay cannot drift from the product — change a chip
in the app and the next render follows. What this project owns is the
data and the timing; the design belongs to the app.

## Render

```bash
npm run render:all
```

or one at a time: `render:league`, `render:player`, `render:rail`,
`render:pop`.

| comp | canvas | what it is |
| ---- | ------ | ---------- |
| `LeagueChip` | 1920x640 | one league, two lines, the full matchup |
| `PlayerChip` | 1280x520 | one player, points against projection |
| `TickerRail` | 3840x280 | three leagues side by side, one of them scores |
| `ScorePop` | 1080x520 | a `+13.6 PTS` pill for a music hit |

`TickerRail` is 2x a 1920-wide bar: drop it on a 1080p timeline at 50%
for a pixel-exact ticker along the top of a screen capture, or leave it
at 100% to punch in.

Confirm the alpha survived:

```bash
npx remotion ffprobe out/league-chip.mov
```

You want `yuva444p12le` in the video stream line. If you see `yuv422p12le`
— no `a` — the file is opaque and Resolve will show a black box.

To eyeball a frame the way it will actually composite:

```bash
npx remotion ffmpeg -y -ss 2 -i out/league-chip.mov -frames:v 1 -pix_fmt rgba -update 1 out/frame.png
node scripts/preview-alpha.mjs out/frame.png out/on-grey.png 70
```

A transparent PNG opened on its own tells you nothing, because the viewer
picks the backdrop. That script forces the question.

## Variants without touching code

Every comp is fully prop-driven. Put the overrides in a JSON file:

```json
{
  "leagueName": "Dynasty or Bust",
  "teamName": "Regression Candidates",
  "opponentName": "Air Yards Only",
  "week": 12,
  "status": "final",
  "myScore": 184.5,
  "opponentScore": 151.0,
  "projection": 184.5,
  "topScorer": { "name": "Allen", "team": "BUF", "position": "QB", "points": 36.9 },
  "record": { "wins": 9, "losses": 2 },
  "rank": 1,
  "numTeams": 8,
  "scoreEvents": [{ "at": 60, "points": 8.4, "kind": "big" }]
}
```

then

```bash
npx remotion render LeagueChip out/dynasty.mov --codec=prores --prores-profile=4444 --props=variants/dynasty.json
```

**Use a file, not inline JSON.** `--props='{"a":1}'` works in bash and
falls apart in PowerShell, which strips the quotes and hands Remotion
something unparseable. A file behaves the same in every shell.

## Scoring plays, not a count-up

**Fantasy points do not ramp.** A catch is +1.4 and a touchdown is +6.6,
both delivered whole, and the gap between them is the part that hurts.
Gliding a score from 149.9 to 157.9 reads as a dashboard refreshing;
landing it in two discrete hits reads as two things happening on a field.

So `scoreEvents` is the main control:

```json
"myScore": 149.9,
"scoreEvents": [
  { "at": 50,  "points": 1.4, "kind": "catch" },
  { "at": 110, "points": 6.6, "kind": "td" }
]
```

`myScore` is the total **before** the plays; each event adds to it. Kinds
are `catch` / `fg` / `td` / `big` and only change how hard the chip
reacts, never the arithmetic.

### The shape of one hit

| frames | |
| ------ | --- |
| −8 → 0 | **anticipation** — the chip eases *down* before the number moves |
| 0 → 5 | **impact** — up and overshooting; the number counts in this window |
| 5 → 30 | **settle** — decelerating back to rest |

The dip is the part that matters. Eight frames is invisible if you look
for it and unmistakable if you don't; it's the flinch before a punch, and
without it the impact reads as a glitch rather than a blow.

### What the default sequence tells

The shipped defaults are a walk-off, and the middle beat is the point:

- opens **149.9–151.7**, behind by 1.8
- **f50** a catch, +1.4 → **151.3**. Still behind, by 0.4. Close enough
  to taste and still losing is the only frame that makes a viewer lean in.
- **f110** a touchdown, +6.6 → **157.9**, and the lead flips *inside* the
  count. Score turns green, win% goes 73→90, the spine surges, a ring
  flares.

None of that back half is choreographed separately. **Only the score is
animated** — win probability, spine fill and the up/down colour are all
derived by the real chip from the matchup it is handed, so counting the
score moves every one of them in step. Animating them by hand would have
meant a second copy of `estimateWinProbability` living here, drifting
from the real one the first time it was tuned.

`ScorePop` is separate: it overshoots around frame 12 and settles by 34,
so aligning comp frame 0 with a music hit puts the accent just after the
transient, where an accent wants to sit.

### Trimming

Everything is 6s at 60fps. With the default events the picture is frozen
from about **frame 192** (3.2s), leaving 168 frames of identical tail to
trim from. That figure moves with your events — `settledAt()` in
`scoring.ts` is the source of truth. The LIVE dot keeps breathing past it
on purpose: a "LIVE" badge that has stopped moving reads as a screenshot.

A simple `countUpFrom` still works for a chip that should just glide to a
value. It is ignored when `scoreEvents` is set — a smooth ramp and a
sequence of plays are two different stories and a chip can only tell one.

## Resolution

Chips render at **2× their real ticker size** on oversized canvases
(1920×640, 1280×520, 1080×520), so a 200% punch-in on a 1080p timeline is
still sampling real pixels. The margin also clears the chip's glow and
flash ring, which sit outside its border box — a canvas fitted tightly to
the chip clips them, and the crop shows against moving footage.

Scale is a prop, so `--props '{"scale":3}'` gives you more without
touching the design. The chip's geometry is never changed to make it
bigger; it is drawn at real size and scaled, which is what keeps padding
and wrapping identical to the product.

## Three things that will look wrong until you know why

**Only the chip that scored reacts.** On `TickerRail` the wash and ring
apply to the hero chip alone while the other leagues carry on unbothered.
That is deliberate: a whole bar lighting up reads as an app-wide alert,
and the neighbours holding steady is exactly what makes the reacting one
feel live. (This was a real bug first — the reaction lived on the stage
and lit all three.)

**The chip is nearly transparent.** Its fill is the app's own 6% wash,
which is subtle by design — it reads against the dark bar behind it in
the product, and over footage it composites as tinted glass. That looks
good over calm footage and gets hard to read over busy footage. Pass
`"plate": true` to give it the app's surface colour as a solid ground.

**The score digits don't roll.** `rollScore` is deliberately off. The
roll is Motion-driven and Motion animates through WAAPI on the document
timeline, which does not advance when Remotion steps frames — the digits
would sit frozen mid-roll. The `countUp` helper does the same job as a
pure function of the frame instead.

## Gotchas that cost a render

- **`Config.setVideoImageFormat("png")` in `remotion.config.ts` is
  load-bearing.** JPEG frames have no alpha channel, so with jpeg the
  encoder receives opaque images and writes an opaque file no matter what
  codec you ask for. It fails silently: the render succeeds, the file
  really is ProRes 4444, and only ffprobe tells you the alpha is gone.
- **`@source` in `src/styles.css` must cover `.ts`, not just `.tsx`.**
  The app's own directives are `*.tsx` only, and every chip's border,
  background and text class is a string in `chipColors.ts` — a `.ts`
  file. Tailwind never scanned it, so `border-accent-purple/25` and
  `bg-accent-purple/[0.06]` were never generated. That does not fail
  loudly: the border silently fell back to Tailwind's `currentColor`
  default, inherited the light body foreground, and drew a hard white
  1px line on every chip, while the fill simply did not exist. The app
  is unaffected — its Tailwind content detection walks from `desktop/`
  and finds the `.ts` files anyway; here the detection root is `promo/`.
- **Prop types are `type` aliases, not `interface`s.** Remotion's
  `Composition` needs props assignable to `Record<string, unknown>`, and
  TypeScript gives an implicit index signature to type aliases but not to
  interfaces. As an interface it fails with a `LooseComponentType` error
  naming neither the cause nor the fix.
- **Nothing may paint a background.** Not the AbsoluteFill, not the theme
  wrapper, not the chip. The wrapper is `#app-shell`, never
  `#desktop-shell` — the latter carries `height: 100vh` and its own
  background.
