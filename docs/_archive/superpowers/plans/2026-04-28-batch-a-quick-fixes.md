# Batch A — Quick Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three independent, low-risk desktop fixes in one PR: Windows updater false-positive seed fix, removal of the pin-to-sidebar feature, and ticker chip clicks that open the relevant external URL.

**Architecture:** All three changes live entirely in `desktop/`. No backend or website touches. Three logical commits, one per item, reviewable in isolation. Item 1 modifies one file; Item 3 deletes a preference field across 7 files and rewires the sidebar to derive from existing state; Item 6 adds a small URL-helper module and threads an optional `url` argument through the existing `onChipClick` chain.

**Tech Stack:** React 19 + TanStack Router, Tauri v2, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-updater`, Vitest 154-test suite for selector tests.

**Spec:** `docs/superpowers/specs/2026-04-28-batch-a-quick-fixes-design.md`

---

## File Structure

### Item 1 — Updater seed fix
- Modify: `desktop/src/components/settings/GeneralSettings.tsx:124-163` (the `handleCheckForUpdates` callback body)

### Item 3 — Pin-to-sidebar removal
- Modify: `desktop/src/marketplace.ts` — add `CANONICAL_ORDER` export
- Modify: `desktop/src/routes/__root.tsx:376-391, 548` — replace `resolvedPinnedSources` memo
- Modify: `desktop/src/components/Sidebar.tsx:73-79, 94, 121, 194-207` — rename interface + prop
- Modify: `desktop/src/routes/catalog.tsx:37, 86-150, 195-208` — drop pin handlers + props
- Modify: `desktop/src/components/marketplace/CatalogCard.tsx:3, 25-58, 162-228` — remove pin button block
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx:259-271` — remove `pinnedIds`
- Modify: `desktop/src/hooks/useChannelActions.ts:68-87` — drop pinnedSources cleanup
- Modify: `desktop/src/hooks/useWidgetActions.ts:34-70` — drop pinnedSources cleanup
- Modify: `desktop/src/preferences.ts:380-387, 555, 901, 966` — drop field, default, loadPrefs read, reset

### Item 6 — Ticker chip external URL
- Create: `desktop/src/utils/chipUrl.ts` — URL builder + Yahoo helpers
- Create: `desktop/src/utils/chipUrl.test.ts` — unit tests (Yahoo URL parsing/construction)
- Modify: `desktop/src/components/ScrollrTicker.tsx:40, 168, 206, 221, 252, 275, 300, 453` — extend `onChipClick` signature, pass URLs from each chip wrap site
- Modify: `desktop/src/App.tsx:344-352` — branch in `handleChipClick`: if URL, `open(url)`; else fall back to `show_app_window`

---

## Phase 1 — Item 1: Updater seed fix

### Task 1.1: Modify the version-match branch in `handleCheckForUpdates`

**Files:**
- Modify: `desktop/src/components/settings/GeneralSettings.tsx:124-163`

The current code at lines 137–146 has a guard that only fires when `storedDate` is truthy. We extend it to also handle the empty-store case (Windows MSI installs that never went through the in-app updater): when `update.version === appVersion` AND `storedDate` is null, seed the store with `update.date` and report up-to-date.

- [ ] **Step 1: Read the current handler**

Read `desktop/src/components/settings/GeneralSettings.tsx` lines 124-163 to confirm the current shape (already done during planning; the code below assumes it).

- [ ] **Step 2: Replace the version-match branch**

Replace lines 134-146 (the `// Same-version patch detection` block) with the seeded version. Use `Edit` with this exact old/new pair:

`oldString` (in `desktop/src/components/settings/GeneralSettings.tsx`):
```ts
      // Same-version patch detection: if the remote version matches the
      // installed version AND the pub_date matches what we stored after
      // our last install, the user already has this exact build.
      const storedDate = getStore<string | null>(KEY_LAST_UPDATE_DATE, null);
      if (
        update.version === appVersion &&
        storedDate &&
        update.date === storedDate
      ) {
        pendingUpdate.current = null;
        setStatus({ step: "up-to-date" });
        return;
      }
```

`newString`:
```ts
      // Same-version patch detection: when the remote version matches
      // the installed version, we suppress the "update available" UI
      // unless the remote pub_date has changed since we last recorded
      // it. KEY_LAST_UPDATE_DATE is normally seeded by the
      // post-downloadAndInstall reconcile loop above (lines 107-115).
      // For users who installed via a manual download (Windows MSI in
      // particular), that loop never runs, so the store stays empty
      // and every check used to false-positive. The empty-store branch
      // below seeds the date once on first check, then the existing
      // match-suppression takes over on subsequent checks.
      if (update.version === appVersion) {
        const storedDate = getStore<string | null>(KEY_LAST_UPDATE_DATE, null);
        if (storedDate === null) {
          // First in-app check on a build the in-app updater never
          // installed. Trust the remote pub_date and seed.
          setStore(KEY_LAST_UPDATE_DATE, update.date);
          pendingUpdate.current = null;
          setStatus({ step: "up-to-date" });
          return;
        }
        if (update.date === storedDate) {
          pendingUpdate.current = null;
          setStatus({ step: "up-to-date" });
          return;
        }
        // Stored date differs from remote: a genuine same-version
        // patched rebuild has shipped. Fall through to "available".
      }
```

- [ ] **Step 3: Verify the file compiles**

Run from `desktop/`:
```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: empty output (clean) or only pre-existing errors unrelated to GeneralSettings.tsx.

- [ ] **Step 4: Smoke-test the build**

Run from `desktop/`:
```bash
cd desktop && npm run build 2>&1 | tail -10
```
Expected: `vite build` succeeds, `tsc --noEmit` succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/settings/GeneralSettings.tsx
git commit -m "fix(updater): seed KEY_LAST_UPDATE_DATE on first version-match check

Windows users overwhelmingly install via MSI manual download from the
GitHub releases page. The post-downloadAndInstall reconcile loop in
GeneralSettings.tsx never seeds KEY_LAST_UPDATE_DATE for these users,
so the existing pub_date guard at line 137 short-circuits (storedDate
is null) and every Check for Updates falsely reports an update
available against the same version they already have.

Add an empty-store branch: when update.version === appVersion and
storedDate is null, seed it with update.date and report up-to-date.
Subsequent checks then hit the existing match-suppression at line 144.

The 'patched rebuild' pattern (re-issuing v1.0.3 with a fix without
bumping the version number) is preserved: a genuinely new pub_date
falls through to the 'available' branch.

Edge case: a user who manually downloads an OLDER MSI than the latest
GitHub release will have its pub_date mismatched and the seed step
will record the LATER pub_date as 'the one I'm on', silently skipping
the patch they're missing. Requires deliberate downgrade; acceptable."
```

