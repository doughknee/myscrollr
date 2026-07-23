# Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Marketplace page to the desktop app where users browse, add, and remove the 9 built-in channels and widgets from a unified catalog.

**Architecture:** A new `/marketplace` route renders a card grid of all registered channels and widgets. Cards show enabled state, tier requirements, and add/remove actions. The data model merges existing `ChannelManifest` and `WidgetManifest` registries into a unified `MarketplaceItem[]`. Channels use the API (`channelsApi`), widgets use local preferences (`onPrefsChange`).

**Tech Stack:** React 19, TanStack Router (file-based), TanStack Query, Tailwind v4, clsx, sonner (toasts), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-03-30-marketplace-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/src/marketplace.ts` | Create | `MarketplaceItem` type, `MarketplaceCategory` type, category constants, `getMarketplaceItems()` builder |
| `desktop/src/components/marketplace/MarketplaceCard.tsx` | Create | Individual source card: icon, name, description, category badge, tier badge, add/remove action |
| `desktop/src/routes/marketplace.tsx` | Create | Route component: page header, category filter tabs, card grid, add/remove handlers |
| `desktop/src/routes/__root.tsx` | Modify | Add `isMarketplace` to `parseRoute()` return object, pass to Sidebar |
| `desktop/src/components/Sidebar.tsx` | Modify | Add `isMarketplace` prop, render Marketplace `NavItem` between Ticker and Channels section |

---

### Task 1: Create `marketplace.ts` — data model and builder

**Files:**
- Create: `desktop/src/marketplace.ts`

- [ ] **Step 0: Export `SourceInfo` from types**

In `desktop/src/types/index.ts`, line 107, `SourceInfo` is not exported. Add `export`:

```typescript
// Before:
interface SourceInfo {
// After:
export interface SourceInfo {
```

This is needed by the `MarketplaceItem` type.

- [ ] **Step 1: Create the marketplace data model file**

```typescript
// desktop/src/marketplace.ts

import type { ComponentType } from "react";
import type { SourceInfo } from "./types";
import type { SubscriptionTier } from "./auth";
import { getAllChannels } from "./channels/registry";
import { getAllWidgets } from "./widgets/registry";

// ── Types ───────────────────────────────────────────────────────

type IconProps = { size?: number; className?: string };

export type MarketplaceCategory = "data-feed" | "utility";

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<IconProps>;
  hex: string;
  category: MarketplaceCategory;
  kind: "channel" | "widget";
  info: SourceInfo;
  requiredTier: SubscriptionTier;
}

export const CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  "data-feed": "Data Feeds",
  "utility": "Utilities",
};

// ── Tier requirements per source ────────────────────────────────

const CHANNEL_TIERS: Record<string, SubscriptionTier> = {
  finance: "free",
  sports: "free",
  rss: "free",
  fantasy: "uplink",
};

// ── Builder ─────────────────────────────────────────────────────

export function getMarketplaceItems(): MarketplaceItem[] {
  const channels: MarketplaceItem[] = getAllChannels().map((ch) => ({
    id: ch.id,
    name: ch.name,
    description: ch.description,
    icon: ch.icon,
    hex: ch.hex,
    category: "data-feed" as const,
    kind: "channel" as const,
    info: ch.info,
    requiredTier: CHANNEL_TIERS[ch.id] ?? "free",
  }));

  const widgets: MarketplaceItem[] = getAllWidgets().map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    icon: w.icon,
    hex: w.hex,
    category: "utility" as const,
    kind: "widget" as const,
    info: w.info,
    requiredTier: "free",
  }));

  return [...channels, ...widgets];
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build` (in `desktop/`)
Expected: vite build + tsc succeed, zero errors.

- [ ] **Step 3: Commit**

```
git add desktop/src/types/index.ts desktop/src/marketplace.ts
git commit -m "feat(desktop): add marketplace data model and builder"
```

---

### Task 2: Create `MarketplaceCard.tsx` — card component

**Files:**
- Create: `desktop/src/components/marketplace/MarketplaceCard.tsx`

**Dependencies:** Task 1 must be complete (needs `MarketplaceItem` type).

- [ ] **Step 1: Create the marketplace directory**

```bash
mkdir -p desktop/src/components/marketplace
```

- [ ] **Step 2: Create the card component**

```tsx
// desktop/src/components/marketplace/MarketplaceCard.tsx

