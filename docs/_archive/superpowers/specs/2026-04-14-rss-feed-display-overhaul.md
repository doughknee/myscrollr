# RSS Feed Tab & Display Tab Overhaul

## Goal

Transform the RSS feed tab from a flat article list into a balanced, filterable feed with per-source article limits, and expand the display settings to control the new behaviors.

## Problem

The current RSS FeedTab renders all articles in a flat chronological list. Prolific sources (e.g., TechCrunch posting 30 articles/day) drown out smaller sources. There is no filtering, no sorting, and no way to limit how many articles appear per source. The display settings tab has only 3 basic toggles.

By contrast, Finance has price flash animations and rich card layouts, and Sports has a full sub-tab system (Scores / Schedule / Standings). The RSS tab needs to be brought up to their quality level.

## Architecture

Single enhanced view with a controls bar (no sub-tabs). All filtering, sorting, and per-source limiting is applied client-side via a `useMemo` pipeline on the existing `dashboard.data.rss` array. No backend changes needed.

Category data for articles is resolved by building a `feedUrl → category` lookup map from the RSS catalog query (`TrackedFeed.category`), since `RssItem` itself does not carry a `category` field.

## Scope

**In scope:**
- Controls bar with source filter, category filter, sort control
- Per-source article limit (configurable, default 3)
- "Show more from Source" expandable rows
- Category badge pills on article cards
- New `articlesPerSource` display setting
- Moved display settings into own file

**Out of scope:**
- Backend API changes
- Unread tracking
- Favicon fetching
- Full-text article reader
- Saved/bookmarked articles

---

## Feed Tab Design

### Controls Bar

A sticky controls bar at the top of the feed, matching the styling language of the config panel. Contains:

1. **Source filter** — Dropdown showing all subscribed source names. Multi-select with checkboxes. When active, only articles from selected sources appear. Badge shows active filter count.
2. **Category filter** — Reuses the `CategoryFilter` component from the config panel. Filters articles by their source feed's category.
3. **Sort control** — Segmented or dropdown: "Newest" (default), "Oldest", "By Source" (groups articles by source, then newest within each group).

When any filter is active, a row of dismissible filter chips appears below the controls bar, same pattern as `FeedCatalog.tsx`.

### Per-Source Article Limit

The key new behavior. Applied after filtering but before rendering:

1. Group articles by `source_name`
2. For each source, keep only the N most recent articles (N = `articlesPerSource` display pref, default 3)
3. If a source has more than N articles, render a "Show N more from SourceName" row after the last visible article from that source
4. Clicking "Show more" expands that source inline (local state toggle per source, not a pref change)
5. When sort is "By Source", articles are grouped by source with a source header row, then limited within each group

### Article Cards

**Compact mode** — Existing single-line layout with one addition:
- Category badge: small pill (`text-[8px]`, muted bg matching category) between source name and title. Only shown when `showSource` is true (piggybacks on that toggle to avoid another setting).

**Comfort mode** — Existing block layout with one addition:
- Category badge: small pill next to source name in the footer row. Same styling as compact.

Category colors: derive from a simple hash of the category string to pick from a predefined palette (same approach the config panel uses for category badges in `FeedCatalog.tsx` and `MyFeeds.tsx`).

### "Show More" Row

When articles are truncated for a source:
```
[SourceName icon] N more articles · Show all
```
Muted text, clickable. Expanding shows the remaining articles inline. A "Collapse" affordance appears to re-hide them.

### Empty / No-Results States

- **No articles at all**: Existing `EmptyChannelState` (unchanged)
- **Filters active but no matches**: "No articles match your filters" with a "Clear filters" button

---

## Display Tab Design

Add one new setting to the existing 3 toggles:

### New Setting: Articles Per Source

**Control:** Segmented row (matches existing `SegmentedRow` pattern)
**Options:** 1, 3, 5, 10, All
**Default:** 3
**Label:** "Articles per source"
**Description:** "Limit how many articles appear from each feed"

### Updated `RssDisplayPrefs`

```typescript
export interface RssDisplayPrefs {
  showDescription: boolean;
  showSource: boolean;
  showTimestamps: boolean;
  articlesPerSource: number; // 1, 3, 5, 10, or 0 (meaning "all")
}
```

Default: `{ showDescription: true, showSource: true, showTimestamps: true, articlesPerSource: 3 }`

The value `0` represents "All" (no limit).

### Display Tab Location

Currently inline in `channel.$type.$tab.tsx`. Keep it inline — it's still small (adding one `SegmentedRow`).

---

## File Changes

### Modified Files

| File | Change |
|------|--------|
| `desktop/src/channels/rss/FeedTab.tsx` | Major rewrite: add controls bar, per-source limiting pipeline, category badges, "show more" rows, filter state, sort state |
| `desktop/src/preferences.ts` | Add `articlesPerSource: number` to `RssDisplayPrefs` interface and defaults |
| `desktop/src/routes/channel.$type.$tab.tsx` | Add `SegmentedRow` for articlesPerSource in `RssDisplay` component |

### No New Files

The FeedTab rewrite stays in the existing file. The `CategoryFilter` component from the config panel is reused directly. No new components needed — the controls bar, "show more" rows, and filter chips are all inline in the FeedTab since they're specific to this view.

### No Backend Changes

All processing is client-side on existing `dashboard.data.rss` data. Category lookup uses the existing `rssCatalogOptions()` query (already cached, 5-min staleTime).

---

## Data Flow

```
dashboard.data.rss (RssItem[])
  → rssCatalog (TrackedFeed[]) builds feedUrl→category Map
  → Apply source filter (if active)
  → Apply category filter (if active)
  → Apply sort (newest/oldest/by-source)
  → Apply per-source limit (group by source_name, slice to N)
  → Track overflow counts per source
  → Render: controls bar, filter chips, article cards, "show more" rows
```

All steps are in a single `useMemo` chain, keyed on: `rssItems`, `catalog`, `sourceFilter`, `categoryFilter`, `sortMode`, `articlesPerSource`, `expandedSources`.

---

## Interactions

| Action | Behavior |
|--------|----------|
| Toggle source in source filter | Articles from that source shown/hidden. Filter chip appears/disappears. |
| Toggle category in category filter | Articles from feeds in that category shown/hidden. Filter chip appears/disappears. |
| Click "Show more from X" | Expands that source to show all its articles (local state). |
| Click "Collapse" on expanded source | Re-applies the per-source limit for that source. |
| Change sort | Re-orders visible articles. "By Source" groups with source headers. |
| Clear all filters | Resets source + category filters to empty (show all). |
| Change articlesPerSource in Display | Persisted pref. Immediately affects feed view. Resets expanded sources. |
