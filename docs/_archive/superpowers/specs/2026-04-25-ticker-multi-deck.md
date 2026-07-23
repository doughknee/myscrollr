# Spec: Multi-Deck Ticker

**Status**: draft — approved 2026-04-25  
**Authors**: Brandon + AI pair  
**Target release**: v1.0.1 (post-super-user testing)

## Summary

Redesign the multi-row ticker from a cosmetic "repeat the same content N times"
toggle into a **Bloomberg-terminal-style multi-deck** where each row owns its
own curated content and (on Uplink Ultimate) its own scroll behavior.

This turns a feature that currently duplicates content into a flagship
differentiator worth upgrading for.

## Problem Statement

### Today (as of 2026-04-24)

- `AppPreferences.appearance.tickerRows: 1 | 2 | 3` is a presentational toggle.
- `App.tsx:616-639` mounts N copies of `<ScrollrTicker>` with identical props.
- `ScrollrTicker.tsx:280-282` filters items by `index % totalRows === rowIndex`
  — **index-modulo splitting** of one unified stream.
- `ScrollrTicker.tsx:391-417` builds `pinnedLeft`/`pinnedRight` on **every** row,
  causing pinned widgets to literally duplicate 2× / 3× (the visible bug).
- No row is "the stocks row" or "the news row". All rows contain a mix of
  everything.

### Customer-facing pitch doesn't exist

A paid tier currently cannot say "I want stocks above news above sports scores."
The product reads like a single ticker with a "height" slider.

## Goals

1. Row 1 = stocks, Row 2 = sports, Row 3 = news (or any permutation) — fully
   user-configurable per row.
2. Tier-gated: Free = 1 row, Uplink = 2, Pro = 3, Ultimate = 3 + per-row scroll
   customization.
3. Pinned widgets live on exactly one row (user picks).
4. No content duplication across rows unless the user explicitly asks.
5. Migration: existing users with `tickerRows: 2 or 3` get a sane default
   layout that preserves their current content selection.

## Non-Goals

