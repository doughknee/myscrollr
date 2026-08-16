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
npx remotion render LeagueChip out/league-chip.mov --codec=prores --prores-profile=4444
npx remotion render PlayerChip out/player-chip.mov --codec=prores --prores-profile=4444
npx remotion render ScorePop  out/score-pop.mov  --codec=prores --prores-profile=4444
```

Or `npm run render:league` / `render:player` / `render:pop`, which are the
same commands.

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
  "countUpFrom": 170.2
}
```

then

```bash
npx remotion render LeagueChip out/dynasty.mov --codec=prores --prores-profile=4444 --props=variants/dynasty.json
```

**Use a file, not inline JSON.** `--props='{"a":1}'` works in bash and
falls apart in PowerShell, which strips the quotes and hands Remotion
something unparseable. A file behaves the same in every shell.

## Timing contract

All three comps are 6s at 60fps and **settle by frame 90 (1.5s)**, then
hold. Everything past 90 is identical, so you can trim from the tail to
any length without the picture changing. The one exception is the LIVE
dot, which keeps breathing on purpose — a "LIVE" badge that has stopped
moving reads as a screenshot.

| frames | what happens |
| ------ | ------------ |
| 0–20   | slide up + fade in |
| 20–70  | scores count to their final value, ease-out |
| 26–82  | spine / underline bars fill |
| 90+    | held |

`ScorePop` is separate: it overshoots around frame 12 and settles by 34,
so aligning comp frame 0 with a music hit puts the accent just after the
transient, where an accent wants to sit.

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

## Two things that will look wrong until you know why

**The chip has no fill.** In the app its background is a 6% wash that
reads against the dark bar behind it. Standing alone there is nothing
behind it, so it composites as glass — border and text only. That looks
good over calm footage and gets unreadable over busy footage. Pass
`"plate": true` to give it the app's own surface colour as a ground.

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
- **Prop types are `type` aliases, not `interface`s.** Remotion's
  `Composition` needs props assignable to `Record<string, unknown>`, and
  TypeScript gives an implicit index signature to type aliases but not to
  interfaces. As an interface it fails with a `LooseComponentType` error
  naming neither the cause nor the fix.
- **Nothing may paint a background.** Not the AbsoluteFill, not the theme
  wrapper, not the chip. The wrapper is `#app-shell`, never
  `#desktop-shell` — the latter carries `height: 100vh` and its own
  background.
