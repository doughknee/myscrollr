# Ticker chip design rules

*The definitive list. Distilled from the v1.5.0 and v1.5.1 chip redesign (sports,
finance, news, clock, timer, weather, sysmon, uptime, and the slot rotation), September
2026. Every rule here was learned by getting it wrong first on the running bar. When a
new chip is built, it follows this document; when a rule is broken deliberately, the
reason is written next to the code.*

Still to be rebuilt on these rules: predictions, fantasy, GitHub (REL-184).

---

## 1. The one rule

**Compact is the chip. Detailed is compact plus exactly one row underneath. Nothing in the
top row moves when the second row appears.**

Detailed literally shows more; compact shows less and takes less room. That is a real
trade-off the user makes, not two different layouts. A user must recognise the same chip
across both modes without re-reading it. The sports chip was rejected twice for breaking
this before it was written down.

- Top row: 30px in detailed, 28px in compact. Second row: 20px. These are the same on
  every chip so the rail's rows line up across widgets.
- The detailed row is never a restatement of the top row. It is **the thing you would
  otherwise open the app to find** — see §5.
- A chip that has nothing to add in detailed leaves the row empty rather than inventing
  content. The utility chips' first detailed pass rendered a taller chip with an empty
  row and was called "desperately" bad; the fix was real content, not decoration.

## 2. The grammar

Every chip is the same three-part sentence:

```
[ tab ] [ content cells … ] [ fixed right cell ]
```

- **The tab** names the source: league code, feed name, widget name, or a status cap. It
  spans both rows. It is *painted* — 18% fill of the widget's colour, text in the colour
  — because a tinted border and a 6% ground whisper, and a branded chip looked no
  different from an unbranded one without one place the colour is actually seen.
- **Content cells** own the flexible middle. They are `minmax(0, max-content)` tracks so
  the cap can shrink them and their text truncates; plain `max-content` tracks cannot
  shrink at all and the cap sliced off the *last* cell instead ("PPD" rendered as "PPI").
- **The fixed right cell** holds the one value that changes while the chip is on screen:
  the game clock, the article age, the monitor's uptime or outage. Keeping it out of the
  flowing middle is what stops "99.98%" becoming "4m" and dragging the name sideways.
- **Dividers** between cells are hairlines in the widget's own colour at **45%** —
  deliberately stronger than the 25% outer border. An outer edge separates the chip from
  the rail, which is already a big tonal step; an inner rule separates two things sharing
  a ground, with far less contrast to spend. `border-edge/40` was a near-black line on a
  near-black ground and made four sysmon metrics read as one continuous sparkline.
- **Width cap: 640px.** Content-sized up to it, then names truncate. The widest real
  sports pairing (two 20-character names, every reservation held) is ~575px; the cap
  exists for the pathological case, not the worst ordinary one.
- Every palette carries `bg / border / hoverBorder / text / textDim / textFaint / divider
  / tabBg`. A new chip takes them from `getChipColors`; it does not invent its own.

## 3. Nothing moves

The ticker is the one surface where a value is *guaranteed* to change while it is being
read. Width stability is therefore the first constraint, ahead of density and ahead of
looks.

- **Reserve every slot that can change while on screen.** Scores, clocks, deltas, prices,
  points. A score going 8.3 → 14.9 gains a digit; without a reservation the chip widens
  and shoves every chip after it along the rail.
- **Reserve in `ch` for numbers**, which is exact because chips render mono with
  `tabular-nums`: one `ch` is one digit. Right-align a reserved number — a number growing
  leftward from a fixed decimal reads as counting; growing rightward reads as drifting.
- **Reserve with a hidden sizer for proportional text.** A `ch` is only an approximation
  in a sans face. The headline chip and the rotating name cells stack an invisible copy of
  the widest string under the visible one in the same grid cell; the cell is as wide as
  the wider of the two, and both stay `min-w-0` so the cap can still truncate.
