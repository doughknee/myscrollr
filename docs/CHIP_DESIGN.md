# How the ticker works

*The short version of the ticker rules. Read this first; the exact spec with every number,
class and file is `docs/CHIP_SPEC.md`. If the two ever disagree, the spec wins.*

Widget pages are new and arrive with the desktop release after 1.6.10. Until then the app
you have is the second way of showing the bar, Continuous chips. Anything marked *(lands
with SCROLLR-xxx)* is decided but not in the app yet.

---

## One rule above all

**The bar has one height, and nothing on it moves while you are reading it.**

That's it. If you remember one thing, remember this. There is no density setting and no
compact version: every widget gets one polished layout instead of two, and a number
changing never shifts the things next to it.

## Two ways to show the bar

The bar can show what's going on in two ways. **Pages** is the default. **Continuous** is a
choice in Settings › Ticker › Scroll mode. They are two presentations of the same bar: they
use the same rules about *what* belongs on it, and differ only in *how* it reaches your
screen.

| | Pages (default) | Continuous |
|---|---|---|
| What you see | One whole widget at a time, laid out in equal columns across the bar, then a swipe to the next | Chips scrolling right to left without stopping |
| How much shows | As many as fit the width of your screen | A fixed few per widget, the rest rotate |
| Clock, weather, pins | A fixed block at the right end | Chips in the scroll, or pinned at the end |
| A widget with nothing on | One shared "Also" page at the end | One grey chip saying why |

Everything in "What goes on the bar" below is true of both. Existing users switch to Pages
once, at the release, with a one-time notice that Continuous is one click away in Settings
*(lands with SCROLLR-277)*.

---

## Pages

### What a page looks like

```
‹ 7/23 › [ label ] [ game ] [ game ] [ game ] [ game ] [ game ] | [ clock ] [ pin ]
```

- **The pager** at the far left says where this page is in the whole trip round the bar:
  7/23 means the seventh of 23 pages across every widget. While your mouse is on the bar,
  a ‹ and a › appear either side of it to go back or forward a page. Don't want it? Turn
  off **Page controls** in Settings › Ticker, or right-click the bar and untick it: the
  columns get its space, and the wheel and arrow keys still page.
- **The label** right after it is 168 pixels: the widget's name in its own colour (NFL, BBC,
  Stocks) and, beneath it, what the widget has on the bar and how many pages that takes
  (56 GAMES · 19 PAGES, 3 STORIES · 1 PAGE), so you can see there's more and how much.
  The pager and the label are one block; a line along its bottom edge fills as the page
  runs out of time. Hover the bar and a ˄ above the name and a ˅ below it jump to the
  previous or next widget (so do ↑ and ↓, and Shift+wheel).
- **The page** is one widget's items in equal columns that fill the bar. How many columns
  is a matter of your screen width and how much room that kind of thing needs: four NFL
  games on a 1280-pixel bar, six on a 1920 one, but only two headlines, because a
  headline needs 400 pixels to be readable. There are no cards or boxes, just the items,
  with a thin line between them.
- **The edge** at the right holds the small things that should always be there. See below.

### Everything the widget page shows

The bar shows everything the widget's own page in the app shows, in the bar's own order.
There's no time window on pages: if NPR has 30 headlines, all 30 come round on the bar.

- **Sports:** the whole week, as the app shows it: live games, your team, then the soonest
  kick-off, then yesterday's results. On a Thursday morning the NFL widget is tonight's
  game, Sunday's slate and Monday night.
- **News:** every headline the feed has (we keep a week of them), newest first.
- **Stocks and crypto:** your watchlist, in your order.

**Each lap, every widget shows its next page**, one page, then the bar moves on. **The
next visit carries on where the last one stopped**, so a feed of 8 pages shows page 1 this
trip round, page 2 the next, and so on to page 8, then page 1 again. Sports work the same
way: live games and your team are on page 1, so they come round first after the last
page, but a widget with 4 pages shows them every fourth lap, not every lap. Nothing is
left out; it comes round in turn, and the bar doesn't sit on one feed. New headlines
arriving in between don't send it back to the start. The label's 2/8 tells you where you
are.

