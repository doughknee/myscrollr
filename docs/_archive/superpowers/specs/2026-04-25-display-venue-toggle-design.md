# Spec: Display-page Venue Toggle + Fantasy Ticker Expansion

**Status**: draft — approved 2026-04-25
**Authors**: Brandon + AI pair
**Target release**: v1.0.2

## Summary

Unify the Display pages across all four channels (finance, sports, rss,
fantasy) around a single four-state visibility control — `off | feed |
both | ticker` — so that every visibility setting can be independently
routed to the feed page, the always-on-top ticker, both, or hidden.

Expand the fantasy ticker from its current single-boolean
`tickerShowMatchup` switch to ten individually-toggleable items covering
matchup, standings, and roster insight.

This cements the "Display page = single source of truth for both venues"
mental model that landed in the 2026-04 selector-hook refactor
(`desktop/src/channels/*/view.ts`) — before this spec, the hooks made the
DATA flow consistent, but the UI still only offered booleans so users
couldn't actually split a setting between venues. Now they can.

## Problem Statement

Today each Display page offers on/off checkboxes for each visibility
setting. Every checkbox is applied identically to both the feed page AND
the always-on-top ticker — there's no way for a user to, say, keep `%
change` out of the ticker while still seeing it in their feed cards.

Fantasy has the opposite problem: one switch (`tickerShowMatchup`)
controls whether *anything at all* shows on the ticker. Users asking
"can I see my team's record on the ticker?" or "can I see the league
streak?" get "no" — the data's all there in the dashboard payload, we
just haven't surfaced per-item ticker toggles.

## Goals

1. Every visibility setting that makes sense in both venues gets a
   four-state venue control.
2. Settings that are structurally feed-only (like "default sub-tab") stay
   as their existing single-venue controls.
3. Fantasy ticker: 10 new items that users can individually opt into.
4. Migration from current booleans is zero-surprise: users who currently
   see / don't see a thing continue to see / not see it.

## Non-Goals

- No arbitrary "custom stat picker" for fantasy (would require a
  stat-catalog UI + Yahoo column selection; deferred).
- No venue toggle for the data-model settings like `primaryLeagueKey`,
  `enabledLeagueKeys`, `articlesPerSource`, `defaultSort` — those are
  shared by both venues and don't benefit from a venue toggle.
- No UI for sharing a venue config between users or devices — prefs stay
  per-install (same as today).

## Design

### The enum

```ts
export type Venue = "off" | "feed" | "both" | "ticker";
```

Four states. `off` exists so migrating `false`-booleans keeps the
hide-everywhere behavior current users rely on. The other three cover
the stated UX goal ("feed only, ticker only, or both. with both in the
middle").

### The component

`desktop/src/components/settings/VenueRow.tsx` (new):

```tsx
interface VenueRowProps {
  label: string;
  description?: string;
  value: Venue;
  onChange: (venue: Venue) => void;
  /**
   * When provided, only these venue options are enabled in the segmented
   * control. Used when a setting is ticker-structural-only (rare).
   * Defaults to all four states.
   */
  allowed?: Venue[];
}
```

Visual:

```
 Show % change                    [ Off  Feed  Both  Ticker ]
 description text                               ^^^^ selected
```

- Rendered as a 4-button segmented control inside the existing `Section`.
- Buttons use existing design tokens (`bg-accent` for selected,
  `text-fg-3` for unselected, `bg-surface-2` for `off` when selected to
  emphasize "disabled" semantically).
- ARIA: `role="radiogroup"`, each button `role="radio" aria-checked`.
- Keyboard: arrow keys move between options per APG radiogroup pattern.

### Migration

In `loadPrefs()`, for every display-prefs field whose shape changes from
boolean to `Venue`:

```ts
function migrateVenue(raw: unknown): Venue {
  if (raw === "off" || raw === "feed" || raw === "both" || raw === "ticker") {
    return raw;
  }
  if (raw === true) return "both";
  if (raw === false) return "off";
  return "both"; // unknown / unset → default visible
}
```

The `tickerShowMatchup` boolean gets folded into the new
`matchupScore` Venue setting at migration time:

```ts
// Fantasy: combine showMatchups (feed section) + tickerShowMatchup into
//          the new per-item ticker venue enums. The feed-section toggle
//          stays as-is (it's structural). The ticker boolean maps to
//          matchupScore: on=both, off=feed.
matchupScore: (fantasy.tickerShowMatchup ?? true) ? "both" : "feed",
```

### Per-channel inventory

#### Finance — `FinanceDisplayPrefs`

```ts
interface FinanceDisplayPrefs {
  showChange: Venue;        // was boolean
  showPrevClose: Venue;     // was boolean
  showLastUpdated: Venue;   // was boolean
  defaultSort: "alpha" | "price" | "change" | "updated";  // unchanged
}
```

Display page layout:
```
Appearance
  Show % change           [Off Feed Both Ticker]
  Show previous close     [Off Feed Both Ticker]
  Show last updated       [Off Feed Both Ticker]