- **Size reservations from real data, per league, per class — never the theoretical
  ceiling.** A team that breaks 1000 points has bigger problems than a reflow; padding
  every chip for a case that never happens leaves a visible gap on every chip that does.
  The sports chip's per-league table (`sportsChipLayout.ts`) was measured from the
  catalog, and a rotating slot reserves the widest name *it* will show, not the widest in
  the league.
- **At the cap, release the reservations.** Once the chip is pinned at 640px nothing can
  move it, so a reservation buys nothing there and the name gets the empty characters
  back — the whole name before kickoff, one more character while the score is a digit.
- **A slot that is sometimes empty still occupies its space.** The live dot is always in
  the DOM, `invisible` when not live; a chip that gains a dot when the game starts was
  9px wider live than pre.
- **Responsive text size must not change width.** The clock scales from 11px to 16px by
  string length, but the reservation is on the *outer* span at the base size, so the
  scaled text never shifts the chip.
- **Prove it by rendering the same fixture pre / live / final side by side.** If the three
  are not pixel-identical in width, the chip is not done.

## 4. Text

- **Mono for data, sans for prose.** Every chip is mono; the headline chip is the one
  sans-serif thing on the rail, deliberately, because it is the one chip whose content
  is a sentence.
- **Sizes that earned their place:** team names 14px against a 20px crest (12px read as
  a caption under it); scores 15px, a step above the name so the number leads; headline
  13px semibold; detail rows 10px; tabs 10px bold with 0.08em tracking.
- **Crests are 20px.** At 12px on a 30px row a crest read as a bullet. ESPN runs ~18px
  against 12px type for the same reason.
- **Text on a `<button>` needs `text-left`.** A button centres its text by UA default. A
  single truncated line fills its width and hides it; a wrapped block centres whichever of
  its two lines is shorter, which reads as a random indent and was mistaken for a
  vertical-alignment bug.
- **Short names are derived by rule, checked against the whole catalog.** Never hand
  maintained. The rule set (`teamShortName.ts`) is proven over 2,022 real names with
  duplicate-spelling tolerance; anything within the 20-character budget is left whole,
  which means the *reservation* is what the chip renders, not an abbreviation.
- **Tabs longer than twelve characters take their first word.** "The Hollywood Reporter"
  is a 130px tab; "HOLLYWOOD" is not. "Science and Technology" → "SCI".
- **Decode entities and strip tags** before measuring or rendering feed text. Feeds send
  `&#39;` and `<p>`.
- **Truncate responsively.** At the cap the name gets the score slot's space back, so a
  chip with no score yet shows more of the name than one mid-game. Be generous: the
  first version gave back one character and was told so.

## 5. What the detailed row is for

It carries what the user would otherwise open the app to find. It is never something
derivable from the top row.

| Chip | Compact (the chip) | Detailed adds |
|---|---|---|
| Sports | tab · crest + name + score ×2 · clock | league position, record, points per side |
| Finance | symbol · price · change | intraday sparkline, day-range rail |
| News | tab · headline · age | the rest of the headline, then the summary in the room left |
| Clock | label · time (· moon) | date and offset — a zone can be on a different **day** |
| Timer | label · remaining | a draining bar, live-red in the last minute |
| Weather | label · icon · temperature | today's range bar; an alert sits under **its** city |
| Sysmon | label · gauge · value | a real trend, full-bleed, edge to edge |
| Uptime | cap · name · value | the heartbeat history, full-bleed |

- **A graphic on the detailed row runs full-bleed.** Divider to divider, no padding. A
  fixed-width sparkline in a wider cell left a quarter of the cell empty and was the
  first thing noticed.
- **The headline's second row is one measured block.** Whether the title fit on one line
  is *measured* (hidden sizer vs cell width), not counted — eighty characters can be
  anywhere from 470px to 560px in a proportional face. If it fit, the summary takes line
  two; if it wrapped, the summary continues after it in whatever room is left. The
  summary never widens the chip.
