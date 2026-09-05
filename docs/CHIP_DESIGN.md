# How a chip works

*The short version of the ticker chip rules. Read this first; the exact spec with every
number, class and file is `docs/CHIP_SPEC.md`. If the two ever disagree, the spec wins.*

---

## One rule above all

**Compact is the chip. Detailed is the same chip with one extra row underneath. Nothing
on the top row moves.**

That's it. If you remember one thing, remember this. A user should be able to switch
density and recognise every chip instantly, because the only difference is a row of
extra detail appearing beneath what was already there.

## What a chip looks like

Every chip is the same sentence, left to right:

```
[ who ] [ what ] [ the number that changes ]
```

- **Who** is a small painted tab: the league, the feed, the widget. It's the one place
  the chip's colour is actually filled in rather than hinted.
- **What** is the middle, and it's the part that flexes: team names, a headline, the
  clocks.
- **The number that changes** sits in its own box on the right, with a line before it.
  Game clock, article age, uptime. Boxing it in is what keeps the rest of the chip from
  shuffling when it ticks.

Cells are separated by thin lines in the chip's own colour, strong enough to see. Chips
are as wide as their content, up to a limit, and then names get cut short.

## The bar must never jump

A ticker is the one place where numbers are guaranteed to change while you're looking
at them. So a chip reserves room for everything that can change before it changes: a
score that will go from 9 to 10, a clock that will read "Q4 2:14", a name that will be
swapped for a longer one. The reservation is sized from real data, not a guess, and only
as big as that league or feed actually needs.

The test is simple: put the same chip on screen before the game, during it, and after it.
If the three aren't exactly the same width, it isn't finished.

## What the second row is for

The extra row answers the question you'd otherwise open the app for. It never repeats the
top row.

| Chip | The top row says | The second row adds |
|---|---|---|
| Sports | who's playing, the score, the clock | where each team sits in the table |
| Finance | symbol, price, change | the day's line and range |
| News | the headline, how old it is | the rest of it, and the summary |
| Clock | the time in each zone | the date — Tokyo may already be tomorrow |
| Timer | time remaining | a bar draining down |
| Weather | city, icon, temperature | today's low and high, or a storm warning |
| Sysmon | the reading | a live trend line |
| Uptime | the monitor and its status | its recent heartbeat history |

If there's a graphic, it fills the whole cell edge to edge. If there's nothing worth
saying, the row stays empty rather than getting filler.

## Colour

- A chip wears its own colour: the league's, the feed's, the widget's. Dark brand colours
  are lightened a little so they show on the dark bar.
- **Red means "live" or "something's wrong", and nothing else.** A close game gets brighter
  in its own colour; it doesn't turn red. A red monitor is down. A red timer is in its
  last minute.
- Dividers, tabs and text all come from one shared palette. A chip never picks its own hue.

## Movement

- A score flashes once when it changes, and only when *that game's* score changes.
- Things that are paused don't pulse. Only things that need your attention do: a close
  live game, a down monitor, a build in progress.

## The feed page and the ticker are two different things

They show the same data and they are not the same product.

**The feed page is for reading.** You open it on purpose, you sit with it, and you make it
yours: sort it, filter it, cut it to today, show ten or show all. Every control there is a
way of reading a list, and all of them are yours.

**The ticker is for glancing.** It's on all day whether you're looking or not. It has one
job: show you what's happening now, in a fixed amount of room, without ever needing
you. So it has no controls of its own. It decides what's on it, how many, and in what
order, from one rule per kind of thing, and then it rotates through everything eligible
so you still see it all.

The line between them is simple. **Anything about *reading* belongs to the feed page and
never reaches the bar. Anything about *what's on the bar* isn't a setting at all.**

That's why we did two things together: gave every source a fixed number of places on
the bar, and made the chips rotate their contents rather than adding and removing chips.
A user never has to answer "how many do I want on the ticker", and the bar never grows,
shrinks or jumps. It just works.

## What you control, and what you don't

**You control your inputs.** Which widgets are on the ticker at all. Your watchlist, your
starred markets, your favourite team, your feeds, your time zones, your cities, which
system metrics matter to you, which monitors and repos to watch. These are *what you
care about*, and they're yours everywhere.

**You control how the bar looks and moves.** Compact or detailed. Speed, direction, gap,
whether it pauses on hover. Continuous, step or flip. Grouped or woven. Colour mode. Pin a
widget so it never scrolls. Where the bar sits.

**You don't control selection.** How many of a widget's things are on the bar at once,
which of them, in what order, how far back or ahead it looks, or how the rotation runs.
Those are fixed per kind of thing, chosen once from real data, and they never appear as
a setting. If a user could set them, a user could get them wrong.

One leftover from before this rule: the fantasy widget still has an Essential / Standard
/ Everything dial for its ticker. It's a selection control, and it will be reconciled
when fantasy is rebuilt (REL-184). Followed players stay, since that's an input.

## What goes on the bar

The bar isn't the feed. It has one rule per kind of thing, and there are no settings for
it. Nothing on the ticker can be misconfigured because nothing on it is configured.

1. **A time window decides what's eligible.** Live games always; games starting within a
   day; results from the last eighteen hours; headlines from the last six hours; your
   watchlist.
2. **A quiet source still gets one chip** — its next fixture, its latest headline — as
   long as that isn't stale. A dead source shows nothing.
3. **Each kind of thing gets a fixed number of places.** Four games per league, three
   headlines, four symbols. Those numbers are chosen once, from how wide the chip is and
   how much that source produces.
4. **Everything eligible takes turns.** Nothing is dropped. A busy baseball night is four
   chips, and every game still comes round.
5. **Your favourite team is always on**, on top of those four.
6. **A chip only swaps its content while it's off screen.** Never under your eyes.
7. **The bar doesn't care how you sorted the list.** Sorting and filtering are for reading
   the widget page; they don't rearrange the ticker.

The honest cost: a short name sharing a place with a long one carries the long one's
width, and a full slate takes a few laps to see. Fifty college games through four places
is about thirteen laps.

## Keep it honest

- Design against real data. Real games, real feeds, real markets. When real data can't
  exist locally (fantasy is personal, clocks are your machine), say so on the mock.
- Find the longest name, the longest headline, the biggest score before deciding anything.
- One reading is not a trend; a line needs two points. Nothing gets made up to fill a gap.

## How we work

1. Draw it first, on the canvas, with lots of real examples, compact before detailed.
2. Pick a direction, then build exactly that.
3. Look at it on the running bar. If something can't be seen, measure it instead.
4. Ship a whole family at once, so the bar never speaks two languages.

## Things we've already decided against

Two different layouts for the two densities. Every chip the same width. Dots and spines as
decoration. A dash where a score should be blank. A shared red for close games. The
weather range squeezed into the compact row. Monitors packed into one chip as cells. A
per-widget "how many on the bar" control. Naming a time zone twice. Dropping items instead
of rotating them.

## Still to do

Predictions, fantasy and GitHub chips haven't been rebuilt on these rules yet (REL-184).