---

## Phase 2 — Item 3: Pin-to-sidebar removal

This phase deletes the `pinnedSources` field from preferences and rewires the sidebar to read from `dashboard.channels` (filtered to `enabled`) plus `prefs.widgets.enabledWidgets`. Order matters: replace the consumer (sidebar memo) first, then remove the writers (catalog/onboarding/hooks), then drop the field itself last.

### Task 2.1: Add `CANONICAL_ORDER` export to `marketplace.ts`

The catalog already defines this constant locally (`catalog.tsx:37`). Lift it into the shared module so the sidebar memo and the catalog grid use the same source.

**Files:**
- Modify: `desktop/src/marketplace.ts`

- [ ] **Step 1: Add import + export**

Edit `desktop/src/marketplace.ts`. Insert two new lines after the existing imports.

`oldString`:
```ts
import { getAllChannels } from "./channels/registry";
import { getAllWidgets } from "./widgets/registry";
```

`newString`:
```ts
import { getAllChannels, CHANNEL_ORDER } from "./channels/registry";
import { getAllWidgets, WIDGET_ORDER } from "./widgets/registry";

/** Canonical sort order for catalog items, sidebar entries, and any
 * other UI that lists channels and widgets together. Channels first,
 * then widgets, both in their per-registry-defined order. */
export const CANONICAL_ORDER = [...CHANNEL_ORDER, ...WIDGET_ORDER];
```

- [ ] **Step 2: Verify the registry exports exist**

Confirmed during planning: `desktop/src/channels/registry.ts:28` exports `CHANNEL_ORDER`, `desktop/src/widgets/registry.ts:28` exports `WIDGET_ORDER`. Both are `string[]` of source IDs. No registry changes needed.

- [ ] **Step 3: Update the catalog to import from marketplace.ts**

Edit `desktop/src/routes/catalog.tsx`. Replace the inline constant.

`oldString`:
```ts
// ── Sort order: enabled first, then canonical order ─────────────

const CANONICAL_ORDER = [...CHANNEL_ORDER, ...WIDGET_ORDER];
```

`newString`:
```ts
// ── Sort order: enabled first, then canonical order ─────────────
// (CANONICAL_ORDER is exported from marketplace.ts; we import it
//  alongside the other catalog primitives below.)
```

Then update the existing import. `oldString`:
```ts
import { getCatalogItems, CATEGORY_LABELS } from "../marketplace";
```

`newString`:
```ts
import { getCatalogItems, CATEGORY_LABELS, CANONICAL_ORDER } from "../marketplace";
```

If the file currently imports `CHANNEL_ORDER` or `WIDGET_ORDER` directly from the registries (it should not after this change), remove those imports.

- [ ] **Step 4: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: empty.

### Task 2.2: Replace `resolvedPinnedSources` memo in `__root.tsx`

The memo currently iterates `prefs.pinnedSources`. Replace with one that reads `dashboard.channels` (filtered to `enabled === true`) + `prefs.widgets.enabledWidgets`, sorted via `CANONICAL_ORDER`.

**Files:**
- Modify: `desktop/src/routes/__root.tsx:376-391`

- [ ] **Step 1: Confirm imports we'll need**

The new memo references `dashboard` (already in scope), `prefs.widgets.enabledWidgets`, `allChannelManifests`, `allWidgets` (all already in scope as confirmed by lines 380, 384). It also needs `CANONICAL_ORDER`. Add an import.