- More than 3 rows (tall-monitor users can ask for this later; current screen
  sizes don't demand it).
- Per-row timezones, themes, or fonts — scope creep.
- Background rows / opacity — scope creep.

## Tier Ladder

| Tier | Max rows | Per-row content selection | Per-row scroll customization |
|---|---|---|---|
| Free | 1 | n/a | n/a |
| Uplink | 2 | Yes | No (inherit global prefs) |
| Uplink Pro | 3 | Yes | No |
| Uplink Ultimate | 3 | Yes | Yes (direction, mode, speed, mix per row) |
| super_user | 3 | Yes | Yes |

Server-side: `ChannelLimits.MaxTickerRows int` and
`ChannelLimits.MaxTickerCustomization bool` (already in `tier_limits.go` as of
the 2026-04-24 polish pass).

Desktop mirror: `desktop/src/tierLimits.ts` (already mirrored).

Marketing fallback: `myscrollr.com/src/routes/uplink.tsx` FALLBACK_LIMITS
(already mirrored).

## Data Model

### New types in `desktop/src/preferences.ts`

```ts
/** Content + optional customization for a single ticker row. */
export interface TickerRowConfig {
  /**
   * Channel/widget IDs shown on this row. Empty array falls back to
   * "all sources visible in activeTabs" — behaves like 1-row mode.
   */
  sources: string[];

  // ── Per-row scroll overrides (Ultimate-only) ──
  // When undefined, the row inherits the global prefs (prefs.ticker.*).
  scrollMode?: ScrollMode;
  direction?: TickerDirection;
  speed?: number;
  mixMode?: MixMode;
}

export interface TickerLayout {
  rows: TickerRowConfig[]; // length 1..MaxTickerRows (tier-clamped on read)
}
```

### Extension of `WidgetPinConfig`

```ts
export interface WidgetPinConfig {
  side: "left" | "right";
  /** Which row this pin belongs to (0-indexed). Defaults to 0. */
  row?: number;
}
```

### Extension of `AppearancePrefs`

```ts
export interface AppearancePrefs {
  // ...existing fields...
  /** @deprecated: derived from tickerLayout.rows.length. Kept for backwards compat. */
  tickerRows: TickerRows;
  /** The source of truth for multi-deck layout. */
  tickerLayout: TickerLayout;
}
```

`tickerRows` stays writable during the deprecation window; writes to
`tickerRows` trigger a layout migration that adds or removes rows, preserving
existing sources. Writes to `tickerLayout.rows.length` re-derive `tickerRows`.

## Migration

At `loadPrefs()` time:

1. If stored prefs have no `tickerLayout`:
   - If stored `tickerRows === 1`: synthesize one row with `sources: []`
     (i.e. "show everything" — preserves current 1-row behavior).
   - If stored `tickerRows >= 2`: synthesize N rows with `sources: []` for all
     rows. Migration does NOT try to split the user's activeTabs across rows —
     better to let them customize explicitly via Settings.
2. Tier-clamp on read: if `tierLimits[currentTier].maxTickerRows < layout.rows.length`,
   truncate the layout. Log the clamp so downgraded users see diagnostic info.
3. Tier-clamp on write: UI disables adding rows past the tier cap. `setPrefs`
   silently clamps if called programmatically.

## UI

### TickerSettings redesign

Replace the "Rows: 1 | 2 | 3" picker with a row builder:

```
┌─ Rows ────────────────────────────────────────┐
│ You can configure up to 2 rows (Uplink tier)  │
│                                                │
│ ┌─ Row 1 ─────────────────────────────────┐   │
│ │ Sources:                                │   │
│ │   [✓ Finance]  [✓ Sports]               │   │
│ │   [_ News]     [_ Fantasy]              │   │
│ │   [_ Clock]    [_ Weather] ...          │   │
│ │                                         │   │
│ │ ┌─ Customize (Ultimate) ──────────────┐ │   │
│ │ │ Direction: ← Left                   │ │   │
│ │ │ Speed:     [======|---]  60px/s     │ │   │
│ │ │ Mode:      [Continuous ▾]           │ │   │
│ │ │ Mix:       [Weave      ▾]           │ │   │
│ │ └─────────────────────────────────────┘ │   │
│ └─────────────────────────────────────────┘   │
│                                                │
│ ┌─ Row 2 ─────────────────────────────────┐   │
│ │ ...                                     │   │
│ │                               [Remove]  │   │
│ └─────────────────────────────────────────┘   │
│                                                │
│ [+ Add row]  (disabled at tier cap)            │
└────────────────────────────────────────────────┘
```

### Pin placement

`TickerPinSection.tsx` gets a row selector (dropdown or segmented control)
when the user has 2+ rows. Default: row 0.

### Live preview

`TickerSettings` live preview at current lines 191-229 gets rewritten to
render N mini-previews that match the actual layout — not the old round-robin
simulation. This verifies the user sees what they'll get.

## Implementation changes

### ScrollrTicker.tsx

- Drop the round-robin filter at `ScrollrTicker.tsx:280-282`.
- Accept a new prop `rowConfig: TickerRowConfig` (optional; falls back to
  existing behavior when absent).
- `activeTabs` becomes `rowConfig.sources.length > 0 ? rowConfig.sources : activeTabs`.
- Per-row scroll prefs read from `rowConfig.scrollMode ?? prefs.ticker.scrollMode`
  etc. The global prefs are the fallback.
- Pinned zone build already gated to `rowIndex === 0`. Extend to read
  `pin.row ?? 0 === rowIndex` so pins scoped to higher rows appear there.

### App.tsx

Replace:

```tsx
{Array.from({ length: prefs.appearance.tickerRows }, (_, i) => (
  <ScrollrTicker ... rowIndex={i} totalRows={prefs.appearance.tickerRows} />
))}
```

With:

```tsx
{prefs.appearance.tickerLayout.rows.map((row, i) => (
  <ScrollrTicker
    ...
    rowIndex={i}
    totalRows={prefs.appearance.tickerLayout.rows.length}
    rowConfig={row}
  />
))}
```

### Window height math

Already row-count-aware (`TICKER_HEIGHTS[mode] * tickerRows * uiScale/100`).
Will derive `tickerRows` from `tickerLayout.rows.length` post-migration.
No Rust-side changes needed.

## Edge cases

1. **User deletes a source that a row references**: on next render, filter
   the row's `sources` against `activeTabs`. If a row ends up with an empty
   `sources` after filtering AND `sources` was non-empty (user intent), show
   an empty row with a dismissible "This row has no sources left. Edit" CTA
   rather than silently showing all.
2. **User downgrades from Pro to Uplink**: `loadPrefs` clamps row count.
   Removed rows are dropped from `tickerLayout.rows` (bottom rows go first).
   Toast notification: "Ticker rows reduced to 2 — your Uplink tier includes
   2 rows. [Upgrade] to use all 3."
3. **User pins a widget to row 2, then deletes row 2**: when a row is removed,
   reassign its pins to row 0.
4. **Widget on multiple rows**: not allowed by data model (single pin per
   widget). A widget can be IN the scrolling content of one row AND pinned
   elsewhere. That's fine.
5. **Grouped vs weave mix mode**: with per-row sources, the mix mode applies
   WITHIN a row. Row 1 with `[finance, sports]` sources in weave mode
   interleaves finance+sports; row 2 with `[rss]` only has one bucket and
   mix mode is irrelevant.

## Rollout

Phase 1 (this spec, v1.0.1):
- Data model + migration + tier gating
- Settings UI rewrite
- Ticker consumes rowConfig
- Pinned widget row assignment

Phase 2 (v1.0.2 or v1.1):
- Ultimate-only per-row scroll customization
- Visual row gap + border customization
- Per-row mix mode override

## Success Metrics

- Post-launch survey: "Which feature did you upgrade for?" — multi-deck
  should be a top-3 answer among Pro/Ultimate subs.
- Pinned widget duplication bug reports → 0 (regression test mandatory).
- No new "multi-row is broken" bug reports in the first 30 days post-launch.

## Open Questions

- Should rows have optional labels? ("Markets" | "Games" | "News") — adds
  discoverability but uses vertical space. **Decision**: defer to v1.1.
- Should per-row pause-on-hover be independent? Same reasoning. **Defer.**
- Should a "solo mode" exist where hovering a row pauses only that row's
  scroll? Nice-to-have, not required.
