# RSS Configuration Panel Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat catalog-only RSS config panel with a two-section management page — "My Feeds" (health, search, sort, remove, custom feeds) stacked above an improved "Add Feeds" catalog with category filter dropdown.

**Architecture:** New modular components in `desktop/src/channels/rss/`: `ConfigPanel.tsx` (orchestrator), `MyFeeds.tsx` (subscribed feed management), `FeedCatalog.tsx` (catalog browsing), `CategoryFilter.tsx` (filter dropdown). Backend gets one query parameter addition. Frontend `TrackedFeed` type extended with health fields already in the API response.

**Tech Stack:** React 19, TanStack Query, Tailwind v4, clsx, lucide-react, Go Fiber (backend)

---

## File Structure

### New Files
- `desktop/src/channels/rss/ConfigPanel.tsx` — orchestrator, replaces old `RssConfigPanel.tsx`
- `desktop/src/channels/rss/MyFeeds.tsx` — "My Feeds" section (subscribed list, search, sort, health)
- `desktop/src/channels/rss/FeedCatalog.tsx` — "Add Feeds" catalog section (grid, search, category filter)
- `desktop/src/channels/rss/CategoryFilter.tsx` — category filter dropdown component

### Modified Files
- `desktop/src/api/client.ts` — extend `TrackedFeed`, add `includeFailing` param to `rssApi.getCatalog`
- `desktop/src/api/queries.ts` — update `rssCatalogOptions` + query keys for parameterized catalog
- `desktop/src/channels/ChannelConfigPanel.tsx` — update import path
- `channels/rss/api/rss.go` — add `include_failing` query parameter

### Deleted Files
- `desktop/src/channels/RssConfigPanel.tsx` — replaced by `rss/ConfigPanel.tsx`

---

### Task 1: Backend — Add `include_failing` Query Parameter

**Files:**
- Modify: `channels/rss/api/rss.go:64-109`

- [ ] **Step 1: Update the SQL query to conditionally include failing feeds**

In `channels/rss/api/rss.go`, modify the `getRSSFeedCatalog` function. The current query on line 76 always filters `consecutive_failures < $1`. Add a query parameter check:

```go
func (a *App) getRSSFeedCatalog(c *fiber.Ctx) error {
	ctx := c.Context()
	includeFailing := c.Query("include_failing") == "true"

	// Use separate cache keys so the two variants don't collide
	cacheKey := CacheKeyRSSCatalog
	if includeFailing {
		cacheKey = CacheKeyRSSCatalog + ":all"
	}

	var catalog []TrackedFeed
	if GetCache(a.rdb, ctx, cacheKey, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	// Singleflight: collapse concurrent cache-miss requests into one DB query
	result, err, _ := a.sfGroup.Do(cacheKey, func() (interface{}, error) {
		query := "SELECT url, name, category, is_default, consecutive_failures, last_error, last_success_at FROM tracked_feeds WHERE is_enabled = true"
		var rows pgx.Rows
		var qErr error
		if includeFailing {
			rows, qErr = a.db.Query(ctx, query+" ORDER BY category, name")
		} else {
			rows, qErr = a.db.Query(ctx, query+" AND consecutive_failures < $1 ORDER BY category, name", MaxConsecutiveFailures)
		}
		if qErr != nil {
			return nil, qErr
		}
		defer rows.Close()

		var feeds []TrackedFeed
		for rows.Next() {
			var f TrackedFeed
			if err := rows.Scan(&f.URL, &f.Name, &f.Category, &f.IsDefault, &f.ConsecutiveFailures, &f.LastError, &f.LastSuccessAt); err != nil {
				log.Printf("[RSS] Catalog scan error: %v", err)
				continue
			}
			feeds = append(feeds, f)
		}
		return feeds, nil
	})
	if err != nil {
		log.Printf("[RSS] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch feed catalog",
		})
	}
	catalog = result.([]TrackedFeed)
	if catalog == nil {
		catalog = make([]TrackedFeed, 0)
	}

	SetCache(a.rdb, ctx, cacheKey, catalog, RSSCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}
```

- [ ] **Step 2: Also invalidate the `:all` cache variant when feeds change**

In the same file, find all places that call `a.rdb.Del(ctx, CacheKeyRSSCatalog)` (lines 177 and 498) and add the `:all` variant:

```go
// After each existing: a.rdb.Del(ctx, CacheKeyRSSCatalog)
// Add:                 a.rdb.Del(ctx, CacheKeyRSSCatalog+":all")
```

- [ ] **Step 3: Verify Go build**

Run: `go build -o rss_api && rm rss_api` in `channels/rss/api/`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add channels/rss/api/rss.go
git commit -m "feat(rss-api): add include_failing query parameter to feed catalog"
```

---

### Task 2: Frontend — Extend `TrackedFeed` Type and API Client

**Files:**
- Modify: `desktop/src/api/client.ts:176-194`
- Modify: `desktop/src/api/queries.ts:15-28, 155-161`

- [ ] **Step 1: Extend the `TrackedFeed` interface**

In `desktop/src/api/client.ts`, replace the `TrackedFeed` interface (lines 176-181):

```ts
export interface TrackedFeed {
  url: string;
  name: string;
  category: string;
  is_default: boolean;
  consecutive_failures: number;
  last_error?: string;
  last_success_at?: string;
}
```

- [ ] **Step 2: Update `rssApi.getCatalog` to accept options**

In `desktop/src/api/client.ts`, update the `rssApi` object (lines 183-194):

```ts
export const rssApi = {
  /** Fetch the public feed catalog. Pass includeFailing to see quarantined feeds. */
  getCatalog: (opts?: { includeFailing?: boolean }) => {
    const params = opts?.includeFailing ? "?include_failing=true" : "";
    return request<Array<TrackedFeed>>(`/rss/feeds${params}`);
  },

  /** Delete a custom (non-default) feed from the catalog */
  deleteFeed: (url: string) =>
    authFetch<{ status: string; message: string }>("/rss/feeds", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
};
```

- [ ] **Step 3: Update query keys and `rssCatalogOptions`**

In `desktop/src/api/queries.ts`, update the query keys (lines 18-22) to support parameterized RSS catalog:

```ts
  catalogs: {
    sports: ["catalogs", "sports"] as const,
    finance: ["catalogs", "finance"] as const,
    rss: ["catalogs", "rss"] as const,
    rssAll: ["catalogs", "rss", "all"] as const,
  },
```

Then update the `rssCatalogOptions` function (lines 155-161):

```ts
export function rssCatalogOptions(opts?: { includeFailing?: boolean }) {
  const includeFailing = opts?.includeFailing ?? false;
  return queryOptions({
    queryKey: includeFailing ? queryKeys.catalogs.rssAll : queryKeys.catalogs.rss,
    queryFn: () => rssApi.getCatalog(includeFailing ? { includeFailing: true } : undefined),
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. Existing `RssConfigPanel.tsx` still works since `rssCatalogOptions()` without args behaves identically.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/api/client.ts desktop/src/api/queries.ts
git commit -m "feat(desktop): extend TrackedFeed type with health fields, parameterize catalog query"
```

---

### Task 3: CategoryFilter Component

**Files:**
- Create: `desktop/src/channels/rss/CategoryFilter.tsx`

- [ ] **Step 1: Create the CategoryFilter component**

Create `desktop/src/channels/rss/CategoryFilter.tsx`:

```tsx
import { useState, useRef, useEffect } from "react";
import { Filter } from "lucide-react";
import clsx from "clsx";

interface CategoryFilterProps {
  /** All available categories with their feed counts */
  categories: Array<{ name: string; count: number }>;
  /** Currently selected category names (empty = show all) */
  selected: Set<string>;
  /** Toggle a category on/off */
  onToggle: (category: string) => void;
  /** Clear all filters (show all) */
  onClearAll: () => void;
}

export default function CategoryFilter({
  categories,
  selected,
  onToggle,
  onClearAll,
}: CategoryFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = selected.size;
  const allSelected = activeCount === 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] transition-colors cursor-pointer whitespace-nowrap",
          activeCount > 0
            ? "border-accent/30 text-accent"
            : "border-edge/30 text-fg-4 hover:text-fg-3 hover:border-edge/50",
        )}
      >
        <Filter size={12} />
        <span>Categories</span>
        {activeCount > 0 && (
          <span className="bg-accent/20 text-accent rounded-full px-1.5 text-[10px] font-medium">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface-2 border border-edge/30 rounded-lg shadow-lg z-50 py-1">
          {categories.map((cat) => {
            const isActive = selected.has(cat.name);
            return (
              <button
                key={cat.name}
                onClick={() => onToggle(cat.name)}
                className={clsx(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12px] transition-colors cursor-pointer",
                  isActive
                    ? "text-fg-2"
                    : "text-fg-4 hover:text-fg-3",
                )}
              >
                <span
                  className={clsx(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0",
                    isActive
                      ? "bg-accent/20 border-accent/40 text-accent"
                      : "border-edge/40",
                  )}
                >
                  {isActive && "✓"}
                </span>
                <span className="flex-1 truncate">{cat.name}</span>
                <span className="text-[10px] text-fg-4/50 tabular-nums">{cat.count}</span>
              </button>
            );
          })}
          {activeCount > 0 && (
            <>
              <div className="h-px bg-edge/20 my-1" />
              <button
                onClick={() => {
                  onClearAll();
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] text-fg-4 hover:text-fg-3 transition-colors cursor-pointer"
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. The component is created but not yet imported anywhere.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/channels/rss/CategoryFilter.tsx
git commit -m "feat(desktop): add CategoryFilter dropdown component for RSS catalog"
```

---

### Task 4: MyFeeds Component

**Files:**
- Create: `desktop/src/channels/rss/MyFeeds.tsx`

- [ ] **Step 1: Create the MyFeeds component**

Create `desktop/src/channels/rss/MyFeeds.tsx`:

```tsx
import { useState, useMemo, useCallback } from "react";
import { Plus, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import Tooltip from "../../components/Tooltip";
import UpgradePrompt from "../../components/UpgradePrompt";
import type { TrackedFeed } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface SubscribedFeed {
  name: string;
  url: string;
  is_custom?: boolean;
}

interface MyFeedsProps {
  feeds: SubscribedFeed[];
  /** Full catalog (with health data) for cross-referencing */
  catalogAll: TrackedFeed[];
  onRemove: (url: string) => void;
  onAddCustom: (name: string, url: string) => void;
  feedCount: number;
  maxFeeds: number;
  customCount: number;
  maxCustomFeeds: number;
  subscriptionTier: SubscriptionTier;
  saving: boolean;
}

type SortKey = "name" | "activity" | "category" | "health";

// ── Health Logic ─────────────────────────────────────────────────

function feedHealth(
  feed: SubscribedFeed,
  catalogMap: Map<string, TrackedFeed>,
): "healthy" | "stale" | "failing" {
  const catalogEntry = catalogMap.get(feed.url);
  if (!catalogEntry) return "stale"; // not in catalog = unknown health
  if (catalogEntry.consecutive_failures > 0) return "failing";
  if (!catalogEntry.last_success_at) return "stale";
  const hoursSince =
    (Date.now() - new Date(catalogEntry.last_success_at).getTime()) / 3600000;
  if (hoursSince > 72) return "stale";
  return "healthy";
}

function healthTooltip(
  feed: SubscribedFeed,
  catalogMap: Map<string, TrackedFeed>,
): string {
  const entry = catalogMap.get(feed.url);
  if (!entry) return "Feed status unknown";
  if (entry.consecutive_failures > 0) {
    return entry.last_error
      ? `Feed failing: ${entry.last_error}`
      : `Feed unreachable (${entry.consecutive_failures} failures)`;
  }
  if (!entry.last_success_at) return "No articles received yet";
  const hours = Math.round(
    (Date.now() - new Date(entry.last_success_at).getTime()) / 3600000,
  );
  if (hours < 1) return "Last article: less than 1 hour ago";
  if (hours < 24) return `Last article: ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Last article: ${days}d ago`;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const HEALTH_COLORS = {
  healthy: "bg-green-500",
  stale: "bg-amber-500",
  failing: "bg-red-500",
} as const;

// ── Component ────────────────────────────────────────────────────

export default function MyFeeds({
  feeds,
  catalogAll,
  onRemove,
  onAddCustom,
  feedCount,
  maxFeeds,
  customCount,
  maxCustomFeeds,
  subscriptionTier,
  saving,
}: MyFeedsProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const catalogMap = useMemo(
    () => new Map(catalogAll.map((f) => [f.url, f])),
    [catalogAll],
  );

  const atFeedLimit = feedCount >= maxFeeds;
  const atCustomLimit = customCount >= maxCustomFeeds;

  // Filter + sort feeds
  const sortedFeeds = useMemo(() => {
    let list = feeds;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "activity": {
          const aTime = catalogMap.get(a.url)?.last_success_at ?? "";
          const bTime = catalogMap.get(b.url)?.last_success_at ?? "";
          return bTime.localeCompare(aTime); // newest first
        }
        case "category": {
          const aCat = catalogMap.get(a.url)?.category ?? "zzz";
          const bCat = catalogMap.get(b.url)?.category ?? "zzz";
          return aCat.localeCompare(bCat) || a.name.localeCompare(b.name);
        }
        case "health": {
          const order = { failing: 0, stale: 1, healthy: 2 };
          const aH = order[feedHealth(a, catalogMap)];
          const bH = order[feedHealth(b, catalogMap)];
          return aH - bH || a.name.localeCompare(b.name);
        }
        default:
          return 0;
      }
    });
  }, [feeds, search, sort, catalogMap]);

  const handleAddCustom = useCallback(() => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!/^https?:\/\/.+/.test(url)) {
      setUrlError("Enter a full URL starting with http:// or https://");
      return;
    }
    setUrlError(null);
    onAddCustom(name, url);
    setNewName("");
    setNewUrl("");
    setShowCustomForm(false);
  }, [newName, newUrl, onAddCustom]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            My Feeds
            <span className="bg-accent/15 text-accent px-1.5 py-px rounded-full text-[11px] font-medium tabular-nums">
              {feedCount}
            </span>
          </div>
          <p className="text-[11px] text-fg-4 mt-0.5">
            Manage your subscribed news sources
          </p>
        </div>
        {!atFeedLimit && !atCustomLimit && maxCustomFeeds > 0 && (
          <button
            onClick={() => setShowCustomForm(!showCustomForm)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-accent/30 text-accent text-[11px] hover:bg-accent/5 transition-colors cursor-pointer"
          >
            <Plus size={13} />
            Add custom feed
          </button>
        )}
      </div>

      {/* Upgrade prompt when at feed limit */}
      {atFeedLimit && (
        <UpgradePrompt
          current={feedCount}
          max={maxFeeds}
          noun="feeds"
          tier={subscriptionTier}
        />
      )}

      {/* Custom feed form */}
      {showCustomForm && (
        <div className="p-3 rounded-lg border border-edge/20 bg-surface-2/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider font-bold text-fg-4">
              Add your own feed
            </span>
            {maxCustomFeeds !== Infinity && (
              <span className="text-[10px] text-fg-4 tabular-nums">
                {customCount}/{maxCustomFeeds} custom
              </span>
            )}
          </div>
          {atCustomLimit ? (
            <UpgradePrompt
              current={customCount}
              max={maxCustomFeeds}
              noun="custom feeds"
              tier={subscriptionTier}
            />
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Feed name"
                  className="flex-1 px-3 py-2 rounded-lg bg-base-200 border border-edge/30 text-[12px] font-mono text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/40 transition-colors"
                />
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustom();
                  }}
                  placeholder="https://..."
                  className="flex-[2] px-3 py-2 rounded-lg bg-base-200 border border-edge/30 text-[12px] font-mono text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/40 transition-colors"
                />
                <button
                  onClick={handleAddCustom}
                  disabled={saving || !newName.trim() || !newUrl.trim()}
                  className="px-3 py-2 rounded-lg bg-base-250 border border-edge/30 text-fg-3 hover:text-accent hover:border-accent/30 transition-colors flex items-center gap-1.5 disabled:opacity-30 cursor-pointer"
                >
                  <Plus size={13} />
                  <span className="text-[11px] font-medium">Add</span>
                </button>
              </div>
              {urlError && (
                <p className="text-[11px] text-error/70">{urlError}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Search + Sort controls */}
      {feeds.length > 0 && (
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter feeds..."
            className="flex-1 px-2.5 py-1.5 rounded-md bg-base-200 border border-edge/20 text-[11px] text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/30 transition-colors"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-2.5 py-1.5 rounded-md bg-base-200 border border-edge/20 text-[11px] text-fg-3 focus:outline-none focus:border-accent/30 transition-colors cursor-pointer appearance-none"
          >
            <option value="name">Sort: Name</option>
            <option value="activity">Sort: Last Activity</option>
            <option value="category">Sort: Category</option>
            <option value="health">Sort: Health</option>
          </select>
        </div>
      )}

      {/* Feed list */}
      {sortedFeeds.length > 0 ? (
        <div className="border border-edge/10 rounded-lg overflow-hidden divide-y divide-edge/5">
          {sortedFeeds.map((feed) => {
            const health = feedHealth(feed, catalogMap);
            const entry = catalogMap.get(feed.url);
            return (
              <div
                key={feed.url}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-base-200/50 transition-colors"
              >
                <Tooltip content={healthTooltip(feed, catalogMap)} side="right">
                  <div
                    className={clsx(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      HEALTH_COLORS[health],
                    )}
                  />
                </Tooltip>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-fg-2 truncate block">
                    {feed.name}
                  </span>
                </div>
                {feed.is_custom ? (
                  <span className="px-1.5 py-px rounded text-[9px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/15 shrink-0">
                    custom
                  </span>
                ) : (
                  <span className="px-1.5 py-px rounded text-[9px] text-fg-4/50 bg-accent/5 shrink-0">
                    {entry?.category ?? ""}
                  </span>
                )}
                <span className="text-[10px] text-fg-4/40 tabular-nums shrink-0 w-14 text-right">
                  {health === "failing" ? (
                    <span className="text-red-500">failing</span>
                  ) : (
                    relativeTime(entry?.last_success_at)
                  )}
                </span>
                <Tooltip content="Remove feed">
                  <button
                    onClick={() => onRemove(feed.url)}
                    className="p-1 rounded hover:bg-error/10 text-fg-4/30 hover:text-error transition-colors cursor-pointer shrink-0"
                    aria-label={`Remove ${feed.name}`}
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      ) : feeds.length > 0 ? (
        <p className="text-[11px] text-fg-4 text-center py-4">
          No feeds match your filter
        </p>
      ) : (
        <p className="text-[11px] text-fg-4 text-center py-4">
          No feeds subscribed yet. Browse the catalog below to add some.
        </p>
      )}

      {/* Tier limit footer */}
      {feeds.length > 0 && (
        <p className="text-[10px] text-fg-4/40 text-right tabular-nums">
          {feedCount} / {maxFeeds === Infinity ? "∞" : maxFeeds} feeds
          {maxCustomFeeds > 0 &&
            ` (${customCount} / ${maxCustomFeeds === Infinity ? "∞" : maxCustomFeeds} custom)`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. Component created but not yet imported.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/channels/rss/MyFeeds.tsx
git commit -m "feat(desktop): add MyFeeds component for RSS subscription management"
```

---

### Task 5: FeedCatalog Component

**Files:**
- Create: `desktop/src/channels/rss/FeedCatalog.tsx`

- [ ] **Step 1: Create the FeedCatalog component**

Create `desktop/src/channels/rss/FeedCatalog.tsx`:

```tsx
import { useState, useMemo, useCallback } from "react";
import { Rss } from "lucide-react";
import clsx from "clsx";
import CategoryFilter from "./CategoryFilter";
import type { TrackedFeed } from "../../api/client";

// ── Types ────────────────────────────────────────────────────────

interface FeedCatalogProps {
  catalog: TrackedFeed[];
  subscribedUrls: Set<string>;
  onAdd: (url: string) => void;
  loading: boolean;
  error: boolean;
  atLimit: boolean;
}

// ── Component ────────────────────────────────────────────────────

export default function FeedCatalog({
  catalog,
  subscribedUrls,
  onAdd,
  loading,
  error,
  atLimit,
}: FeedCatalogProps) {
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );

  // Derive categories with counts
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of catalog) {
      map.set(f.category, (map.get(f.category) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [catalog]);

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Filter catalog
  const filtered = useMemo(() => {
    let list = catalog;
    if (selectedCategories.size > 0) {
      list = list.filter((f) => selectedCategories.has(f.category));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.url.toLowerCase().includes(q),
      );
    }
    return list;
  }, [catalog, selectedCategories, search]);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-fg-3">Failed to load feed catalog</p>
        <p className="text-[11px] text-fg-4 mt-1">
          Check your connection and try again
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-fg">Add Feeds</h3>
        <p className="text-[11px] text-fg-4 mt-0.5">
          Browse and add from {catalog.length} curated sources
        </p>
      </div>

      {/* Search + Category filter */}
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search catalog..."
          className="flex-1 px-2.5 py-1.5 rounded-md bg-base-200 border border-edge/20 text-[11px] text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/30 transition-colors"
        />
        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClearAll={() => setSelectedCategories(new Set())}
        />
      </div>

      {/* Active filter chips */}
      {selectedCategories.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(selectedCategories).map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] text-accent hover:bg-accent/15 transition-colors cursor-pointer"
            >
              {cat}
              <span className="opacity-60">×</span>
            </button>
          ))}
          <button
            onClick={() => setSelectedCategories(new Set())}
            className="px-2 py-0.5 text-[10px] text-fg-4 hover:text-fg-3 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Catalog grid */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-[11px] text-fg-4 animate-pulse">
            Loading catalog...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[11px] text-fg-4">No feeds match your search</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {filtered.map((feed) => {
            const isAdded = subscribedUrls.has(feed.url);
            return (
              <div
                key={feed.url}
                className={clsx(
                  "flex flex-col gap-1 p-2.5 rounded-lg border transition-colors",
                  isAdded
                    ? "border-accent/15 bg-accent/[0.02]"
                    : "border-edge/10 hover:border-edge/20",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-fg-2 leading-tight">
                    {feed.name}
                    {isAdded && (
                      <span className="text-accent text-[10px] ml-1">✓</span>
                    )}
                  </span>
                  <span className="px-1.5 py-px rounded text-[9px] text-fg-4/50 bg-accent/5 shrink-0 whitespace-nowrap">
                    {feed.category}
                  </span>
                </div>
                {!feed.is_default && (
                  <span className="text-[9px] text-amber-500/60">custom</span>
                )}
                <div className="mt-auto pt-1">
                  {isAdded ? (
                    <span className="text-[11px] text-fg-4/40">Added</span>
                  ) : (
                    <button
                      onClick={() => onAdd(feed.url)}
                      disabled={atLimit}
                      className="text-[11px] text-green-500 hover:text-green-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      + Add
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/channels/rss/FeedCatalog.tsx
git commit -m "feat(desktop): add FeedCatalog component with category filter and card grid"
```

---

### Task 6: ConfigPanel Orchestrator + Wiring

**Files:**
- Create: `desktop/src/channels/rss/ConfigPanel.tsx`
- Modify: `desktop/src/channels/ChannelConfigPanel.tsx:5, 48-55`
- Delete: `desktop/src/channels/RssConfigPanel.tsx`

- [ ] **Step 1: Create the new ConfigPanel orchestrator**

Create `desktop/src/channels/rss/ConfigPanel.tsx`:

```tsx
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import MyFeeds from "./MyFeeds";
import FeedCatalog from "./FeedCatalog";
import { rssApi } from "../../api/client";
import { rssCatalogOptions, queryKeys } from "../../api/queries";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { getLimit } from "../../tierLimits";
import type { Channel, RssChannelConfig, TrackedFeed } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface RssConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

// ── Component ────────────────────────────────────────────────────

export default function RssConfigPanel({
  channel,
  subscriptionTier,
}: RssConfigPanelProps) {
  const queryClient = useQueryClient();
  const { error, setError, saving, updateItems } = useChannelConfig<
    Array<{ name: string; url: string; is_custom?: boolean }>
  >("rss", "feeds");

  // User's subscribed feeds from channel config
  const rssConfig = channel.config as RssChannelConfig;
  const feeds = Array.isArray(rssConfig?.feeds) ? rssConfig.feeds : [];
  const feedUrlSet = useMemo(() => new Set(feeds.map((f) => f.url)), [feeds]);

  // Tier limits
  const maxFeeds = getLimit(subscriptionTier, "feeds");
  const maxCustomFeeds = getLimit(subscriptionTier, "customFeeds");
  const customFeedCount = useMemo(
    () => feeds.filter((f) => f.is_custom).length,
    [feeds],
  );

  // Catalog queries — clean (for browsing) and full (for health data)
  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(rssCatalogOptions());

  const { data: catalogAll = [] } = useQuery(
    rssCatalogOptions({ includeFailing: true }),
  );

  // Delete catalog feed mutation (for custom feeds)
  const deleteCatalogMutation = useMutation({
    mutationFn: (url: string) => rssApi.deleteFeed(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalogs.rss });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalogs.rssAll });
    },
    onError: () => setError("Failed to remove feed from catalog"),
  });

  // ── Handlers ───────────────────────────────────────────────────

  const addCatalogFeed = useCallback(
    (url: string) => {
      if (feeds.length >= maxFeeds) return;
      // Look in both catalogs (clean + full) to find the feed
      const allFeeds = [...catalog, ...catalogAll];
      const feed = allFeeds.find((f) => f.url === url);
      if (!feed || feedUrlSet.has(url)) return;
      updateItems([...feeds, { name: feed.name, url: feed.url }]);
    },
    [catalog, catalogAll, feeds, feedUrlSet, updateItems, maxFeeds],
  );

  const removeFeed = useCallback(
    (url: string) => {
      updateItems(feeds.filter((f) => f.url !== url));
    },
    [feeds, updateItems],
  );

  const addCustomFeed = useCallback(
    (name: string, url: string) => {
      if (feeds.length >= maxFeeds) return;
      if (customFeedCount >= maxCustomFeeds) return;
      if (feedUrlSet.has(url)) {
        toast.error("This feed is already added");
        return;
      }
      updateItems([...feeds, { name, url, is_custom: true }]);
    },
    [feeds, feedUrlSet, updateItems, maxFeeds, maxCustomFeeds, customFeedCount],
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 pb-8">
      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-[11px] text-error flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-error/60 hover:text-error cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Section 1: My Feeds */}
      <MyFeeds
        feeds={feeds}
        catalogAll={catalogAll}
        onRemove={removeFeed}
        onAddCustom={addCustomFeed}
        feedCount={feeds.length}
        maxFeeds={maxFeeds}
        customCount={customFeedCount}
        maxCustomFeeds={maxCustomFeeds}
        subscriptionTier={subscriptionTier}
        saving={saving}
      />

      {/* Divider */}
      <div className="h-px bg-edge/10" />

      {/* Section 2: Add Feeds (Catalog) */}
      <FeedCatalog
        catalog={catalog}
        subscribedUrls={feedUrlSet}
        onAdd={addCatalogFeed}
        loading={catalogLoading}
        error={catalogError}
        atLimit={feeds.length >= maxFeeds}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `ChannelConfigPanel.tsx` to import from new location**

In `desktop/src/channels/ChannelConfigPanel.tsx`, change line 5:

```ts
// Old:
import RssConfigPanel from "./RssConfigPanel";
// New:
import RssConfigPanel from "./rss/ConfigPanel";
```

- [ ] **Step 3: Delete the old `RssConfigPanel.tsx`**

```bash
rm desktop/src/channels/RssConfigPanel.tsx
```

- [ ] **Step 4: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. The full RSS config panel overhaul is now active.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/channels/rss/ConfigPanel.tsx desktop/src/channels/ChannelConfigPanel.tsx
git rm desktop/src/channels/RssConfigPanel.tsx
git commit -m "feat(desktop): replace RSS config panel with two-section management experience

- My Feeds: subscribed feed list with health indicators, search, sort, custom feed form
- Add Feeds: catalog grid with category filter dropdown
- Health dots: green (healthy), amber (stale 3+ days), red (failing)
- Per-feed tooltips show last article time or error details"
```

---

### Task 7: Manual Testing + Polish

**Files:** None (testing only)

- [ ] **Step 1: Start the desktop app in dev mode**

Run: `npm run tauri:dev` in `desktop/`

- [ ] **Step 2: Navigate to RSS configuration**

Go to the RSS channel → Configuration tab. Verify:
- "My Feeds" section shows at top with subscribed feeds
- Health dots appear (green for healthy feeds)
- Search filters the list
- Sort dropdown works (Name, Last Activity, Category, Health)
- Remove button (X) removes a feed
- "Add custom feed" button shows the inline form
- Tier limit indicator shows at bottom

- [ ] **Step 3: Test the catalog section**

Scroll down to "Add Feeds". Verify:
- Feed cards display in a 2-column grid
- Search filters the catalog
- "Categories" button opens the filter dropdown
- Checking/unchecking categories filters the grid
- Active filter chips appear below the controls
- "Clear all" resets filters
- "+ Add" button adds a feed (moves it to My Feeds with health dot)
- Already-added feeds show "Added" state (muted)

- [ ] **Step 4: Test edge cases**

- Add feeds until tier limit → UpgradePrompt appears
- Add a custom feed → verify it appears in My Feeds with "custom" badge
- Remove all feeds → empty state message appears in My Feeds
- Sort by Health → failing feeds appear first (if any)

- [ ] **Step 5: Verify build passes**

Run: `npm run build` in `desktop/`
Expected: Clean build with zero errors.