Read the current import block at the top of `desktop/src/routes/__root.tsx`. Add `CANONICAL_ORDER` to the existing `marketplace` import (or add a new import line if marketplace isn't yet imported).

- [ ] **Step 2: Replace the memo**

`oldString` (in `desktop/src/routes/__root.tsx`):
```ts
  // Resolve pinned source IDs to manifest data for the sidebar
  const resolvedPinnedSources = useMemo(() => {
    return prefs.pinnedSources
      .map((id) => {
        const chManifest = allChannelManifests.find((m) => m.id === id);
        if (chManifest) {
          return { id, name: chManifest.name, hex: chManifest.hex, icon: chManifest.icon, kind: "channel" as const };
        }
        const wManifest = allWidgets.find((w) => w.id === id);
        if (wManifest) {
          return { id, name: wManifest.name, hex: wManifest.hex, icon: wManifest.icon, kind: "widget" as const };
        }
        return null;
      })
      .filter(Boolean) as Array<{ id: string; name: string; hex: string; icon: React.ComponentType<{ size?: number; className?: string }>; kind: "channel" | "widget" }>;
  }, [prefs.pinnedSources, allChannelManifests, allWidgets]);
```

`newString`:
```ts
  // Build the sidebar source list from the user's enabled channels and
  // widgets. Channels come from the live `dashboard.channels` payload
  // (filtered to `enabled === true`); widgets come from
  // `prefs.widgets.enabledWidgets`. Both are sorted via the shared
  // CANONICAL_ORDER so the sidebar matches the catalog grid order.
  // `Channel.visible` is intentionally NOT consulted here — visibility
  // is a feed-level filter, not a navigation gate.
  const sidebarSources = useMemo(() => {
    const enabledChannelIds = new Set(
      (dashboard?.channels ?? [])
        .filter((c) => c.enabled === true)
        .map((c) => c.channel_type),
    );
    const enabledWidgetIds = new Set(prefs.widgets.enabledWidgets);

    const sources: Array<{
      id: string;
      name: string;
      hex: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      kind: "channel" | "widget";
    }> = [];

    for (const id of CANONICAL_ORDER) {
      if (enabledChannelIds.has(id)) {
        const m = allChannelManifests.find((m) => m.id === id);
        if (m) {
          sources.push({ id, name: m.name, hex: m.hex, icon: m.icon, kind: "channel" });
        }
      } else if (enabledWidgetIds.has(id)) {
        const m = allWidgets.find((w) => w.id === id);
        if (m) {
          sources.push({ id, name: m.name, hex: m.hex, icon: m.icon, kind: "widget" });
        }
      }
    }
    return sources;
  }, [dashboard?.channels, prefs.widgets.enabledWidgets, allChannelManifests, allWidgets]);
```

- [ ] **Step 3: Update the prop passed to `<Sidebar>`**

Find the `<Sidebar` element (around line 548) and rename the prop:

`oldString`:
```ts
          pinnedSources={resolvedPinnedSources}
```

`newString`:
```ts
          sources={sidebarSources}
```

- [ ] **Step 4: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors mentioning `Sidebar.tsx` (because we just renamed the prop and the Sidebar still expects the old name). Those resolve in Task 2.3.

### Task 2.3: Rename Sidebar prop interface

**Files:**
- Modify: `desktop/src/components/Sidebar.tsx:73-79, 94, 121`

- [ ] **Step 1: Rename `PinnedSource` → `SidebarSource`**

`oldString` (in `desktop/src/components/Sidebar.tsx`):
```ts
interface PinnedSource {
  id: string;
  name: string;
  hex: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kind: "channel" | "widget";
}
```

`newString`:
```ts
interface SidebarSource {
  id: string;
  name: string;
  hex: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kind: "channel" | "widget";
}
```

- [ ] **Step 2: Rename the prop name in the interface**

`oldString`:
```ts
  /** Resolved pinned sources with manifest data. */
  pinnedSources: PinnedSource[];
```

`newString`:
```ts
  /** Resolved enabled-source manifest data, in canonical order. */
  sources: SidebarSource[];
```

- [ ] **Step 3: Rename the destructured prop in the component signature**

`oldString`:
```ts
  pinnedSources,
```

`newString`:
```ts
  sources,
```

- [ ] **Step 4: Update the JSX usage**

`oldString`:
```ts
        {/* Pinned sources */}
        {pinnedSources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-edge/20 space-y-0.5">
            {pinnedSources.map((source) => (
              <NavItem
                key={source.id}
                icon={<span style={{ color: source.hex }}><source.icon size={15} /></span>}
                label={source.name}
                active={activeItem === source.id}
                collapsed={collapsed}
                onClick={() => onSelectItem(source.id, source.kind)}
              />
            ))}
          </div>
        )}
```

`newString`:
```ts
        {/* Enabled channels + widgets */}
        {sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-edge/20 space-y-0.5">
            {sources.map((source) => (
              <NavItem
                key={source.id}
                icon={<span style={{ color: source.hex }}><source.icon size={15} /></span>}
                label={source.name}
                active={activeItem === source.id}
                collapsed={collapsed}
                onClick={() => onSelectItem(source.id, source.kind)}
              />
            ))}
          </div>
        )}
```

- [ ] **Step 5: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in places that still reference `prefs.pinnedSources` (catalog/wizard/hooks/preferences). Sidebar + __root should be clean.

### Task 2.4: Strip pin-button machinery from `CatalogCard.tsx`

**Files:**
- Modify: `desktop/src/components/marketplace/CatalogCard.tsx:3, 25-58, 162-228`

- [ ] **Step 1: Drop unused imports**

`oldString`:
```ts
import { Check, ChevronRight, ExternalLink, Loader2, Pin, PinOff } from "lucide-react";
```

`newString`:
```ts
import { Check, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
```

- [ ] **Step 2: Drop the Tooltip import if it becomes unused**

The Pin button used a `<Tooltip>`. After removal, check whether Tooltip is referenced elsewhere in `CatalogCard.tsx`. Run:
```bash
cd desktop && grep -n "Tooltip" src/components/marketplace/CatalogCard.tsx
```
Expected: only the import line at line 9. If so, also remove this line:
```ts
import Tooltip from "../Tooltip";
```

- [ ] **Step 3: Drop `pinned` and `onTogglePin` from props**

`oldString`:
```ts
interface CatalogCardProps {
  item: CatalogItem;
  enabled: boolean;
  /** True when this source appears in the left sidebar. Only meaningful when enabled. */
  pinned: boolean;
  tier: SubscriptionTier;
  authenticated: boolean;
  /** Disable Add button while dashboard is loading (channels enabled state unknown). */
  dashboardLoading: boolean;
  onAdd: (item: CatalogItem) => Promise<void>;
  onRemove: (item: CatalogItem) => Promise<void>;
  onLogin: () => void;
  /** Toggle sidebar pin state. Only rendered when `enabled` is true. */
  onTogglePin?: (item: CatalogItem) => void;
  /** Navigate to the channel/widget page when already added. */
  onOpen?: (item: CatalogItem) => void;
}
```

`newString`:
```ts
interface CatalogCardProps {
  item: CatalogItem;
  enabled: boolean;
  tier: SubscriptionTier;
  authenticated: boolean;
  /** Disable Add button while dashboard is loading (channels enabled state unknown). */
  dashboardLoading: boolean;
  onAdd: (item: CatalogItem) => Promise<void>;
  onRemove: (item: CatalogItem) => Promise<void>;
  onLogin: () => void;
  /** Navigate to the channel/widget page when already added. */
  onOpen?: (item: CatalogItem) => void;
}
```

- [ ] **Step 4: Drop the same props from the component signature**

`oldString`:
```ts
export default function CatalogCard({
  item,
  enabled,
  pinned,
  tier,
  authenticated,
  dashboardLoading,
  onAdd,
  onRemove,
  onLogin,
  onTogglePin,
  onOpen,
}: CatalogCardProps) {
```

`newString`:
```ts
export default function CatalogCard({
  item,
  enabled,
  tier,
  authenticated,
  dashboardLoading,
  onAdd,
  onRemove,
  onLogin,
  onOpen,
}: CatalogCardProps) {
```

- [ ] **Step 5: Drop the Pin/PinOff button block**

`oldString`:
```ts
          ) : enabled ? (
            <div className="flex items-center gap-3">
              {onTogglePin && (
                <Tooltip content={pinned ? "Unpin from sidebar" : "Pin to sidebar"}>
                  <button
                    onClick={() => onTogglePin(item)}
                    aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name} to sidebar`}
                    aria-pressed={pinned}
                    className={clsx(
                      "w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer",
                      pinned
                        ? "text-accent hover:bg-surface-hover"
                        : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
                    )}
                  >
                    {pinned ? <Pin size={14} /> : <PinOff size={14} />}
                  </button>
                </Tooltip>
              )}
              <button
                onClick={handleRemoveClick}
                className="text-xs font-medium text-fg-4 hover:text-error transition-colors"
              >
                Remove
              </button>
              {onOpen && (
                <button
                  onClick={() => onOpen(item)}
                  className="flex items-center gap-0.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
                >
                  Open <ChevronRight size={12} />
                </button>
              )}
            </div>