import { useState } from "react";
import clsx from "clsx";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { MarketplaceItem, MarketplaceCategory } from "../../marketplace";
import type { SubscriptionTier } from "../../auth";
import { TIER_LABELS } from "../../auth";
import ConfirmDialog from "../ConfirmDialog";

// ── Confirm-dialog nouns per channel ────────────────────────────

const CHANNEL_NOUNS: Record<string, string> = {
  finance: "symbols",
  sports: "leagues",
  rss: "feeds",
  fantasy: "leagues",
};

const CATEGORY_BADGE: Record<MarketplaceCategory, string> = {
  "data-feed": "Data Feed",
  "utility": "Utility",
};

// ── Props ───────────────────────────────────────────────────────

interface MarketplaceCardProps {
  item: MarketplaceItem;
  enabled: boolean;
  tier: SubscriptionTier;
  authenticated: boolean;
  /** Disable Add button while dashboard is loading (channels enabled state unknown). */
  dashboardLoading: boolean;
  onAdd: (item: MarketplaceItem) => Promise<void>;
  onRemove: (item: MarketplaceItem) => Promise<void>;
  onLogin: () => void;
}

// ── Component ───────────────────────────────────────────────────

export default function MarketplaceCard({
  item,
  enabled,
  tier,
  authenticated,
  dashboardLoading,
  onAdd,
  onRemove,
  onLogin,
}: MarketplaceCardProps) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const tierLocked =
    authenticated && item.requiredTier !== "free" && !tierMeetsRequirement(tier, item.requiredTier);

  async function handleAdd() {
    if (!authenticated && item.kind === "channel") {
      onLogin();
      return;
    }
    if (tierLocked) {
      open("https://myscrollr.com/uplink");
      return;
    }
    setLoading(true);
    try {
      await onAdd(item);
    } finally {
      setLoading(false);
    }
  }

  function handleRemoveClick() {
    if (item.kind === "channel") {
      setConfirmOpen(true);
    } else {
      doRemove();
    }
  }

  async function doRemove() {
    setConfirmOpen(false);
    setLoading(true);
    try {
      await onRemove(item);
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────

  const Icon = item.icon;

  return (
    <>
      <div
        className={clsx(
          "rounded-lg border p-4 transition-colors",
          enabled
            ? "bg-base-200/70 border-success/20"
            : "bg-base-200/40 border-edge/20 hover:bg-base-200/60",
        )}
      >
        {/* Header row: icon + name + category badge */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${item.hex}15` }}
          >
            <Icon size={20} style={{ color: item.hex }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-fg truncate">{item.name}</span>
              {enabled && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-success">
                  <Check size={10} />
                  Added
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium text-fg-4 uppercase tracking-wider">
              {CATEGORY_BADGE[item.category]}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-fg-3 leading-relaxed mb-4 line-clamp-2">
          {item.description}
        </p>

        {/* Tier badge (only when locked) */}
        {tierLocked && (
          <div className="flex items-center gap-1.5 mb-3 px-2 py-1 rounded-md bg-warn/10 border border-warn/20 w-fit">
            <span className="text-[10px] font-medium text-warn">
              Requires {TIER_LABELS[item.requiredTier]}
            </span>
          </div>
        )}

        {/* Unauthenticated channel hint */}
        {!authenticated && item.kind === "channel" && !enabled && (
          <div className="flex items-center gap-1.5 mb-3 px-2 py-1 rounded-md bg-info/10 border border-info/20 w-fit">
            <span className="text-[10px] font-medium text-info">
              Sign in to add
            </span>
          </div>
        )}

        {/* Action */}
        <div className="flex items-center justify-end">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-fg-4" />
          ) : enabled ? (
            <button
              onClick={handleRemoveClick}
              className="text-xs font-medium text-fg-4 hover:text-error transition-colors"
            >
              Remove
            </button>
          ) : tierLocked ? (
            <button
              onClick={() => open("https://myscrollr.com/uplink")}
              className="flex items-center gap-1 text-xs font-medium text-warn hover:text-warn/80 transition-colors"
            >
              Upgrade <ExternalLink size={10} />
            </button>
          ) : !authenticated && item.kind === "channel" ? (
            <button
              onClick={onLogin}
              className="text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
            >
              Sign in to add
            </button>
          ) : (
            <button
              onClick={handleAdd}
              disabled={dashboardLoading && item.kind === "channel"}
              className={clsx(
                "text-xs font-semibold transition-colors",
                dashboardLoading && item.kind === "channel"
                  ? "text-fg-4 cursor-not-allowed"
                  : "text-accent hover:text-accent/80",
              )}
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Channel removal confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        title={`Remove ${item.name}?`}
        description={`Your saved ${CHANNEL_NOUNS[item.id] ?? "data"} and configuration will be deleted.`}
        confirmLabel="Remove"
        destructive
        onConfirm={doRemove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

const TIER_ORDER: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate"];

function tierMeetsRequirement(current: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build` (in `desktop/`)
Expected: vite build + tsc succeed, zero errors.

- [ ] **Step 4: Commit**

```
git add desktop/src/components/marketplace/
git commit -m "feat(desktop): add MarketplaceCard component"
```

---

### Task 3: Create `marketplace.tsx` — route and page layout

**Files:**
- Create: `desktop/src/routes/marketplace.tsx`

**Dependencies:** Tasks 1 and 2 must be complete.

- [ ] **Step 1: Create the route file**

```tsx
// desktop/src/routes/marketplace.tsx

import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";

import { getMarketplaceItems, CATEGORY_LABELS } from "../marketplace";
import type { MarketplaceCategory, MarketplaceItem } from "../marketplace";
import { channelsApi } from "../api/client";
import type { ChannelType } from "../api/client";
import { dashboardQueryOptions, queryKeys } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { CHANNEL_ORDER } from "../channels/registry";
import { WIDGET_ORDER } from "../widgets/registry";
import MarketplaceCard from "../components/marketplace/MarketplaceCard";
import QueryErrorBanner from "../components/QueryErrorBanner";

export const Route = createFileRoute("/marketplace")({
  component: MarketplacePage,
});

// ── Category filter options ─────────────────────────────────────

type FilterTab = "all" | MarketplaceCategory;

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "data-feed", label: CATEGORY_LABELS["data-feed"] },
  { key: "utility", label: CATEGORY_LABELS["utility"] },
];

// ── Sort order: enabled first, then canonical order ─────────────

const CANONICAL_ORDER = [...CHANNEL_ORDER, ...WIDGET_ORDER];

function sortItems(items: MarketplaceItem[], enabledIds: Set<string>): MarketplaceItem[] {
  return [...items].sort((a, b) => {
    const aEnabled = enabledIds.has(a.id) ? 0 : 1;
    const bEnabled = enabledIds.has(b.id) ? 0 : 1;
    if (aEnabled !== bEnabled) return aEnabled - bEnabled;
    return CANONICAL_ORDER.indexOf(a.id) - CANONICAL_ORDER.indexOf(b.id);
  });
}

// ── Page component ──────────────────────────────────────────────

function MarketplacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { prefs, onPrefsChange, authenticated, tier, onLogin } = useShell();
  const { channels } = useShellData();
  const { error: dashboardError, isLoading } = useQuery(dashboardQueryOptions());

  const [filter, setFilter] = useState<FilterTab>("all");

  // All marketplace items (static, computed once)
  const allItems = useMemo(() => getMarketplaceItems(), []);

  // Enabled IDs
  const enabledChannelIds = useMemo(
    () => new Set(channels.map((ch) => ch.channel_type)),
    [channels],
  );
  const enabledWidgetIds = useMemo(
    () => new Set(prefs.widgets.enabledWidgets),
    [prefs.widgets.enabledWidgets],
  );
  const allEnabledIds = useMemo(
    () => new Set([...enabledChannelIds, ...enabledWidgetIds]),
    [enabledChannelIds, enabledWidgetIds],
  );

  // Filtered + sorted items
  const visibleItems = useMemo(() => {
    const filtered = filter === "all"
      ? allItems
      : allItems.filter((item) => item.category === filter);
    return sortItems(filtered, allEnabledIds);
  }, [allItems, filter, allEnabledIds]);

  // ── Add handler ─────────────────────────────────────────────

  const handleAdd = useCallback(
    async (item: MarketplaceItem) => {
      if (item.kind === "channel") {
        await channelsApi.create(item.id as ChannelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        toast.success(`${item.name} added`);
        navigate({ to: "/channel/$type/$tab", params: { type: item.id, tab: "feed" } });
      } else {
        const nextEnabled = [...prefs.widgets.enabledWidgets, item.id];
        const nextOnTicker = [...prefs.widgets.widgetsOnTicker, item.id];
        onPrefsChange({
          ...prefs,
          widgets: { ...prefs.widgets, enabledWidgets: nextEnabled, widgetsOnTicker: nextOnTicker },
        });
        toast.success(`${item.name} added`);
        navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
      }
    },
    [navigate, queryClient, prefs, onPrefsChange],
  );

  // ── Remove handler ──────────────────────────────────────────

  const handleRemove = useCallback(
    async (item: MarketplaceItem) => {
      if (item.kind === "channel") {
        await channelsApi.delete(item.id as ChannelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        toast.success(`${item.name} removed`);
      } else {
        const nextEnabled = prefs.widgets.enabledWidgets.filter((id) => id !== item.id);
        const nextOnTicker = prefs.widgets.widgetsOnTicker.filter((id) => id !== item.id);
        onPrefsChange({
          ...prefs,
          widgets: { ...prefs.widgets, enabledWidgets: nextEnabled, widgetsOnTicker: nextOnTicker },
        });
        toast.success(`${item.name} removed`);
      }
    },
    [queryClient, prefs, onPrefsChange],
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Store size={20} className="text-fg-3" />
          <h1 className="text-lg font-bold text-fg">Marketplace</h1>
        </div>
        <p className="text-xs text-fg-4 ml-8">
          Add data feeds and utilities to your ticker
        </p>
      </div>

      {/* Dashboard error banner */}
      {dashboardError && (
        <div className="mb-4">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-edge/20 pb-px">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
              filter === tab.key
                ? "text-fg border-b-2 border-accent"
                : "text-fg-4 hover:text-fg-3",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleItems.map((item) => (
          <MarketplaceCard
            key={item.id}
            item={item}
            enabled={allEnabledIds.has(item.id)}
            tier={tier}
            authenticated={authenticated}
            dashboardLoading={isLoading}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onLogin={onLogin}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Regenerate route tree**

Run: `npm run dev` briefly (or `npx tsr generate`) in `desktop/` to trigger TanStack Router's code generation. The `routeTree.gen.ts` file will auto-update. Kill the dev server after generation.

- [ ] **Step 3: Verify build passes**

Run: `npm run build` (in `desktop/`)
Expected: vite build + tsc succeed. The new route is registered.

- [ ] **Step 4: Commit**

```
git add desktop/src/routes/marketplace.tsx desktop/src/routeTree.gen.ts
git commit -m "feat(desktop): add marketplace route with card grid and category filters"
```

---

### Task 4: Modify `Sidebar.tsx` — add Marketplace nav item

**Files:**
- Modify: `desktop/src/components/Sidebar.tsx`

**Dependencies:** Task 3 must be complete (route exists for navigation).

- [ ] **Step 1: Add `isMarketplace` prop and `onNavigateToMarketplace` callback**

In the `SidebarProps` interface (around line 86), add after `isAccount`:

```typescript
  /** Whether the marketplace page is active. */
  isMarketplace: boolean;
```

And after `onNavigateToAccount` (around line 111):

```typescript
  /** Navigate to the marketplace page. */
  onNavigateToMarketplace: () => void;
```

- [ ] **Step 2: Destructure the new props**

In the function signature (around line 116-132), add `isMarketplace` and `onNavigateToMarketplace` to the destructuring.

- [ ] **Step 3: Add `Store` to the lucide-react import**

At the top of the file, find the lucide-react import and add `Store` to it.

- [ ] **Step 4: Render the Marketplace NavItem between Ticker and Channels**

After the Ticker `NavItem` (after line 222) and before the `{/* Channels section */}` comment (line 224), add:

```tsx
        {/* Marketplace */}
        <NavItem
          icon={<Store size={15} />}
          label="Marketplace"
          active={isMarketplace}
          collapsed={collapsed}
          onClick={onNavigateToMarketplace}
        />
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build` (in `desktop/`)
Expected: Type error because `__root.tsx` doesn't pass the new props yet. That's OK — Task 5 fixes it.

- [ ] **Step 6: Commit (may have type errors until Task 5)**

```
git add desktop/src/components/Sidebar.tsx
git commit -m "feat(desktop): add Marketplace nav item to sidebar"
```

---

### Task 5: Wire `__root.tsx` — route detection and sidebar props

**Files:**
- Modify: `desktop/src/routes/__root.tsx`

**Dependencies:** Task 4 must be complete (Sidebar expects new props).

- [ ] **Step 1: Add `isMarketplace` to `parseRoute()`**

In `parseRoute()` (line 78), add a new branch after the `kind === "ticker"` block (after line 108):

```typescript
  if (kind === "marketplace") {
    return {
      activeItem: "",
      isChannel: false, isWidget: false, isFeed: false,
      isTicker: false, isSettings: false, isAccount: false,
      isMarketplace: true,
    };
  }
```

Also add `isMarketplace: false` to every other return object in `parseRoute()` — there are 7 existing return objects (feed, channel, widget, ticker, settings, account, and the default fallback). Each one needs `isMarketplace: false`.

- [ ] **Step 2: Add the navigate handler**

After `handleNavigateToAccount` (around line 235), add:

```typescript
  const handleNavigateToMarketplace = useCallback(() => navigate({ to: "/marketplace" }), [navigate]);
```

- [ ] **Step 3: Pass the new props to `<Sidebar>`**

In the JSX where `<Sidebar>` is rendered (around line 368-384), add:

```tsx
          isMarketplace={route.isMarketplace}
          onNavigateToMarketplace={handleNavigateToMarketplace}
```

Place `isMarketplace` after `isAccount` (line 373) and `onNavigateToMarketplace` after `onNavigateToAccount` (line 384).

- [ ] **Step 4: Verify build passes**

Run: `npm run build` (in `desktop/`)
Expected: vite build + tsc succeed, zero errors. All Sidebar type errors from Task 4 are now resolved.

- [ ] **Step 5: Commit**

```
git add desktop/src/routes/__root.tsx
git commit -m "feat(desktop): wire marketplace route detection and sidebar navigation"
```

---

### Task 6: Final verification and integration commit

**Files:** All files from Tasks 1-5.

- [ ] **Step 1: Run full build**

Run: `npm run build` (in `desktop/`)
Expected: vite build + tsc succeed, zero errors.

- [ ] **Step 2: Verify route tree includes marketplace**

Check that `desktop/src/routeTree.gen.ts` includes `/marketplace` in the route tree. Do NOT edit this file — it's auto-generated.

- [ ] **Step 3: Manual smoke test (if dev environment available)**

Run: `npm run dev` (in `desktop/`) and:
1. Verify Marketplace appears in sidebar between Ticker and Channels
2. Click Marketplace — grid of 9 cards loads
3. Category tabs filter correctly (All / Data Feeds / Utilities)
4. "Add" button on an available widget adds it and navigates to its feed
5. "Remove" on a channel shows ConfirmDialog
6. Enabled items show green accent + "Added" label