Default Sort
  Sort order              [A–Z | Price | % Change | Updated]
```

#### Sports — shape change only (no backend schema migration)

```ts
// Stored per-user on `user_channels.config` (JSONB). No schema migration
// needed — JSONB passes any JSON through.
interface SportsDisplayPrefs {
  showLogos: Venue;
  showTimer: Venue;
  showUpcoming: Venue;
  showFinal: Venue;
}
```

`useSportsConfig` becomes the migration point. It reads `raw.display`,
runs each field through `migrateVenue` at merge time, and writes the new
Venue shape back on any user change. Old boolean-era configs continue to
deserialize correctly forever because `migrateVenue` handles both input
shapes.

Display page layout:
```
Appearance
  Show team logos         [Off Feed Both Ticker]
  Show game clock/status  [Off Feed Both Ticker]

Default filters
  Include upcoming        [Off Feed Both Ticker]
  Include final scores    [Off Feed Both Ticker]
```

#### RSS — `RssDisplayPrefs`

```ts
interface RssDisplayPrefs {
  showDescription: Venue;     // was boolean
  showSource: Venue;          // was boolean
  showTimestamps: Venue;      // was boolean
  articlesPerSource: number;  // unchanged (feed-only structural)
}
```

Display page layout:
```
Feed & Ticker
  Show description        [Off Feed Both Ticker]
  Show source name        [Off Feed Both Ticker]
  Show timestamps         [Off Feed Both Ticker]

Feed balance
  Articles per source     [2 | 4 | 6 | 10 | All]
```

#### Fantasy — the biggest change

```ts
interface FantasyDisplayPrefs {
  // ── New per-item venue controls ──
  matchupScore: Venue;         // was tickerShowMatchup boolean
  winProbability: Venue;       // new
  matchupStatus: Venue;        // new (LIVE/FINAL/PRE badge)
  projectedPoints: Venue;      // new
  week: Venue;                 // new
  record: Venue;               // new
  standingsPosition: Venue;    // new
  streak: Venue;               // new
  injuryCount: Venue;          // was showInjuryCount boolean
  topScorer: Venue;            // new

  // ── Feed-structural (unchanged) ──
  showStandings: boolean;      // render standings section in feed
  showMatchups: boolean;       // render matchups section in feed
  defaultSubTab: FantasySubTab;
  primaryLeagueKey: string | null;
  enabledLeagueKeys: string[];
  defaultSort: "name" | "season" | "record" | "matchup";
}
```

Display page layout:
```
Ticker & feed items
  Matchup score           [Off Feed Both Ticker]
  Win probability         [Off Feed Both Ticker]
  Matchup status          [Off Feed Both Ticker]
  Projected points        [Off Feed Both Ticker]
  Week number             [Off Feed Both Ticker]
  Team record             [Off Feed Both Ticker]
  Standings position      [Off Feed Both Ticker]
  Current streak          [Off Feed Both Ticker]
  Injury count            [Off Feed Both Ticker]
  Top scorer              [Off Feed Both Ticker]

Feed layout
  Default view            [Overview | Matchup | Standings | Roster]
  Show standings section  [Toggle]
  Show matchups section   [Toggle]
```

### New fantasy ticker items — data sources

Every item renders only when its data is actually available for the
league (e.g., `standingsPosition` hides during pre-season). All data is
already in the `LeagueResponse` payload — zero backend changes.

| Item | Source | Fallback when missing |
|---|---|---|
| matchupScore | `userMatchupContext(league)` → `user.points` / `opponent.points` | hide |
| winProbability | `estimateWinProbability(matchup, league.team_key)` | hide if null |
| matchupStatus | `matchup.status` → `LIVE` / `FINAL` / `PRE` | hide |
| projectedPoints | `user.projected_points` | hide if null |
| week | `matchup.week` or `league.data.current_week` | hide |
| record | `userStanding(league)` → `wins-losses-ties` | hide |
| standingsPosition | `userStanding(league)` → `rank` + `num_teams` | hide if pre-season |
| streak | `userStanding(league)` → `streakLabel(type, value)` | hide if no streak |
| injuryCount | `countInjuries(userRoster(league))` | hide if 0 |
| topScorer | iterate `userRoster(league).data.players` by `player_points` desc, skip bench | hide if no scorer |

### Selector changes

Each channel's `view.ts` adds a `resolveVenue()` helper and updates its
`selectXxxForTicker` to filter by venue:

```ts
// desktop/src/channels/finance/view.ts
export function shouldShowOnTicker(venue: Venue): boolean {
  return venue === "both" || venue === "ticker";
}