```

`newString`:
```ts
          ) : enabled ? (
            <div className="flex items-center gap-3">
              <button
                onClick={handleRemoveClick}
                className="text-xs font-medium text-fg-4 hover:text-error transition-colors"
              >
                Remove
              </button>
              {onOpen && (
                <button
                  onClick={() => onOpen(item)}
                  className="flex items-center gap-0.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
                >
                  Open <ChevronRight size={12} />
                </button>
              )}
            </div>
```

- [ ] **Step 6: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in `catalog.tsx` (which still passes the now-removed props).

### Task 2.5: Strip pin handling from `catalog.tsx`

**Files:**
- Modify: `desktop/src/routes/catalog.tsx:84-150, 195-208`

- [ ] **Step 1: Drop `pinnedSources` writes from `handleAdd`**

`oldString`:
```ts
  const handleAdd = useCallback(
    async (item: CatalogItem) => {
      const nextPinned = prefs.pinnedSources.includes(item.id)
        ? prefs.pinnedSources
        : [...prefs.pinnedSources, item.id];

      if (item.kind === "channel") {
        await channelsApi.create(item.id as ChannelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        onPrefsChange({ ...prefs, pinnedSources: nextPinned });
        toast.success(`${item.name} added`);
        navigate({ to: "/channel/$type/$tab", params: { type: item.id, tab: "feed" } });
      } else {
        const nextEnabled = [...prefs.widgets.enabledWidgets, item.id];
        const nextOnTicker = [...prefs.widgets.widgetsOnTicker, item.id];
        onPrefsChange({
          ...prefs,
          pinnedSources: nextPinned,
          widgets: { ...prefs.widgets, enabledWidgets: nextEnabled, widgetsOnTicker: nextOnTicker },
        });
        toast.success(`${item.name} added`);
        navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
      }
    },
    [navigate, queryClient, prefs, onPrefsChange],
  );
```

`newString`:
```ts
  const handleAdd = useCallback(
    async (item: CatalogItem) => {
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
```

- [ ] **Step 2: Drop `handleTogglePin` entirely**

`oldString`:
```ts
  // ── Pin toggle ──────────────────────────────────────────────

  const handleTogglePin = useCallback(
    (item: CatalogItem) => {
      const pinned = prefs.pinnedSources.includes(item.id);
      const nextPinned = pinned
        ? prefs.pinnedSources.filter((id) => id !== item.id)
        : [...prefs.pinnedSources, item.id];
      onPrefsChange({ ...prefs, pinnedSources: nextPinned });
    },
    [prefs, onPrefsChange],
  );

  // ── Remove handler ──────────────────────────────────────────
```

`newString`:
```ts
  // ── Remove handler ──────────────────────────────────────────
```

- [ ] **Step 3: Drop `pinnedSources` writes from `handleRemove`**

`oldString`:
```ts
  const handleRemove = useCallback(
    async (item: CatalogItem) => {
      const nextPinned = prefs.pinnedSources.filter((id) => id !== item.id);
      if (item.kind === "channel") {
        await channelsApi.delete(item.id as ChannelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        if (nextPinned.length !== prefs.pinnedSources.length) {
          onPrefsChange({ ...prefs, pinnedSources: nextPinned });
        }
        toast.success(`${item.name} removed`);
      } else {
        const nextEnabled = prefs.widgets.enabledWidgets.filter((id) => id !== item.id);
        const nextOnTicker = prefs.widgets.widgetsOnTicker.filter((id) => id !== item.id);
        onPrefsChange({
          ...prefs,
          widgets: { ...prefs.widgets, enabledWidgets: nextEnabled, widgetsOnTicker: nextOnTicker },
          pinnedSources: nextPinned,
        });
        toast.success(`${item.name} removed`);
      }
    },
    [queryClient, prefs, onPrefsChange],
  );
```

`newString`:
```ts
  const handleRemove = useCallback(
    async (item: CatalogItem) => {
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
```

- [ ] **Step 4: Drop `pinned` and `onTogglePin` from `<CatalogCard>` render call**

Find the `<CatalogCard` JSX in the render section (around lines 195-208 of catalog.tsx). Update both prop usages.

`oldString`:
```ts
              pinned={prefs.pinnedSources.includes(item.id)}
```

`newString`: (delete this entire line)

`oldString`:
```ts
              onTogglePin={handleTogglePin}
```

`newString`: (delete this entire line)

- [ ] **Step 5: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in OnboardingWizard, useChannelActions, useWidgetActions, preferences (the writers we haven't touched yet).

### Task 2.6: Strip `pinnedIds` from `OnboardingWizard.tsx`

**Files:**
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx:259-271`

- [ ] **Step 1: Edit the finish-prefs build**

`oldString`:
```ts
    // Build final prefs
    const widgetIds = [...selectedWidgets];
    const pinnedIds = [...Array.from(selectedChannels), ...widgetIds];

    const nextPrefs: AppPreferences = {
      ...prefs,
      showSetupOnLogin: false,
      widgets: {
        ...prefs.widgets,
        enabledWidgets: widgetIds,
        widgetsOnTicker: widgetIds,
      },
      pinnedSources: pinnedIds,
    };
```

`newString`:
```ts
    // Build final prefs. Sidebar visibility is now derived from
    // enabled state (channels via dashboard.channels, widgets via
    // enabledWidgets) so we no longer write pinnedSources here.
    const widgetIds = [...selectedWidgets];

    const nextPrefs: AppPreferences = {
      ...prefs,
      showSetupOnLogin: false,
      widgets: {
        ...prefs.widgets,
        enabledWidgets: widgetIds,
        widgetsOnTicker: widgetIds,
      },
    };
```

- [ ] **Step 2: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in useChannelActions, useWidgetActions, preferences.

### Task 2.7: Strip pinnedSources cleanup from `useChannelActions.ts`

**Files:**
- Modify: `desktop/src/hooks/useChannelActions.ts:68-87`

- [ ] **Step 1: Edit the delete handler**

`oldString`:
```ts
  const handleDeleteChannel = useCallback(
    async (channelType: ChannelType) => {
      try {
        await channelsApi.delete(channelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        // Remove from pinned sidebar
        setPrefs((prev) => {
          if (!prev.pinnedSources.includes(channelType)) return prev;
          const next = { ...prev, pinnedSources: prev.pinnedSources.filter((id) => id !== channelType) };
          savePrefs(next);
          return next;
        });
        navigate({ to: "/feed" });
        toast.success(`${channelName[channelType] ?? channelType} channel removed`);
      } catch (err) {
        console.error("[Scrollr] Channel delete failed:", err);
        toast.error(`Couldn't remove ${channelName[channelType] ?? channelType} channel`);
      }
    },
    [queryClient, navigate, setPrefs],
  );
```

`newString`:
```ts
  const handleDeleteChannel = useCallback(
    async (channelType: ChannelType) => {
      try {
        await channelsApi.delete(channelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        // Sidebar now derives from dashboard.channels (filtered to
        // enabled), so no preference cleanup is needed here — the
        // dashboard refetch above triggers the sidebar update.
        navigate({ to: "/feed" });
        toast.success(`${channelName[channelType] ?? channelType} channel removed`);
      } catch (err) {
        console.error("[Scrollr] Channel delete failed:", err);
        toast.error(`Couldn't remove ${channelName[channelType] ?? channelType} channel`);
      }
    },
    [queryClient, navigate],
  );
```

- [ ] **Step 2: Drop unused imports**

After removing the `setPrefs` call, the `setPrefs` parameter is unused. The hook signature is `useChannelActions(prefs, setPrefs)`. Both are now unused for `handleDeleteChannel`. Run:

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```

If TypeScript errors with unused parameter warnings, leave the parameters in place (other consumers of this hook still pass them, and they may be needed by future actions in the same file). Confirmed via inspection: `prefs` and `setPrefs` are not currently used by any other function in this file after this edit. Update the signature.

`oldString`:
```ts
export function useChannelActions(
  prefs: AppPreferences,
  setPrefs: React.Dispatch<React.SetStateAction<AppPreferences>>,
): ChannelActions {
```

`newString`:
```ts
// `prefs` and `setPrefs` were used to clean up `pinnedSources` on
// channel delete. With pin-to-sidebar removed, the hook no longer
// needs them — sidebar updates flow from the dashboard refetch.
export function useChannelActions(): ChannelActions {
```

- [ ] **Step 3: Drop now-unused imports**

`oldString`:
```ts
import { savePrefs } from "../preferences";
import type { ChannelType } from "../api/client";
import type { AppPreferences } from "../preferences";
```

`newString`:
```ts
import type { ChannelType } from "../api/client";
```

- [ ] **Step 4: Update the single call site**

Confirmed during planning: only `__root.tsx:235` calls `useChannelActions`. Update it.

`oldString` (in `desktop/src/routes/__root.tsx`):
```ts
  const channelActions = useChannelActions(prefs, setPrefs);
```

`newString`:
```ts
  const channelActions = useChannelActions();
```

`useWidgetActions` at line 236 still passes `(prefs, setPrefs, route.activeItem)` — its signature stays unchanged because its other callbacks still use both. Do not touch line 236.

- [ ] **Step 5: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in useWidgetActions and preferences.

### Task 2.8: Strip pinnedSources cleanup from `useWidgetActions.ts`

**Files:**
- Modify: `desktop/src/hooks/useWidgetActions.ts:34-70`

- [ ] **Step 1: Edit the toggle widget handler**

`oldString`:
```ts
  const handleToggleWidget = useCallback(
    (widgetId: string) => {
      const enabledWidgets = prefs.widgets.enabledWidgets;
      const isEnabled = enabledWidgets.includes(widgetId);
      const nextEnabled = isEnabled
        ? enabledWidgets.filter((id) => id !== widgetId)
        : [...enabledWidgets, widgetId];
      const nextOnTicker = isEnabled
        ? prefs.widgets.widgetsOnTicker.filter((id) => id !== widgetId)
        : [...prefs.widgets.widgetsOnTicker, widgetId];
      const nextPinned = isEnabled
        ? prefs.pinnedSources.filter((id) => id !== widgetId)
        : prefs.pinnedSources;
      const next: AppPreferences = {
        ...prefs,
        widgets: {
          ...prefs.widgets,
          enabledWidgets: nextEnabled,
          widgetsOnTicker: nextOnTicker,
        },
        pinnedSources: nextPinned,
      };
      setPrefs(next);
      savePrefs(next);
```

`newString`:
```ts
  const handleToggleWidget = useCallback(
    (widgetId: string) => {
      const enabledWidgets = prefs.widgets.enabledWidgets;
      const isEnabled = enabledWidgets.includes(widgetId);
      const nextEnabled = isEnabled
        ? enabledWidgets.filter((id) => id !== widgetId)
        : [...enabledWidgets, widgetId];
      const nextOnTicker = isEnabled
        ? prefs.widgets.widgetsOnTicker.filter((id) => id !== widgetId)
        : [...prefs.widgets.widgetsOnTicker, widgetId];
      const next: AppPreferences = {
        ...prefs,
        widgets: {
          ...prefs.widgets,
          enabledWidgets: nextEnabled,
          widgetsOnTicker: nextOnTicker,
        },
      };
      setPrefs(next);
      savePrefs(next);
```

- [ ] **Step 2: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in `preferences.ts` (the field decl + default + reset + load).

### Task 2.9: Drop `pinnedSources` from `preferences.ts`

**Files:**
- Modify: `desktop/src/preferences.ts:380-387, 555, 901, 966`

- [ ] **Step 1: Drop the field declaration**

`oldString`:
```ts
  channelDisplay: ChannelDisplayPrefs;
  /** Channel/widget IDs pinned to the sidebar for quick access. */
  pinnedSources: string[];
  /** Per-channel homepage preview selections (up to 5 group keys). */
```

`newString`:
```ts
  channelDisplay: ChannelDisplayPrefs;
  /** Per-channel homepage preview selections (up to 5 group keys). */
```

- [ ] **Step 2: Drop default value**

Find the `DEFAULT_PREFERENCES` (or similarly named) constant and drop the `pinnedSources: [],` line. Use grep to locate the exact line:

```bash
cd desktop && grep -n "pinnedSources: \[\]" src/preferences.ts
```

Expected: 2 hits (one in the `DEFAULT_PREFERENCES` literal, one in `resetAll`). For each, use Edit to remove the entire line including its trailing comma.

For DEFAULT_PREFERENCES `oldString`:
```ts
  pinnedSources: [],
```
`newString`: (empty — delete the line). Use `replaceAll: false` and verify the diff.

If there's ambiguity between two occurrences, use the surrounding context to disambiguate. Example for DEFAULT_PREFERENCES:

`oldString`:
```ts
  channelDisplay: DEFAULT_CHANNEL_DISPLAY,
  pinnedSources: [],
  homePreview: DEFAULT_HOME_PREVIEW,
```

`newString`:
```ts
  channelDisplay: DEFAULT_CHANNEL_DISPLAY,
  homePreview: DEFAULT_HOME_PREVIEW,
```

- [ ] **Step 3: Drop loadPrefs read**

`oldString`:
```ts
        pinnedSources: Array.isArray(source.pinnedSources) ? source.pinnedSources : [],
```

`newString`: (empty — delete the entire line)

If there's a comma issue, also delete the trailing comma manually after the edit.

- [ ] **Step 4: Drop resetAll write**

Use the same Edit pattern with surrounding context for the `resetAll` case:

```bash
cd desktop && grep -n "pinnedSources" src/preferences.ts
```

Expected: 0 hits after this step.

- [ ] **Step 5: Verify everything compiles**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: clean.

```bash
cd desktop && npx vitest run 2>&1 | tail -10
```
Expected: 154 tests passing (no test references `pinnedSources`; behavior unchanged for ticker/feed/preferences-migration tests).

```bash
cd desktop && npm run build 2>&1 | tail -10
```
Expected: vite build clean.

- [ ] **Step 6: Commit**

```bash
git add desktop/
git commit -m "refactor(sidebar): remove pin-to-sidebar feature

Sidebar visibility is now derived: enabled channels (from
dashboard.channels filtered to enabled === true) plus enabled widgets
(from prefs.widgets.enabledWidgets), sorted via the shared
CANONICAL_ORDER from marketplace.ts.

Removes:
- prefs.pinnedSources field, default, loadPrefs read, resetAll
- Pin/PinOff button block in CatalogCard
- handleTogglePin in catalog.tsx
- pinnedSources writes in handleAdd, handleRemove
- pinnedIds in OnboardingWizard finish-prefs
- pinnedSources cleanup in useChannelActions, useWidgetActions

Migration: stale 'pinnedSources' keys in users' saved JSON are
silently ignored. Existing users with enabled-but-unpinned channels
will see those channels appear in the sidebar after upgrade — the
intended new behavior. The 'visible' flag on Channel is intentionally
NOT consulted for sidebar visibility (visibility is a feed-level
filter, not a navigation gate).

The unrelated ticker-edge widget pin (prefs.widgets.pinnedWidgets,
useWidgetPin, TickerPinSection) is untouched."
```

---

## Phase 3 — Item 6: Ticker chip click → external URL

### Task 3.1: Create `chipUrl.ts` utility with TDD

**Files:**
- Create: `desktop/src/utils/chipUrl.ts`
- Create: `desktop/src/utils/chipUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/src/utils/chipUrl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildYahooLeagueUrl,
  buildYahooPlayerUrl,
  chipUrlForFinance,
  chipUrlForSports,
  chipUrlForRss,
} from "./chipUrl";

describe("buildYahooLeagueUrl", () => {
  it("constructs a football league URL from an NFL league_key", () => {
    expect(buildYahooLeagueUrl("nfl.l.420")).toBe(
      "https://football.fantasysports.yahoo.com/nfl/420",
    );
  });

  it("constructs a basketball league URL from an NBA league_key", () => {
    expect(buildYahooLeagueUrl("nba.l.12345")).toBe(
      "https://basketball.fantasysports.yahoo.com/nba/12345",
    );
  });

  it("constructs a hockey league URL from an NHL league_key", () => {
    expect(buildYahooLeagueUrl("nhl.l.78")).toBe(
      "https://hockey.fantasysports.yahoo.com/nhl/78",
    );
  });

  it("constructs a baseball league URL from an MLB league_key", () => {
    expect(buildYahooLeagueUrl("mlb.l.999")).toBe(
      "https://baseball.fantasysports.yahoo.com/mlb/999",
    );
  });

  it("returns undefined for an unrecognized game_code prefix", () => {
    expect(buildYahooLeagueUrl("xyz.l.1")).toBeUndefined();
  });

  it("returns undefined when league_key cannot be parsed", () => {
    expect(buildYahooLeagueUrl("not-a-key")).toBeUndefined();
  });
});

describe("buildYahooPlayerUrl", () => {
  it("constructs an NFL player URL from a player_key", () => {
    expect(buildYahooPlayerUrl("nfl.p.30977")).toBe(
      "https://sports.yahoo.com/nfl/players/30977/",
    );
  });

  it("constructs an MLB player URL", () => {
    expect(buildYahooPlayerUrl("mlb.p.10001")).toBe(
      "https://sports.yahoo.com/mlb/players/10001/",
    );
  });

  it("returns undefined when player_key cannot be parsed", () => {
    expect(buildYahooPlayerUrl("nfl-p-30977")).toBeUndefined();
  });

  it("returns undefined for an unrecognized game_code prefix", () => {
    expect(buildYahooPlayerUrl("xyz.p.99")).toBeUndefined();
  });
});

describe("chipUrlForFinance", () => {
  it("returns the trade.link when populated", () => {
    expect(chipUrlForFinance({ link: "https://www.google.com/finance/quote/AAPL:NASDAQ" } as never)).toBe(
      "https://www.google.com/finance/quote/AAPL:NASDAQ",
    );
  });

  it("returns undefined when link is empty", () => {
    expect(chipUrlForFinance({ link: "" } as never)).toBeUndefined();
  });

  it("returns undefined when link is missing", () => {
    expect(chipUrlForFinance({} as never)).toBeUndefined();
  });
});

describe("chipUrlForSports", () => {
  it("returns the game.link when populated", () => {
    expect(chipUrlForSports({ link: "https://www.espn.com/nfl/game/_/gameId/123" } as never)).toBe(
      "https://www.espn.com/nfl/game/_/gameId/123",
    );
  });

  it("returns undefined when link is empty", () => {
    expect(chipUrlForSports({ link: "" } as never)).toBeUndefined();
  });
});

describe("chipUrlForRss", () => {
  it("returns the item.link when populated", () => {
    expect(chipUrlForRss({ link: "https://example.com/article/1" } as never)).toBe(
      "https://example.com/article/1",
    );
  });

  it("returns undefined when link is empty", () => {
    expect(chipUrlForRss({ link: "" } as never)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd desktop && npx vitest run src/utils/chipUrl.test.ts 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './chipUrl'` or `chipUrl.ts not found`.

- [ ] **Step 3: Write the implementation**

Create `desktop/src/utils/chipUrl.ts`:

```ts
/**
 * URL builders for ticker chip clicks. The handler in `App.tsx` routes
 * a click to the OS shell when these helpers return a string, and
 * falls back to opening the desktop app's main window otherwise.
 *
 * Trade/Game/RssItem already carry a server-populated `link` field —
 * these helpers just unwrap it. Fantasy chips construct URLs from the
 * Yahoo `league_key` / `player_key` namespacing scheme since neither
 * the league nor the player URL is currently surfaced through the
 * Go layer of the fantasy channel.
 *
 * Yahoo Fantasy URL format:
 *   league: https://{sport}.fantasysports.yahoo.com/{game_code}/{league_id}
 *   player: https://sports.yahoo.com/{game_code}/players/{player_id}/
 *
 * `league_key` shape: "{game_code}.l.{league_id}" (e.g. "nfl.l.420").
 * `player_key` shape: "{game_code}.p.{player_id}" (e.g. "nfl.p.30977").
 */

import type { Trade, Game, RssItem } from "../types";

/** Yahoo's per-sport subdomain prefix on fantasysports.yahoo.com. */
const SPORT_PREFIX: Record<string, string> = {
  nfl: "football",
  nba: "basketball",
  nhl: "hockey",
  mlb: "baseball",
};

export function buildYahooLeagueUrl(leagueKey: string): string | undefined {
  const parts = leagueKey.split(".l.");
  if (parts.length !== 2) return undefined;
  const [gameCode, leagueId] = parts;
  const prefix = SPORT_PREFIX[gameCode];
  if (!prefix) return undefined;
  return `https://${prefix}.fantasysports.yahoo.com/${gameCode}/${leagueId}`;
}

export function buildYahooPlayerUrl(playerKey: string): string | undefined {
  const parts = playerKey.split(".p.");
  if (parts.length !== 2) return undefined;
  const [gameCode, playerId] = parts;
  if (!SPORT_PREFIX[gameCode]) return undefined;
  return `https://sports.yahoo.com/${gameCode}/players/${playerId}/`;
}

export function chipUrlForFinance(trade: Trade): string | undefined {
  return trade.link && trade.link.length > 0 ? trade.link : undefined;
}

export function chipUrlForSports(game: Game): string | undefined {
  return game.link && game.link.length > 0 ? game.link : undefined;
}

export function chipUrlForRss(item: RssItem): string | undefined {
  return item.link && item.link.length > 0 ? item.link : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd desktop && npx vitest run src/utils/chipUrl.test.ts 2>&1 | tail -20
```
Expected: PASS — all tests in chipUrl.test.ts pass.

- [ ] **Step 5: Run the full test suite to verify no regressions**

```bash
cd desktop && npx vitest run 2>&1 | tail -10
```
Expected: all 154 (now 154+12 = 166) tests passing.

### Task 3.2: Wire `onChipClick` to receive an optional URL

**Files:**
- Modify: `desktop/src/components/ScrollrTicker.tsx:40, 168, 206, 221, 252, 275, 300, 453`

- [ ] **Step 1: Extend the prop signature**

`oldString` (in `desktop/src/components/ScrollrTicker.tsx`):
```ts
  onChipClick?: (channelType: string, itemId: string | number) => void;
```

`newString`:
```ts
  /** Click handler. The optional `url` argument is set when the
   * underlying chip has an external destination (article link, game
   * page, etc.). When undefined, the consumer should fall back to
   * opening the in-app channel page. */
  onChipClick?: (channelType: string, itemId: string | number, url?: string) => void;
```

- [ ] **Step 2: Add chipUrl imports**

Find the imports section near the top of `ScrollrTicker.tsx`. Add:

`oldString` (the line referencing `types`):
```ts
import type { ... } from "../types";
```

(Use the existing types import; just add chipUrl alongside.)

Add a new import line:
```ts
import { buildYahooLeagueUrl, buildYahooPlayerUrl, chipUrlForFinance, chipUrlForSports, chipUrlForRss } from "../utils/chipUrl";
```

- [ ] **Step 3: Update each chip wrap site to compute and pass URL**

There are six wrap sites in `ScrollrTicker.tsx`. Each currently calls `onChipClick?.(...)` with two arguments. Update each to pass a third URL argument.

For the `TradeChip` site (line 252 area):

`oldString`:
```ts
            onClick={() => onChipClick?.("finance", trade.symbol)}
```

`newString`:
```ts
            onClick={() => onChipClick?.("finance", trade.symbol, chipUrlForFinance(trade))}
```

For the `GameChip` site (line 275 area):

`oldString`:
```ts
            onClick={() => onChipClick?.("sports", game.id)}
```

`newString`:
```ts
            onClick={() => onChipClick?.("sports", game.id, chipUrlForSports(game))}
```

For the `RssChip` site (line 300 area):

`oldString`:
```ts
            onClick={() => onChipClick?.("rss", item.id)}
```

`newString`:
```ts
            onClick={() => onChipClick?.("rss", item.id, chipUrlForRss(item))}
```

For the `FantasyStatChip` site (line 221 area):

`oldString`:
```ts
            onClick={() => onChipClick?.("fantasy", league.league_key)}
```

`newString`:
```ts
            onClick={() => onChipClick?.("fantasy", league.league_key, buildYahooLeagueUrl(league.league_key))}
```

For the `FollowedPlayerChip` site (line 206 area):

`oldString`:
```ts
                onClick={() => onChipClick?.("fantasy", playerKey)}
```

`newString`:
```ts
                onClick={() => onChipClick?.("fantasy", playerKey, buildYahooPlayerUrl(playerKey))}
```

(Confirmed during planning: the wrap-site loop iterates `fantasyPrefs.followedPlayerKeys` and only has `playerKey` in scope. We extract `game_code` from the key prefix inside `buildYahooPlayerUrl` itself, avoiding the parent-league lookup.)

For the `ConsolidatedChip` sites (lines 168 and 453 — widget chips):

`oldString` (each occurrence — use replaceAll if both are identical, otherwise use surrounding context):
```ts
            onClick={() => onChipClick?.(wt, wt)}
```

`newString`:
```ts
            // Widget chips don't have a meaningful external URL —
            // omit the third argument so handleChipClick falls back
            // to opening the desktop app on the widget's page.
            onClick={() => onChipClick?.(wt, wt)}
```

(Adding only a comment for documentation; the call signature stays two-arg. The optional third arg will simply be undefined.)

- [ ] **Step 4: Verify**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: errors in App.tsx (the consumer hasn't been updated) or clean.

### Task 3.3: Update `handleChipClick` in `App.tsx`

**Files:**
- Modify: `desktop/src/App.tsx:344-352`

- [ ] **Step 1: Add the shell-open import**

Find the existing imports at the top of `App.tsx`. Add or extend:

If `@tauri-apps/plugin-shell` is not yet imported in this file, add:
```ts
import { open } from "@tauri-apps/plugin-shell";
```

(Confirm via `grep -n "tauri-apps/plugin-shell" desktop/src/App.tsx`. If already present from another import, augment that import.)

- [ ] **Step 2: Replace the handler**

`oldString`:
```ts
  // ── Chip click → open app window on that channel ───────────────

  const handleChipClick = useCallback(
    (channelType: string, _itemId: string | number) => {
      savePref("activeItem", channelType);
      invoke("show_app_window").catch(() => {});
    },
    [],
  );
```

`newString`:
```ts
  // ── Chip click → open external URL (or fall back to app) ───────

  const handleChipClick = useCallback(
    (channelType: string, _itemId: string | number, url?: string) => {
      if (url) {
        open(url).catch((err) => {
          console.error("[Scrollr] Failed to open external URL:", err);
        });
        return;
      }
      // No URL (widget chip, missing data) — fall back to opening
      // the desktop app on the relevant channel/widget page.
      savePref("activeItem", channelType);
      invoke("show_app_window").catch(() => {});
    },
    [],
  );
```

- [ ] **Step 3: Verify everything compiles**

```bash
cd desktop && npx tsc --noEmit 2>&1 | head -20
```
Expected: clean.

- [ ] **Step 4: Run full test suite**

```bash
cd desktop && npx vitest run 2>&1 | tail -10
```
Expected: all tests passing.

- [ ] **Step 5: Run a full build**

```bash
cd desktop && npm run build 2>&1 | tail -10
```
Expected: vite build + tsc clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/
git commit -m "feat(ticker): chip click opens external URL via shell.open

Trade, Game, and RssItem already carry a server-populated 'link' field
(Google Finance for finance, api-sports.io for sports, the article URL
for RSS). Fantasy league and followed-player chips construct Yahoo
fantasy URLs from the league_key/player_key namespacing scheme.
Widget chips (clock/weather/sysmon/uptime/github) keep the existing
'open app' behavior since they have no meaningful external URL.

Adds:
- desktop/src/utils/chipUrl.ts: URL builders + Yahoo helpers
- desktop/src/utils/chipUrl.test.ts: 12 unit tests covering the
  Yahoo subdomain mapping and key-parsing edge cases

Modifies:
- ScrollrTicker.tsx: extends onChipClick signature with optional URL
  third argument, computes URL at each chip wrap site
- App.tsx: branches handleChipClick on URL presence; uses
  @tauri-apps/plugin-shell's open() for external URLs and falls back
  to invoke('show_app_window') for the widget case"
```

---

## Phase 4 — Final verification + push

### Task 4.1: Run the full verification suite

- [ ] **Step 1: Marketing site lint+format (sanity check, untouched in this PR)**

```bash
cd myscrollr.com && npm run check 2>&1 | tail -5
```
Expected: clean (we didn't touch myscrollr.com).

- [ ] **Step 2: Desktop typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | tail -10
```
Expected: empty output.

- [ ] **Step 3: Desktop tests**

```bash
cd desktop && npx vitest run 2>&1 | tail -10
```
Expected: all 154+12 = 166 tests passing.

- [ ] **Step 4: Desktop build**

```bash
cd desktop && npm run build 2>&1 | tail -10
```
Expected: vite + tsc clean.

- [ ] **Step 5: Rust check**

```bash
cd desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```
Expected: clean (we didn't touch Rust, but verify no incidental drift).

### Task 4.2: Push branch and open PR

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin feature/batch-a-quick-fixes 2>&1 | tail -5
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "fix(desktop): updater seed + remove pin-to-sidebar + ticker chip external URLs" --body "$(cat <<'EOF'
## Summary

Three independent quick fixes from the Batch A spec at \`docs/superpowers/specs/2026-04-28-batch-a-quick-fixes-design.md\`:

1. **Updater false-positive on Windows** — seed \`KEY_LAST_UPDATE_DATE\` on first version-match check so MSI users stop seeing 'update available' against the same version they're running.
2. **Pin-to-sidebar removal** — sidebar now derives from enabled channels (\`dashboard.channels\` filtered to \`enabled\`) + enabled widgets (\`prefs.widgets.enabledWidgets\`), sorted via the shared \`CANONICAL_ORDER\`. The Pin/Unpin button on catalog cards is gone.
3. **Ticker chip click → external URL** — RSS chips open the article, finance chips open Google Finance, sports chips open ESPN, fantasy chips open Yahoo. Widget chips keep their current 'open app' behavior.

Three logical commits, one per item, reviewable in isolation. Squash-merge as one batch.

## Verification

- \`npm run check\` clean (marketing site untouched)
- \`npx tsc --noEmit\` clean (desktop)
- \`npx vitest run\` 166 tests passing (was 154; +12 from \`chipUrl.test.ts\`)
- \`npm run build\` clean (desktop)
- \`cargo check\` clean (Rust untouched)

## Migration notes

- Existing users will have a stale \`pinnedSources\` key in their saved JSON. It's silently ignored. Sidebar starts showing every enabled channel/widget after upgrade — the intended new behavior.
- Windows users who previously saw 'update available' on every check will see 'up-to-date' on their next \`Check for updates\` once the seed step runs.

## Risks

- The updater seed assumes the user's installed build matches the latest GitHub release \`pub_date\`. A user who manually downloads an OLDER MSI will silently miss the patch they're behind on. Documented in the spec; acceptable.
- The Yahoo URL construction is deterministic for the four supported sports (nfl/nba/nhl/mlb). For an unrecognized \`game_code\`, the URL falls back to undefined and the chip opens the desktop app instead.

## Related

- Spec: \`docs/superpowers/specs/2026-04-28-batch-a-quick-fixes-design.md\`
- Plan: \`docs/superpowers/plans/2026-04-28-batch-a-quick-fixes.md\`
- Next: Batch B (\`/users/me/overview\` API + client refactor), then Batch C (settings IA redesign + website support page).
EOF
)" 2>&1 | tail -3
```

Expected: prints the PR URL.

---

## Out of scope (deferred to Batch B / C)

- Surfacing Yahoo's native \`data.url\` and per-player \`url\` through the Go layer (defer to Batch B if/when client-side construction proves insufficient).
- Settings IA redesign (Batch C).
- \`GET /users/me/overview\` endpoint + both clients (Batch B).
- Website \`/support\` route and contact form (Batch C).

## Acceptance criteria

- All four verification steps in Task 4.1 pass.
- PR opens cleanly with three logical commits visible in the diff view.
- Manual smoke test (post-merge, on a dev build) confirms:
  - Catalog Add → channel appears in sidebar without a Pin step.
  - Catalog Remove → channel disappears from sidebar.
  - Onboarding finishes → enabled picks appear in sidebar.
  - Each chip type clicks open the right URL: finance → Google Finance, sports → ESPN, RSS → article, fantasy league → Yahoo league page, fantasy player → Yahoo player page.
  - Widget chip click → main app window appears.
  - "Check for updates" on a v1.0.3 dev build returns "up-to-date" and writes \`KEY_LAST_UPDATE_DATE\`.
- Windows MSI verification of the updater fix happens after merge with an MSI test build.
