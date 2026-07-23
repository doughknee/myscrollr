# Marketplace — Design Spec

**Date:** 2026-03-30
**Target release:** v0.9.6
**Scope:** Desktop app (`desktop/`)

## Overview

A unified catalog page where users browse, add, and remove data sources (channels and widgets) from their account. Ships with the 9 built-in items; architecture supports future third-party/community sources.

## Goals

1. Give users a single place to discover and manage all available sources
2. Unify channels (server-side) and widgets (client-side) behind a common UI
3. Design data model and UI patterns that accommodate third-party sources later
4. Surface tier requirements per source

## Non-Goals

- Third-party/community source support (deferred)
- Search functionality (9 items don't need it)
- Source ratings, reviews, or download counts
- Detail pages per source

## Data Model

```typescript
// desktop/src/marketplace.ts

interface MarketplaceItem {
  id: string;                    // "finance", "clock", etc.
  name: string;                  // Human-readable name
  description: string;           // 1-2 sentence summary
  icon: ComponentType<IconProps>; // Lucide icon from manifest
  hex: string;                   // Accent color for icon
  category: MarketplaceCategory; // Filter grouping
  kind: "channel" | "widget";   // Determines add/remove backend
  info: SourceInfo;              // About text + usage bullets
  requiredTier: SubscriptionTier; // Minimum tier to use
}

type MarketplaceCategory = "data-feed" | "utility";

const CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  "data-feed": "Data Feeds",
  "utility": "Utilities",
};
```

### Item Mapping

| Source | Category | Kind | Required Tier |
|--------|----------|------|---------------|
| Finance | data-feed | channel | free |
| Sports | data-feed | channel | free |
| RSS | data-feed | channel | free |
| Fantasy | data-feed | channel | uplink |
| Clock | utility | widget | free |
| Weather | utility | widget | free |
| System Monitor | utility | widget | free |
| Uptime | utility | widget | free |
| GitHub | utility | widget | free |

### Builder Function

`getMarketplaceItems()` merges `getAllChannels()` and `getAllWidgets()` from existing registries into `MarketplaceItem[]`. The `requiredTier` and `category` values are assigned in this function — not in the individual manifest files. This keeps manifests clean and centralizes marketplace metadata.

## Sidebar

Add a `NavItem` between the Ticker item and the Channels section header.

**Before:**
```
Dashboard
Ticker
── Channels ──
  Finance
  Sports
  ...
── Widgets ──
  Clock
  ...
```

**After:**
```
Dashboard
Ticker
Marketplace          ← NEW
── Channels ──
  Finance
  Sports
  ...
── Widgets ──
  Clock
  ...
```

- **Icon:** `Store` from `lucide-react`
- **Route:** `/marketplace`
- **Active state:** highlighted when on `/marketplace` route

## Route & Page Layout

**File:** `desktop/src/routes/marketplace.tsx`

**Structure (top to bottom):**

1. **Page header**
   - Title: "Marketplace"
   - Subtitle: "Add data feeds and utilities to your ticker"

2. **Category filter tabs**
   - `All` (default) | `Data Feeds` | `Utilities`
   - Tabs filter the card grid by `category`
   - Active tab uses the existing sidebar/tab indicator pattern

3. **Card grid**
   - Responsive: 2 columns at `min-width`, 3 columns at wider widths
   - Cards sorted by: enabled first, then by canonical order (`CHANNEL_ORDER` then `WIDGET_ORDER`)

## Card Component

**File:** `desktop/src/components/marketplace/MarketplaceCard.tsx`

Each card displays:

| Element | Description |
|---------|-------------|
| **Icon** | Source icon, colored with `hex`, 32-40px |
| **Name** | Source name (bold) |
| **Category badge** | Small badge: "Data Feed" or "Utility" |
| **Description** | 1-2 line description text |
| **Tier badge** | Only shown if `requiredTier` is above user's current tier. Styled as warn badge: "Requires Uplink" |
| **Action** | See Add/Remove Flow below |

**Card states:**

1. **Available (not added):** neutral card, "Add" button (primary style)
2. **Added (enabled):** subtle green accent, green dot + "Added" label, "Remove" text button
3. **Tier-gated:** dimmed card, "Upgrade" button instead of "Add" (opens `myscrollr.com/uplink` via `shell:open`)

Card uses inline Tailwind utilities matching the desktop app's existing patterns: `rounded-lg bg-base-200/60 border border-edge/30 p-4 transition-colors hover:bg-base-250/50`. The desktop app does not use CSS component classes — all styling is via Tailwind utilities.

## Add/Remove Flow

### Adding a source

1. User clicks "Add" on an available card
2. **Channel (`kind === "channel"`):**
   - `channelsApi.create(id)` — POST to `/users/me/channels` (second `config` param defaults to `{}`)
   - Invalidate `dashboard` TanStack Query
   - Navigate: `navigate({ to: "/channel/$type/$tab", params: { type: id, tab: "feed" } })`
   - Success toast: "Finance added"
3. **Widget (`kind === "widget"`):**
   - Add `id` to `prefs.widgets.enabledWidgets` and `widgetsOnTicker`
   - Persist via `onPrefsChange(nextPrefs)` from `useShell()`
   - Navigate: `navigate({ to: "/widget/$id/$tab", params: { id, tab: "feed" } })`
   - Success toast: "Clock added"

### Removing a source

1. User clicks "Remove" on an enabled card
2. **Channel (`kind === "channel"`):**
   - `ConfirmDialog` appears: "Remove {name}? Your saved {noun} and configuration will be deleted."
     - Finance: "symbols", Sports: "leagues", RSS: "feeds", Fantasy: "leagues"
   - On confirm: `channelsApi.delete(id)`, invalidate dashboard, toast
   - **Stay on Marketplace page** (do not navigate)
3. **Widget (`kind === "widget"`):**
   - No confirmation needed (nothing is lost, preferences are local)
   - Remove `id` from `enabledWidgets` and `widgetsOnTicker`
   - Save preferences, toast
   - **Stay on Marketplace page**

### Tier-gated sources

- If `requiredTier` is above user's `tier`: "Add" button is replaced by "Upgrade" link
- Clicking opens `https://myscrollr.com/uplink` via `open()` from `@tauri-apps/plugin-shell`

## Implementation Notes

### Action handlers

The Marketplace route should NOT use `onAddChannel`/`onDeleteChannel` from `useChannelActions` or `onToggleWidget` from `useWidgetActions` directly — those handlers auto-navigate in ways that don't fit the Marketplace UX (remove navigates to `/feed`). Instead, the Marketplace calls the underlying API/prefs methods and handles navigation itself.

The Marketplace route calls `channelsApi.create(channelType)` and `channelsApi.delete(channelType)` directly (from `desktop/src/api/client.ts`, `config` param defaults to `{}`) and invalidates the dashboard query via `useQueryClient().invalidateQueries({ queryKey: queryKeys.dashboard })`. For widgets, it reads `prefs` from `useShell()`, computes the new `enabledWidgets`/`widgetsOnTicker` arrays, and calls `onPrefsChange(nextPrefs)` — which updates React state and persists to disk.

This mirrors the internal logic of `useChannelActions` (lines 45-76) and `useWidgetActions` (lines 34-66) but with Marketplace-specific navigation behavior (navigate on add, stay on remove).

### Enabled state detection

- **Channels:** compare `item.id` against `channels.map(ch => ch.channel_type)` from `useShellData()`
- **Widgets:** compare `item.id` against `prefs.widgets.enabledWidgets` from `useShell()`

### Route registration

The route file `marketplace.tsx` uses `createFileRoute('/marketplace')`. TanStack Router auto-generates the route tree entry.

## New Files

| File | Purpose |
|------|---------|
| `desktop/src/marketplace.ts` | `MarketplaceItem` type, `getMarketplaceItems()`, category constants |
| `desktop/src/routes/marketplace.tsx` | Route component: page layout, category filter, card grid |
| `desktop/src/components/marketplace/MarketplaceCard.tsx` | Individual source card component |

## Modified Files

| File | Change |
|------|--------|
| `desktop/src/components/Sidebar.tsx` | Add Marketplace `NavItem` between Ticker and Channels section |
| `desktop/src/routes/__root.tsx` | Add `isMarketplace` prop for sidebar active state |

## Extensibility

Future third-party source support would add:

- A remote marketplace registry API endpoint returning `MarketplaceItem[]`
- A `kind: "plugin"` with its own install/uninstall mechanism
- New categories (e.g., `"integration"`, `"social"`)
- Search bar + pagination for larger catalogs
- Source detail pages with screenshots, changelogs, ratings

None of these require changes to the v1 data model or card component — they extend naturally.

## Edge Cases & States

### Loading state

The Marketplace page loads instantly since `getMarketplaceItems()` is a synchronous function merging local registries. Channel enabled state depends on the dashboard query — while it's loading, show cards in a neutral state with the "Add" button disabled and a brief skeleton/pulse on the status indicator. Use the existing `dashboardQueryOptions()` via TanStack Query's `useQuery`.

### Error state

If the dashboard query fails (needed to determine which channels are enabled), show a `QueryErrorBanner` at the top of the page and render all cards as "available" (not enabled). Widget enabled state comes from local preferences and cannot fail.

### Unauthenticated users

- **Widgets:** Always addable (client-side only, no auth required)
- **Channels:** "Add" button shows "Sign in to add" and triggers `onLogin()` from shell context. The card itself is still visible with full info.
- **Tier-gated sources:** Show "Sign in" rather than "Upgrade" for unauthenticated users, since tier cannot be determined without auth.

The `authenticated` and `tier` values come from `useShell()`.

### Widget action handler dependency

`useWidgetActions` requires `(prefs, setPrefs, activeItem)` as arguments — it's not a standalone hook. The Marketplace route needs access to these values. Two options:

The Marketplace reads `prefs` from `useShell()`, computes the updated `enabledWidgets`/`widgetsOnTicker` arrays, and calls `onPrefsChange(nextPrefs)` (also from `useShell()`). The root route wires `onPrefsChange` to both React state update and disk persistence via `savePrefs()` — so the sidebar and ticker reflect changes immediately.

Do NOT call `savePrefs()` directly from the Marketplace — that only writes to disk without updating React state, leaving the UI stale until next mount.
