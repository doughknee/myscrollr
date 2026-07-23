# RSS Configuration Panel Overhaul

## Goal

Replace the flat catalog-only RSS configuration panel with a two-section management experience: a "My Feeds" management section (subscribed feed health, search, sort, remove, custom feed creation) stacked above an improved "Add Feeds" catalog with category filter dropdown and 2-column card grid.

## Scope

This spec covers the RSS configuration panel only (`/channel/rss/configuration`). The feed reader page and display settings are out of scope for this iteration.

## Current State

The existing `RssConfigPanel.tsx` (291 lines) uses the shared `SetupBrowser` component — a flat list with category tabs, search, add/remove toggles, and an inline custom feed form. It works for a handful of feeds but breaks down at 50+ subscriptions:

- No way to see which feeds are healthy, stale, or failing
- No way to sort or search subscribed feeds
- Custom feed form is wedged above the catalog
- Category tabs overflow horizontally with 8 categories
- Backend returns health data (`consecutive_failures`, `last_error`, `last_success_at`) but the frontend ignores it

## Architecture

### Page Layout

Single scrollable page, no sub-navigation. Two sections separated by a divider:

**Section 1: "My Feeds"** (top)
- Header row: section title with subscribed count badge, "Add custom feed" button
- Controls row: search input + sort dropdown
- Feed list: compact rows inside a bordered container
- Footer: tier limit indicator ("12 / 25 feeds (1 / 1 custom)")

**Section 2: "Add Feeds"** (bottom)
- Header row: section title with catalog count
- Controls row: search input + "Categories" filter dropdown button
- Catalog grid: 2-column card layout

### My Feeds — Feed Row

Each subscribed feed renders as a single compact row:

```
[health dot] [feed name] [category badge] [last article time] [remove button]
```

- **Health dot**: 6px circle. Green = healthy (last success < 24h). Amber = stale (last success 1-3 days ago, or no `last_success_at`). Red = failing (`consecutive_failures > 0`). Tooltip shows detail (e.g., "Last article: 2 days ago" or "Feed unreachable: connection timeout").
- **Feed name**: truncated with `text-overflow: ellipsis`
- **Category badge**: small pill, uses channel accent color. Custom feeds show "custom" badge in amber instead of category.
- **Last article time**: relative timestamp from `last_success_at` (e.g., "2h ago", "3d ago"). Shows "failing" in red if `consecutive_failures > 0`.
- **Remove button**: X icon with Tooltip "Remove feed"

### My Feeds — Controls

- **Search**: filters the subscribed feed list by name (client-side, instant)
- **Sort dropdown**: Name (A-Z), Last Activity (most recent first), Category, Health (errors first). Default: Name.

### My Feeds — Custom Feed Form

"Add custom feed" button in the header. Clicking it reveals an inline form below the controls row (above the feed list):

- Two inputs: Feed name (text) + Feed URL (url)
- "Add" button with Plus icon
- URL validation: must start with `http://` or `https://`
- Shows custom feed count vs limit ("1 / 1 custom feeds")
- Hides when at custom limit (shows UpgradePrompt instead)
- Enter on URL input submits

### Add Feeds — Category Filter

"Categories" button next to the search bar. Opens a popover/dropdown with:

- Checkbox per category, with feed count badge (e.g., "Tech (15)")
- All checked by default (showing all feeds)
- Unchecking a category hides those feeds from the grid
- Active filter count shown as badge on the button ("Categories (2)")
- Dismissable chips below the controls row for each active filter
- "Clear all" link to reset

### Add Feeds — Catalog Cards

2-column grid of cards. Each card shows:

- Feed name (bold) + category badge (top-right)
- Description (1-2 lines, truncated)
- Action: "+ Add" (green) if not subscribed, "Added" (muted) if already subscribed
- Already-subscribed cards have a subtle accent border/background tint

## Data Changes

### Frontend `TrackedFeed` Type

Extend the existing type in `desktop/src/api/client.ts` to include health fields already returned by the API:

```ts
export interface TrackedFeed {
  url: string;
  name: string;
  category: string;
  is_default: boolean;
  consecutive_failures: number;    // NEW — already in API response
  last_error?: string;             // NEW — already in API response
  last_success_at?: string;        // NEW — already in API response
}
```

### Backend: Include Quarantined Feeds in Catalog

The current `GET /rss/feeds` query filters out feeds with `consecutive_failures >= 3`. For the "My Feeds" section, users need to see their broken feeds. Two options:

**Option A (recommended): Add query parameter.** `GET /rss/feeds?include_failing=true` returns all feeds regardless of failure count. The "My Feeds" section calls with this parameter; the "Add Feeds" catalog calls without it (so users don't discover broken feeds). The frontend can cross-reference the user's subscribed feed URLs against the full catalog to show health for their feeds.

**Option B: New per-user endpoint.** `GET /rss/feeds/subscribed?user=<sub>` returns only the user's feeds with health. More targeted but requires a new route, auth, and a join against user_channels config.

Recommendation: **Option A** — minimal backend change (add a WHERE clause toggle), the frontend already knows which feeds are subscribed (from `channel.config.feeds`).

### Backend Change

In `channels/rss/api/rss.go`, modify `getRSSFeedCatalog`:

```go
includeAll := c.Query("include_failing") == "true"
query := `SELECT url, name, category, is_default, consecutive_failures, last_error, last_success_at
          FROM tracked_feeds WHERE is_enabled = true`
if !includeAll {
    query += fmt.Sprintf(" AND consecutive_failures < %d", MaxConsecutiveFailures)
}
query += " ORDER BY category, name"
```

Cache key should include the `include_failing` parameter to avoid serving stale data.

### Frontend Queries

Two catalog queries in the config panel:

1. **Full catalog** (for My Feeds health): `rssCatalogOptions({ includeFailing: true })` — used to cross-reference health data for subscribed feeds
2. **Clean catalog** (for Add Feeds browsing): `rssCatalogOptions()` — existing behavior, excludes failing feeds

Both use the same query key prefix with different parameters so TanStack Query caches them independently.

## Component Structure

### New Files

- `desktop/src/channels/rss/ConfigPanel.tsx` — the new RSS config panel (replaces `RssConfigPanel.tsx`)
- `desktop/src/channels/rss/MyFeeds.tsx` — "My Feeds" section component
- `desktop/src/channels/rss/FeedCatalog.tsx` — "Add Feeds" catalog section component
- `desktop/src/channels/rss/CategoryFilter.tsx` — category filter dropdown component

### Modified Files

- `desktop/src/api/client.ts` — extend `TrackedFeed` type with health fields, update `rssApi.getCatalog` to accept `includeFailing` option
- `desktop/src/api/queries.ts` — update `rssCatalogOptions` to accept options parameter
- `desktop/src/routes/channel.$type.$tab.tsx` — update config panel import path
- `channels/rss/api/rss.go` — add `include_failing` query parameter support

### Deleted Files

- `desktop/src/channels/RssConfigPanel.tsx` — replaced by the new modular components in `channels/rss/`

## Health Indicator Logic

```ts
function feedHealth(feed: TrackedFeed): "healthy" | "stale" | "failing" {
  if (feed.consecutive_failures > 0) return "failing";
  if (!feed.last_success_at) return "stale";
  const hoursSinceSuccess = (Date.now() - new Date(feed.last_success_at).getTime()) / 3600000;
  if (hoursSinceSuccess > 72) return "stale";  // 3 days
  return "healthy";
}
```

Colors: healthy = `#22c55e` (green-500), stale = `#f59e0b` (amber-500), failing = `#ef4444` (red-500).

## Sort Options

| Label | Key | Logic |
|-------|-----|-------|
| Name | `name` | Alphabetical by feed name (default) |
| Last Activity | `activity` | Most recent `last_success_at` first, null/missing sorted last |
| Category | `category` | Alphabetical by category, then by name within category |
| Health | `health` | Failing first, then stale, then healthy. Within each group, by name |

## Error Handling

- **Add feed fails**: Toast error "Failed to add feed", feed stays in catalog as unadded
- **Remove feed fails**: Toast error "Failed to remove feed", feed stays in My Feeds list
- **Custom feed invalid URL**: Inline validation error below URL input
- **Custom feed limit reached**: UpgradePrompt replaces the custom feed form
- **Catalog query fails**: Error state in Add Feeds section with retry button
- **Full catalog query fails**: My Feeds shows feeds without health indicators (graceful degradation — hide health dots, show "—" for timestamps)

## Tier Limits (unchanged)

| Tier | Max Feeds | Max Custom |
|------|-----------|-----------|
| Free | 1 | 0 |
| Uplink | 25 | 1 |
| Pro | 100 | 3 |
| Ultimate | Unlimited | 10 |

## Interactions

- **Add from catalog**: Click "+ Add" on a card. Feed appears in My Feeds list. Card changes to "Added" state. Dashboard query invalidated.
- **Remove from My Feeds**: Click X on a row. Confirmation not needed (can re-add from catalog). Feed removed from config. Dashboard query invalidated.
- **Remove from catalog card**: Already-added cards show muted "Added" text (no remove action in catalog — use My Feeds for removal). This prevents accidental removal while browsing.
- **Custom feed add**: Fill name + URL, click Add. Feed added to config and appears in My Feeds. Also appears in catalog as a custom feed for other users.
- **Search My Feeds**: Client-side instant filter by feed name.
- **Search catalog**: Client-side instant filter by feed name or URL.
- **Category filter**: Popover with checkboxes. Multi-select. Applied immediately. Persisted in component state (not preferences — resets on navigation).