### Every page is full

A page always has an item in every column, unless the widget really has fewer things than
one page holds. If your watchlist is shorter than a page, the empty spaces show popular
symbols. They are **not** added to your watchlist: each one wears a small + before its symbol, the
watchlist screen offers each one as a one-click add, and every symbol you add takes the
place of one of them. Filling only ever uses the empty spaces on the last page, so a widget
never gets extra pages from it and the bar takes no longer to go round.

If a widget truly has fewer things than a page (one game all week), they keep the width
they'd have on a full page, starting next to the label, rather than one item stretched
across the whole bar.

### Pages stay still

**Nothing on a page moves while it is up.** The games on it, their order and their width
are fixed when the page swipes in. A score ticking, a price changing, the clock counting:
those change in place, in boxes that were already big enough. A game turning close, a new
headline arriving, a window being resized: those wait for the next page. You never lose
your place under your cursor.

### How the bar moves

- **A page holds 6 to 12 seconds**, longer when it's fuller. Never faster.
- **The swipe takes 0.6 seconds.** If your system asks for reduced motion, it's a
  crossfade instead.
- **Hover holds the page.** Put your mouse on the bar and it waits. There is no setting for
  it under Pages.
- **One page per widget per lap.** When the bar reaches a widget it shows its next page,
  then moves on. Every widget takes the same one-page turn, news, stocks and sports
  alike. A busy Saturday of 56 college games takes many laps to see everyone, and a live
  game waits its turn with the rest: it is on page 1, so it shows each time the widget
  comes back round to the start. One trip round the whole bar takes at most a minute.
- **Page through it yourself.** Scroll the mouse wheel over the bar: down for the next
  page, up for the one before (one page per notch; a trackpad swipe sideways works too).
  Or click the ‹ › at the far left of the bar, or press ← → once you've clicked the bar.
  Going back slides the bar the other way, and from a widget's first page takes you to
  the previous widget's last. To skip a whole widget, press ↓ (or hold Shift while you
  scroll); ↑ goes back to the widget before, on the page you were reading. Each page you step
  to gets its full time, and when the bar moves on by itself it carries on from there, so
  it won't show you again what you just paged through. With a bar on several monitors,
  they all turn together.

### The edge

A fixed block at the right end of the bar that doesn't swipe away.

- **Clocks and weather** each get one spot. A spot shows **one time zone or one city at a
  time** and steps to the next on every swipe, so three clocks and a weather widget take
  two spots, not five. The spot is as wide as its widest item from the start, so the
  clock reading 12:00 and then 9:07 never shifts anything.
- **Pins** sit after them (see "Pinning").
- Clock and Weather don't use up one of your widget slots.
- The edge never takes more than 40% of the bar, so the pages always have room.

### The Also page

A widget you added that has nothing to show right now doesn't vanish and doesn't get its
own empty page. All of them share one page at the very end: "EPL · next match Sat 10 Oct",
"NBA · off-season", "PBS · no headlines in the last 2 days". Never a made-up date.

### Colour and a new account

Each page is painted in its widget's own colour. A new account starts with NPR, Stocks and
a clock on the edge, so the bar shows news, markets and the time with no setup.

---

## Continuous chips

Chips are the original bar, still there if you prefer it.

### What a chip looks like

Every chip is the same sentence, left to right, in two rows:

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

Cells are separated by thin lines in the chip's own colour. Chips are as wide as their
content, up to a limit, and then names get cut short.

### The chip must never jump

A ticker is the one place where numbers are guaranteed to change while you're looking at
them. So a chip reserves room for everything that can change before it changes: a score
that will go from 9 to 10, a clock that will read "Q4 2:14", a name that will be swapped
for a longer one. The reservation is sized from real data, not a guess. Page cells do
exactly the same inside their columns.