export function shouldShowOnFeed(venue: Venue): boolean {
  return venue === "both" || venue === "feed";
}
```

`ScrollrTicker`'s per-channel branch reads each setting through these
helpers. `FeedTab` components use the same helpers when rendering
individual columns/stats. This is the ONLY place the venue → render
decision is made.

### New component: `FantasyStatChip`

`desktop/src/components/chips/FantasyStatChip.tsx` — renders a compact
ticker chip showing all the enabled per-league stats for a single
league, concatenated:

```
MyLeague · Week 5 · 6-3 · 3rd of 10 · W3 · LeBron 42.3 · 62% win
```

When none of the per-league items are set to `both`/`ticker`, no chip
renders for that league at all (replaces today's "is the whole fantasy
ticker on" switch — the new answer is "does any item say to show?").

The existing `FantasyChip` is kept for the FeedTab; `FantasyStatChip` is
a new compact ticker-only variant. Name them distinctly so their
responsibilities stay clear.

## Architecture Rules followed

- Channel isolation preserved: the `Venue` type lives at
  `desktop/src/preferences.ts` (already a shared module). Each channel's
  view.ts uses the type locally. No cross-channel imports.
- Pure functions: `shouldShowOnTicker`, `shouldShowOnFeed`,
  `migrateVenue`, and all the fantasy data extractors are pure and fully
  unit-testable.
- Backward compatibility: `loadPrefs()` migration handles both boolean
  and Venue inputs → no user-visible regression on update.

## Tests

### Desktop Vitest additions

- `desktop/src/components/settings/VenueRow.test.tsx` — renders all 4
  states, keyboard nav, aria attrs, onChange callback fires.
- `desktop/src/preferences.test.ts` (new) — `migrateVenue` for all
  inputs (boolean, string, unknown), full `loadPrefs` migration path
  for all four channels.
- Extend each channel's `view.test.ts`:
  - `selectRssForTicker` respects `showDescription: "feed"` by not
    adding the description to ticker output.
  - `selectFinanceForTicker` respects `showChange: "off"` by hiding
    the field everywhere.
  - New `selectFantasyForTicker` tests for each of the 10 items:
    `matchupScore: "feed"` → no chip entry, `winProbability: "ticker"`
    → chip renders even though feed card hides it, etc.
- `desktop/src/components/chips/FantasyStatChip.test.tsx` — composes
  correct string from a prefs + league fixture, hides gracefully when
  a field's data is missing.

### Go API tests

None needed — sports config is stored as JSONB passthrough, so the Venue
shape flows through the existing serializer without any code change.

## Rollout

1. Implement `VenueRow` + `preferences.ts` migration + types update.
2. Per-channel selector + view.ts update (tests first, TDD).
3. Per-channel Display page UI rewrite.
4. Fantasy: `FantasyStatChip` component, wire into `ScrollrTicker`.
5. Sports: `useSportsConfig` migration at read-time + venue-shaped writes.
6. Verify: build + test all, manual smoke on the Display page.

## Success Metrics

- No user reports of "I enabled X on the Display page but it didn't
  update the ticker" (the universal-sorting + venue toggles close this
  entire bug class).
- At least one fantasy-using super-user reports using >3 fantasy ticker
  items post-launch (validates expansion was worth shipping).
- Zero migration crashes (prefs load clean from any boolean-era state).

## Open Questions

- Should `defaultSort` have a "ticker sort override"? (i.e., alphabetical
  in feed but "% change" descending on ticker). Probably yes-in-v1.1 —
  for now the feed sort is the only sort and it affects both. Decision:
  defer.
- Should fantasy `topScorer` show across leagues (highest-scoring player
  across all my teams) or per-league? **Per-league** for now — keeps the
  chip composition logic simple and matches the rest of the chip's
  per-league semantics.