- **When there is nothing to say, say the one true thing.** A feed item with no summary
  and a short title shows the feed's own volume today ("Dev.to · 34 today") — real, not
  already on the chip, and the number that explains why five are showing and not thirty.

## 6. Colour

- **The widget's colour is the chip's colour.** Sports chips take their league's catalog
  brand; news takes the feed's; utilities take their widget token. The old single "sports
  red" was retired because it was an outdated model, not a decision.
- **Lift brand colours before tinting.** A navy tints invisibly on a dark surface.
  `liftForTint` gates on *luminance* (below 60), raising HSL lightness to 0.6 and
  saturation to 0.55 — gating on lightness alone turned F1's red into salmon.
- **Red means live or urgent, and nothing else.** A close game brightens the league's
  *own* colour (70% border, 14% fill, a glow mixed from the same accent). It used to turn
  the chip live-red, which on a rail where colour means league read as the wrong league —
  an MLS game wearing La Liga's paint. The muted and accent colour modes have no league
  colour of their own, so red still says close there.
- **Semantic borders never use the widget accent.** Alert (warning), down (red), urgent
  (live) borders have to mean the same thing on every chip.
- **Status caps are semantic, not branded.** UP / DOWN / MNT and ✓ / ✗ / ● carry their
  own tones; only the failing state pulses.
- **Colour modes:** `widget` (brand), `accent` (one shared palette), `muted` (grey). A chip
  reads its palette from `getChipColors(mode, widget)` and never hardcodes a hue.

## 7. Motion

- **Flash on a change of value, keyed on the *identity* of the thing.** The score flash
  compares scores only while the game id is unchanged. A rotating slot swapping games
  looked exactly like somebody scoring until the flash was keyed.
- **Paused does not pulse.** Motion implies counting.
- **Only the state that earns attention pulses**: live close games, a down monitor, an
  in-progress run.
- **A rotating slot never changes while on screen** (§8).

## 8. What is on the rail

The rail is not the feed. It has one rule per source and the user configures none of it.

1. **A horizon decides what is eligible.** Stated as a rule, not a count, so it breathes:
   sports keeps live games always, upcoming within 24h, finals within 18h of kickoff;
   news keeps the last 6h; finance and predictions keep the watchlist.
2. **A floor keeps a quiet source represented, not a dead one.** A league with nothing
   near shows its next fixture if it is within 7 days; a quiet feed shows its latest item
   if it is under 48h old. Past that, absence is the honest state.
3. **Fixed slots decide how many are on the bar at once.** Sports 4, news 3, finance 4,
   predictions 4, capped utilities 4. These are constants chosen from the chip's width
   and the source's typical volume — a busy MLB night is four chips, not thirty — and
   they are *not settings*. The one ticker control ever added ("N on the bar") was
   removed the same day: nothing on the ticker is user-configured, so nothing on it can
   be misconfigured.
4. **Everything eligible rotates through the slots; nothing is dropped.** A cap that
   drops games was the obvious fix and the wrong one — everything eligible is worth
   seeing, just not all at once.
5. **Favourites are pinned on top of the count**, never against it.
6. **A slot advances only once every instance of it has left the viewport.** The marquee
   renders an original and a clone one track-length apart; "off screen" means both.
   Rotation is once per lap, so a chip never changes under the reader's eyes.
7. **Each slot owns a residue class of the pool** (slot *i* shows pool[i], pool[i+k], …)
   with its own lap count. Slots leave the screen at different moments and need no
   coordination for every item to come round.
8. **A slot reserves the widest content in its own class** (§3). A swap cannot resize
   the chip, and the rail's total width never changes mid-scroll.
9. **Multi-feed sources interleave** so one loud wire cannot own the front of every
   slot's rotation.
10. **The rail is independent of the widget page.** Sort, filter, "Show N" and time
    window are about reading a list; re-sorting a list must never rearrange the bar.