The test is simple: put the same chip on screen before the game, during it, and after it.
If the three aren't exactly the same width, it isn't finished.

### How the rail works

Each widget gets a few places on the rail (four games per league, three headlines, four
symbols), and everything eligible takes turns in them. A chip only swaps its content while
it's off screen, never under your eyes. Your favourite team is on top of those four. The
honest cost: a short name sharing a place with a long one carries the long one's width,
and a full slate takes a few laps to see.

---

## What the second line is for

Both ways of showing the bar have a second line (or row) under the top one. It answers the
question you'd otherwise open the app for and never repeats the top.

| Item | The top says | The second line adds |
|---|---|---|
| Game | who's playing, the score, the clock | where each team sits in the table (a chip also says where, before kick-off). A narrow page cell has no second line: it spends the room on bigger names and scores, with an @ on the home team |
| Stock or coin | symbol, price, change | the day's line and the day's range |
| Headline | the headline, how old it is | the summary, or which feed it's from |
| Clock | the time in each zone | the date: Tokyo may already be tomorrow |
| Timer | time remaining | a bar draining down |
| Weather | city, temperature | today's low and high, or a storm warning |
| Sysmon | the reading | a live trend line |
| Uptime | the monitor and its status | its recent heartbeat history |

If there's a graphic, it fills the whole cell edge to edge. If there's nothing worth
saying, the line stays empty rather than getting filler.

## Colour

- Everything wears its own colour: the league's, the feed's, the widget's. Dark brand
  colours are lightened a little so they show on the dark bar.
- **Red means "live" or "something's wrong", and nothing else.** A close game is marked in
  its own colour (a brighter tint on a chip, a line along its foot on a page); it doesn't
  turn red. A red monitor is down. A red timer
  is in its last minute.
- Dividers, tabs and text come from one shared palette. A cell never picks its own hue.
- You pick a theme (ten palettes, light or dark). There is no separate
  "chip colors" choice: every widget uses its own.

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
job: show you what's happening now, in a fixed amount of room, without ever needing you.
So it has no controls of its own for what's on it. It decides what's on it and in what
order, from one rule per kind of thing, and then it works through everything eligible so
you still see it all.

The line between them is simple. **Anything about *reading* belongs to the feed page and
never reaches the bar. Anything about *what's on the bar* isn't a setting at all.**

## What you control, and what you don't

**You control your inputs.** Which widgets are on the ticker at all. Your watchlist, your
starred markets, your favourite team, your feeds, your time zones, your cities, which
system metrics matter to you, which monitors and repos to watch. These are *what you care
about*, and they're yours everywhere.

**You control how the bar looks and moves, a little.** Pages or Continuous, the bar's size,
where it sits, which screens it's on, your theme. Continuous also has speed, pause on
hover and whether widgets are grouped or woven. The fewer settings the better: the aim is
a default that's right.

**You can pin a few things.** See below. A pin is its own thing, and it's the one control
that's a bit of both.

**You don't control selection.** How many of a widget's things are on the bar at once,
which of them, in what order, how far back or ahead it looks, how many columns a page has,
or how the rotation runs. Those are fixed per kind of thing, chosen once from real data,
and they never appear as a setting. If a user could set them, a user could get them wrong.

## What goes on the bar

The bar isn't the feed. It has one rule per kind of thing, shared by Pages and Continuous,
and there are no settings for it. Nothing on the ticker can be misconfigured because
nothing on it is configured.