11. **Pinned widgets never scroll, so nothing there rotates.** The first slots' items
    hold.

The cost, stated so it is chosen: a short item sharing a slot with a long one carries the
long one's whitespace, and a full slate takes pool ÷ slots laps to come round (fifty NCAA
games through four slots is about thirteen).

## 9. Data honesty

- **Design against real data.** Sports directions were drawn from 500 production games,
  the name rules from 2,022 catalog names, the news chip from real feed items, the
  prediction directions from 500 markets. When real data cannot exist locally (fantasy is
  user data, utilities are device-local), the canvas says so at the top and the fixtures
  are labelled representative.
- **Measure the worst case, then design the cap.** The 91-character prediction leg and
  the 139-character question, the 154-character Deadline headline, the two 20-character
  team names — the cap and the truncation exist for these, and the mock shows them.
- **A single point is not a trend.** A sparkline draws nothing below two readings; a lone
  dot next to a number implies movement that does not exist. The sysmon buffer keeps
  repeats (a flat CPU is real history) and guards on the *clock*, because a buffer that
  keeps repeats cannot rely on collapse-repeats to make recording-during-render safe — a
  StrictMode double-invoke would land as fake history.
- **Never fabricate a value.** A missing reading reserves its space and shows nothing;
  an empty score is blank, not "—"; a stopwatch with no target has no bar.
- **The chip's own arithmetic is what the tests cover.** Reservation widths, residue-class
  walks, lap counting, the fit measurement, the clock guard.

## 10. Process

- **Canvas first, then code.** Every chip family was drawn on the Claude Design canvas
  with many real fixtures across states, in ten directions, compact first. The user
  picks from options; prose does not get picked from.
- **Show worst cases and why.** "Why are these boxes that size" was answered with a page
  that rendered each reservation at its maximum.
- **Verify on the running bar, then measure.** A design that has not been looked at on
  the rail is not done. When something cannot be seen (the bar runs in Tauri), build a
  harness that mounts the real chip and the real rule and logs the numbers — the rotation
  was signed off on a run showing every slot's width identical to 0.1px across five games
  and zero swaps while visible.
- **Ship whole families.** Sports, finance and news went out together; the utilities
  together; the rotation for every source together. A rail carrying two languages is the
  thing this language exists to avoid.

## 11. Traps that cost a round each

- **An interpolated Tailwind class compiles to nothing, silently.** Tailwind reads source
  text; `` `grid-cols-[..._${n}px]` `` produces no CSS and the element falls back to auto.
  A test asserting the class *string* still passes. Write both branches literally, and
  verify against the served stylesheet (`curl …/src/style.css?direct`), never the markup.
- **`<button>` centres its text.** §4.
- **Arbitrary-value classes are not valid CSS selectors in tests.** Check `classList`.
- **The embedded browser pane only paints frames on demand.** `requestAnimationFrame`
  never ticks between screenshots there, so anything rAF-driven (the marquee) looks
  frozen; timers keep real time and layout reads are synchronous. Drive a harness with a
  timer.
- **HMR breaks on new module exports.** Restart the app after adding one.
- **A near-invisible divider looks like a design choice.** It is not; check the contrast
  arithmetic before accepting a "subtle" rule.

## 12. Rejected, so they are not proposed again

- Two different layouts for compact and detailed.
- Every chip the same fixed width (264px). Ragged rails were the complaint; content-sized
  with reservations is the answer.
- Five dots / spines as decoration on leagues that do not need them.
- "—" for an empty score. Blank.
- A shared red for close games. The league's own colour, brighter.
- The range bar beside the temperature in compact. The widest cell on the rail on the
  chip with the least to say.
- Monitors as cells inside one chip. A single red block must be findable without
  reading; cells make every monitor equally loud.
- A per-widget ticker count control. Removed.
- The zone name twice on a clock ("CDT · Fri, Sep 4 · GMT-5"). The offset is the
  unambiguous one.
- Dropping eligible items to make room. Rotate them.