1. **On Pages, everything the widget page shows is eligible** (see "Everything the widget
   page shows"). **On Continuous, a time window decides**: live games always; games
   starting within a day; results from the last eighteen hours; headlines from the last
   six hours; your watchlist.
2. **A quiet source still gets something**: on Continuous, its next fixture or its latest
   headline, as long as that isn't stale. A source with nothing at all says why and, when we know,
   when ("NBA · off-season"). That's the Also page under Pages and a grey chip under
   Continuous. Never a made-up date.
3. **Everything eligible gets its turn.** Nothing is dropped. Pages work through it page by
   page; Continuous rotates it through its places.
4. **Live games and your favourite team come first.** On Pages they're on page 1 of their
   widget; on Continuous your favourite team is always on, on top of the usual places.
5. **The bar doesn't care how you sorted the list.** Sorting and filtering are for reading
   the widget page; they don't rearrange the ticker.
6. **Nothing changes under your eyes.** A page is frozen while it's up; a chip only swaps
   its content while it's off screen.
7. **Pinned things sit still** at the end of the bar, see next.

## Pinning

A pin parks something at the end of the bar so it never goes away. It's the one thing on
the ticker you get to decide the position of, and it works like this:

**You pin a thing, not a widget.** A team. A symbol. A feed. A market. A monitor. Your
clock. Never "the MLB widget" — that used to be the only thing a pin could mean, and it
had a nasty side effect: parking a widget froze its rotation, so the ninth monitor or the
twentieth symbol could never come round. Pin the Yankees and you get the Yankees.

**A pinned thing shows whatever it's doing now.** Pin a team and the same spot carries
tonight's live game, then the final, then Sunday's fixture, in place, without you touching
it.

**A pin ignores the time window.** The bar normally only shows a game starting within a
day. A pin is you overriding that for one thing, so a pinned team's next fixture shows
even if it's nine days out.

**Nothing to show shows nothing.** A team between seasons leaves an empty space, not a
placeholder. The chip comes back when the team does.

**A pinned thing isn't also on the pages or the tape.** It's in one place, not two. Under
Pages that place is the edge.

**There's a limit, and it says no.** It's by width: the edge never takes more than 40% of
the bar (measured on the narrowest screen the ticker is on), so a pinned headline (one
narrow line) costs less than a pinned game, and a small screen holds fewer pins than a big
one. Pin one too many and it tells you why, naming what's in the way, rather than quietly
dropping one of yours. If a screen gets smaller, the newest pins step back onto their
normal pages until there's room, and come back when there is.

**Pinning is not starring.** A star, a favourite, a watchlist entry all mean "always on,
first in line". A pin means "out of the flow, parked". They're different jobs and they
stack: pin your favourite team and the rest of your favourites carry on as before.

**You pin by right-clicking the bar** — on the item itself, so the menu can say "Pin
Yankees" and mean it. Also from a widget's own page, next to the thing, and from the
sidebar for the one-chip widgets.

**Nothing gets pinned for you.** Adding a widget just tells you it was added.

## Keep it honest

- Design against real data. Real games, real feeds, real markets. When real data can't
  exist locally (clocks are your machine), say so on the mock.
- Find the longest name, the longest headline, the biggest score before deciding anything.
- One reading is not a trend; a line needs two points. Nothing gets made up to fill a gap.

## How we work

1. Draw it first, on the canvas, with lots of real examples.
2. Pick a direction, then build exactly that.
3. Look at it on the running bar. If something can't be seen, measure it instead.
4. Ship a whole family at once, so the bar never speaks two languages.

## Things we've already decided against

Two different layouts for two densities (the compact one is deleted). Every chip the same
width. Dots and spines as decoration. A dash where a score should be blank. A shared red
for close games. The weather range squeezed into the top row. A per-widget "how many on the
bar" control. A setting for how many columns a page has. Pages that re-sort or resize while
you read them. Ranking a page by how close a game is. A page for a widget with nothing to
say. Dropping items instead of taking turns. Pinning a whole widget. A pin icon on the
chip. Auto-pinning what you just added. Merging pins with stars and favourites. A pinned
zone that scrolls. Evicting someone's pin to make room for a new one. A hover setting under
Pages. One item stretched across a page. Centring a short page away from its label. Adding
popular symbols to your watchlist for you. A time window on pages that hides part of what
the widget page shows. Starting a widget from its first page on every visit.

## Still to do

GitHub chips haven't been rebuilt on these rules yet.
