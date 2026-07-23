# Setup Wizard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix bugs and add tier awareness to the desktop app's onboarding wizard.

**Architecture:** Five independent fixes touching the onboarding wizard components and the weather widget. The wizard receives the user's tier as a prop, computes locked channels and item limits from `tierLimits.ts`, and enforces them in the UI. Sports toggles on `league.name` instead of `league.id`. Weather replaces browser geolocation with IP-based API.

**Tech Stack:** React 19, TypeScript, Tailwind v4, TanStack Query, Tauri v2, clsx, lucide-react, sonner (toasts)

---

## File Structure

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `desktop/src/components/onboarding/OnboardingWizard.tsx` | Wizard orchestrator — state, navigation, provisioning | Modify |
| `desktop/src/components/onboarding/StepChannels.tsx` | Channel picker with lock overlays | Modify |
| `desktop/src/components/onboarding/StepConfigureFinance.tsx` | Finance symbol picker with tier limits | Modify |
| `desktop/src/components/onboarding/StepConfigureSports.tsx` | Sports league picker — fix ID bug, add limits | Modify |
| `desktop/src/components/onboarding/StepConfigureRss.tsx` | RSS feed picker with tier limits | Modify |
| `desktop/src/components/onboarding/WizardShell.tsx` | No changes needed | — |
| `desktop/src/routes/__root.tsx` | Pass `tier` prop to wizard | Modify |
| `desktop/src/widgets/weather/FeedTab.tsx` | Replace geolocation with IP-based API | Modify |

### Code Style Reminders (desktop/)

- Semicolons: **Yes**
- Quotes: **Double**
- Path aliases: **No** — use relative `../` imports
- Conditional classes: `clsx`
- Component exports: `export default function ComponentName()`
- No formatter/linter configured — match existing patterns exactly
- `import type` for type-only imports (`verbatimModuleSyntax: true`)

---

### Task 1: Fix Sports League IDs

**Files:**
- Modify: `desktop/src/components/onboarding/StepConfigureSports.tsx` (entire file, 55 lines)
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx:157-163` (toggleLeague callback)

**Context:** The wizard currently toggles on `league.id` (numeric strings like `"1"`, `"2"`) from `curated-picks.ts`. The backend expects league **name strings** (`"NFL"`, `"NBA"`, etc.). NBA and Champions League both have `id: "2"`, causing collisions. The fix is to toggle on `league.name` instead.

- [ ] **Step 1: Update StepConfigureSports to toggle on league.name**

In `desktop/src/components/onboarding/StepConfigureSports.tsx`, change three occurrences of `league.id` to `league.name`:

Line 22: change `selected.has(league.id)` → `selected.has(league.name)`
Line 25: change `key={`${league.id}-${league.name}`}` → `key={league.name}`
Line 26: change `onToggle(league.id)` → `onToggle(league.name)`

The full updated file:

```tsx
import clsx from "clsx";
import { POPULAR_LEAGUES } from "./curated-picks";

interface StepConfigureSportsProps {
  selected: Set<string>;
  onToggle: (leagueName: string) => void;
}

export default function StepConfigureSports({ selected, onToggle }: StepConfigureSportsProps) {
  const grouped = POPULAR_LEAGUES.reduce<Record<string, typeof POPULAR_LEAGUES>>((acc, l) => {
    (acc[l.sport] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([sport, leagues]) => (
        <div key={sport}>
          <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{sport}</h3>
          <div className="flex flex-col gap-1.5">
            {leagues.map((league) => {
              const active = selected.has(league.name);
              return (
                <button
                  key={league.name}
                  onClick={() => onToggle(league.name)}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left",
                    active
                      ? "border-accent bg-accent/5"
                      : "border-edge bg-surface-2/50 hover:border-fg-4",
                  )}
                >
                  <div
                    className={clsx(
                      "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                      active ? "border-accent bg-accent" : "border-fg-4",
                    )}
                  >
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-fg">{league.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Update toggleLeague param name in OnboardingWizard**

In `desktop/src/components/onboarding/OnboardingWizard.tsx`, line 157, update the parameter name from `id` to `name` for clarity:

```tsx
  const toggleLeague = useCallback((name: string) => {
    setSportsLeagues((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);
```

This is cosmetic — the function already works with strings. The `sportsLeagues` Set now contains name strings like `"NFL"` instead of `"1"`.

- [ ] **Step 3: Build verification**

Run: `npm run build` from `desktop/`
Expected: `vite build` succeeds, `tsc --noEmit` succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/onboarding/StepConfigureSports.tsx desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "fix(wizard): use league names instead of numeric IDs for sports selection"
```

---

### Task 2: Wizard Completion — Auto-Disable + Default Checkbox

**Files:**
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx:52,214-238`

**Context:** Currently, finishing the wizard does NOT set `showSetupOnLogin: false`, so the wizard shows on every login. The "Don't show this again" checkbox on the Welcome Screen defaults to unchecked. Fix both.

- [ ] **Step 1: Default "Don't show this again" to checked**

In `desktop/src/components/onboarding/OnboardingWizard.tsx`, line 52, change:

```tsx
  const [dontShow, setDontShow] = useState(false);
```

to:

```tsx
  const [dontShow, setDontShow] = useState(true);
```

- [ ] **Step 2: Set showSetupOnLogin to false in finish()**

In `desktop/src/components/onboarding/OnboardingWizard.tsx`, inside the `finish` function (around line 226), add `showSetupOnLogin: false` to `nextPrefs`:

Change the `nextPrefs` construction from:

```tsx
    const nextPrefs: AppPreferences = {
      ...prefs,
      widgets: {
        ...prefs.widgets,
        enabledWidgets: widgetIds,
        widgetsOnTicker: widgetIds,
      },
      pinnedSources: pinnedIds,
    };
```

to:

```tsx
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

- [ ] **Step 3: Build verification**

Run: `npm run build` from `desktop/`
Expected: Succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "fix(wizard): auto-disable wizard on completion, default checkbox to checked"
```

---

### Task 3: Back Button Desync Fix

**Files:**
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx:136-138`

**Context:** The step array is rebuilt from `selectedChannels` on every render. If the user goes back and changes channel selections, `stepIndex` may exceed the new step array length. Fix by clamping the effective step index.

- [ ] **Step 1: Clamp stepIndex to valid bounds**

In `desktop/src/components/onboarding/OnboardingWizard.tsx`, after line 136 where `steps` is computed, clamp `stepIndex`:

Change lines 136-138 from:

```tsx
  const steps = buildSteps(selectedChannels);
  const currentStep = steps[stepIndex];
  const totalSteps = steps.length;
```

to:

```tsx
  const steps = buildSteps(selectedChannels);
  const effectiveIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[effectiveIndex];
  const totalSteps = steps.length;
```

- [ ] **Step 2: Use effectiveIndex throughout the component**

Replace all remaining references to `stepIndex` in the render/navigation logic with `effectiveIndex`:

In `handleNext` (around line 243-263):
- Line 246: `const step = steps[stepIndex]` → `const step = steps[effectiveIndex]`
- Line 256: `if (stepIndex >= steps.length - 1)` → `if (effectiveIndex >= steps.length - 1)`

In `handleSkip` (around line 271-278):
- Line 272: `if (stepIndex >= steps.length - 1)` → `if (effectiveIndex >= steps.length - 1)`

In the JSX return (around line 362-376):
- Line 362: `const isLastStep = stepIndex >= steps.length - 1` → `const isLastStep = effectiveIndex >= steps.length - 1`
- Line 366: `stepIndex={stepIndex}` → `stepIndex={effectiveIndex}`
- Line 370: `showBack={stepIndex > 0}` → `showBack={effectiveIndex > 0}`

In `handleBack`:
- Line 267: Keep `setStepIndex((i) => i - 1)` as-is — this correctly decrements the raw state value.

In `handleNext`:
- Line 261: Keep `setStepIndex((i) => i + 1)` as-is.

In `handleSkip`:
- Line 277: Keep `setStepIndex((i) => i + 1)` as-is.

The state setter always operates on the raw `stepIndex`, but all reads go through `effectiveIndex` which is clamped. If the step array shrinks (channel removed), `effectiveIndex` clamps down automatically on the next render.

- [ ] **Step 3: Build verification**

Run: `npm run build` from `desktop/`
Expected: Succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "fix(wizard): clamp step index to prevent desync when channels change"
```

---

### Task 4: Tier-Dependent Channel Picker (StepChannels)

**Files:**
- Modify: `desktop/src/components/onboarding/StepChannels.tsx` (entire file, 59 lines)

**Context:** The channel picker currently shows all 4 channels as selectable. Channels where the user's tier limit is 0 should show a lock overlay with a tier badge and be non-selectable. The component needs `lockedChannels` and `minTierLabels` props.

- [ ] **Step 1: Update StepChannels with lock overlay**

Replace the entire file `desktop/src/components/onboarding/StepChannels.tsx`:

```tsx
import { TrendingUp, Trophy, Rss, Star, Lock } from "lucide-react";
import clsx from "clsx";
import type { ChannelType } from "../../api/client";

const CHANNEL_OPTIONS: { id: ChannelType; name: string; description: string; icon: typeof TrendingUp; hex: string }[] = [
  { id: "finance", name: "Finance", description: "Stock prices and crypto", icon: TrendingUp, hex: "#22c55e" },
  { id: "sports", name: "Sports", description: "Live scores and standings", icon: Trophy, hex: "#3b82f6" },
  { id: "rss", name: "RSS", description: "News and blog feeds", icon: Rss, hex: "#f97316" },
  { id: "fantasy", name: "Fantasy", description: "Yahoo Fantasy leagues", icon: Star, hex: "#a855f7" },
];

interface StepChannelsProps {
  selected: Set<ChannelType>;
  onToggle: (id: ChannelType) => void;
  /** Channels that are locked for the current tier (limit is 0). */
  lockedChannels: Set<ChannelType>;
  /** Minimum tier label needed to unlock each locked channel (e.g., "Uplink"). */
  minTierLabels: Record<string, string>;
}

export default function StepChannels({ selected, onToggle, lockedChannels, minTierLabels }: StepChannelsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CHANNEL_OPTIONS.map((ch) => {
        const Icon = ch.icon;
        const locked = lockedChannels.has(ch.id);
        const active = !locked && selected.has(ch.id);
        return (
          <button
            key={ch.id}
            onClick={() => !locked && onToggle(ch.id)}
            disabled={locked}
            className={clsx(
              "relative flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all",
              locked
                ? "border-edge bg-surface-2/30 opacity-50 cursor-not-allowed"
                : active
                  ? "border-accent bg-accent/5"
                  : "border-edge hover:border-fg-4 bg-surface-2/50",
            )}
          >
            {locked && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-fg-4/10">
                <Lock size={10} className="text-fg-4" />
                <span className="text-[9px] font-medium text-fg-4">
                  {minTierLabels[ch.id] ?? "Upgrade"}
                </span>
              </div>
            )}
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${ch.hex}15` }}
            >
              <Icon size={20} style={{ color: locked ? "var(--fg-4)" : ch.hex }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-fg">{ch.name}</p>
              <p className="text-xs text-fg-4 mt-0.5">{ch.description}</p>
            </div>
            <div className={clsx(
              "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
              active ? "bg-accent" : "bg-transparent",
            )}>
              {active && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build verification**

Run: `npm run build` from `desktop/`
Expected: Build will **fail** because `OnboardingWizard.tsx` doesn't pass the new props yet. That's expected — Task 6 wires everything together.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/onboarding/StepChannels.tsx
git commit -m "feat(wizard): add lock overlay for tier-restricted channels"
```

---

### Task 5: Tier-Dependent Configure Steps (Finance, Sports, RSS)

**Files:**
- Modify: `desktop/src/components/onboarding/StepConfigureFinance.tsx` (entire file, 50 lines)
- Modify: `desktop/src/components/onboarding/StepConfigureSports.tsx` (full rewrite — supersedes Task 1's version, includes both the name-based fix AND maxItems)
- Modify: `desktop/src/components/onboarding/StepConfigureRss.tsx` (entire file, 55 lines)

**Context:** Each configure step needs a `maxItems` prop. When selections reach the limit, remaining items are disabled. A counter shows `"3 / 5 selected"` (or `"3 selected"` if unlimited). At the limit, the counter turns amber with an upgrade hint.

**Dependency note:** The `StepConfigureSports.tsx` file here includes the league-name fix from Task 1. If executing sequentially, Task 1's commit touches this file first, and Task 5 fully replaces it. If executing Task 5 standalone, it still includes the league-name fix.

- [ ] **Step 1: Update StepConfigureFinance with maxItems**

Replace `desktop/src/components/onboarding/StepConfigureFinance.tsx`:

```tsx
import clsx from "clsx";
import { POPULAR_STOCKS, POPULAR_CRYPTO } from "./curated-picks";
import type { StockPick } from "./curated-picks";

interface StepConfigureFinanceProps {
  selected: Set<string>;
  onToggle: (symbol: string) => void;
  /** Maximum selectable items. undefined = unlimited. */
  maxItems?: number;
}

function SymbolGrid({ items, selected, onToggle, label, atLimit }: {
  items: StockPick[];
  selected: Set<string>;
  onToggle: (s: string) => void;
  label: string;
  atLimit: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{label}</h3>
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const active = selected.has(item.symbol);
          const disabled = !active && atLimit;
          return (
            <button
              key={item.symbol}
              onClick={() => !disabled && onToggle(item.symbol)}
              disabled={disabled}
              className={clsx(
                "px-3 py-2 rounded-lg border text-center transition-all",
                disabled
                  ? "border-edge bg-surface-2/30 opacity-40 cursor-not-allowed"
                  : active
                    ? "border-accent bg-accent/5 text-fg"
                    : "border-edge bg-surface-2/50 text-fg-3 hover:border-fg-4",
              )}
            >
              <p className="text-xs font-mono font-medium">{item.symbol}</p>
              <p className="text-[10px] text-fg-4 mt-0.5 truncate">{item.name}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function StepConfigureFinance({ selected, onToggle, maxItems }: StepConfigureFinanceProps) {
  const atLimit = maxItems !== undefined && selected.size >= maxItems;

  return (
    <div className="flex flex-col gap-5">
      {/* Counter */}
      <div className={clsx("text-xs font-medium", atLimit ? "text-amber-400" : "text-fg-4")}>
        {maxItems !== undefined ? `${selected.size} / ${maxItems} selected` : `${selected.size} selected`}
        {atLimit && (
          <span className="ml-2 text-[10px] text-amber-400/80">
            Free tier limit reached — upgrade for more
          </span>
        )}
      </div>

      <SymbolGrid items={POPULAR_STOCKS} selected={selected} onToggle={onToggle} label="Popular Stocks" atLimit={atLimit} />
      <SymbolGrid items={POPULAR_CRYPTO} selected={selected} onToggle={onToggle} label="Crypto" atLimit={atLimit} />
    </div>
  );
}
```

- [ ] **Step 2: Update StepConfigureSports with maxItems**

Replace `desktop/src/components/onboarding/StepConfigureSports.tsx` (builds on Task 1's name-based fix):

```tsx
import clsx from "clsx";
import { POPULAR_LEAGUES } from "./curated-picks";

interface StepConfigureSportsProps {
  selected: Set<string>;
  onToggle: (leagueName: string) => void;
  /** Maximum selectable leagues. undefined = unlimited. */
  maxItems?: number;
}

export default function StepConfigureSports({ selected, onToggle, maxItems }: StepConfigureSportsProps) {
  const atLimit = maxItems !== undefined && selected.size >= maxItems;

  const grouped = POPULAR_LEAGUES.reduce<Record<string, typeof POPULAR_LEAGUES>>((acc, l) => {
    (acc[l.sport] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {/* Counter */}
      <div className={clsx("text-xs font-medium", atLimit ? "text-amber-400" : "text-fg-4")}>
        {maxItems !== undefined ? `${selected.size} / ${maxItems} selected` : `${selected.size} selected`}
        {atLimit && (
          <span className="ml-2 text-[10px] text-amber-400/80">
            Free tier limit reached — upgrade for more
          </span>
        )}
      </div>

      {Object.entries(grouped).map(([sport, leagues]) => (
        <div key={sport}>
          <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{sport}</h3>
          <div className="flex flex-col gap-1.5">
            {leagues.map((league) => {
              const active = selected.has(league.name);
              const disabled = !active && atLimit;
              return (
                <button
                  key={league.name}
                  onClick={() => !disabled && onToggle(league.name)}
                  disabled={disabled}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left",
                    disabled
                      ? "border-edge bg-surface-2/30 opacity-40 cursor-not-allowed"
                      : active
                        ? "border-accent bg-accent/5"
                        : "border-edge bg-surface-2/50 hover:border-fg-4",
                  )}
                >
                  <div
                    className={clsx(
                      "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                      disabled
                        ? "border-fg-5"
                        : active ? "border-accent bg-accent" : "border-fg-4",
                    )}
                  >
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className={clsx("text-sm", disabled ? "text-fg-4" : "text-fg")}>{league.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update StepConfigureRss with maxItems**

Replace `desktop/src/components/onboarding/StepConfigureRss.tsx`:

```tsx
import clsx from "clsx";
import { RECOMMENDED_FEEDS } from "./curated-picks";

interface StepConfigureRssProps {
  selected: Set<string>;
  onToggle: (url: string) => void;
  /** Maximum selectable feeds. undefined = unlimited. */
  maxItems?: number;
}

export default function StepConfigureRss({ selected, onToggle, maxItems }: StepConfigureRssProps) {
  const atLimit = maxItems !== undefined && selected.size >= maxItems;

  const grouped = RECOMMENDED_FEEDS.reduce<Record<string, typeof RECOMMENDED_FEEDS>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {/* Counter */}
      <div className={clsx("text-xs font-medium", atLimit ? "text-amber-400" : "text-fg-4")}>
        {maxItems !== undefined ? `${selected.size} / ${maxItems} selected` : `${selected.size} selected`}
        {atLimit && (
          <span className="ml-2 text-[10px] text-amber-400/80">
            Free tier limit reached — upgrade for more
          </span>
        )}
      </div>

      {Object.entries(grouped).map(([category, feeds]) => (
        <div key={category}>
          <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{category}</h3>
          <div className="flex flex-col gap-1.5">
            {feeds.map((feed) => {
              const active = selected.has(feed.url);
              const disabled = !active && atLimit;
              return (
                <button
                  key={feed.url}
                  onClick={() => !disabled && onToggle(feed.url)}
                  disabled={disabled}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left",
                    disabled
                      ? "border-edge bg-surface-2/30 opacity-40 cursor-not-allowed"
                      : active
                        ? "border-accent bg-accent/5"
                        : "border-edge bg-surface-2/50 hover:border-fg-4",
                  )}
                >
                  <div
                    className={clsx(
                      "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                      disabled
                        ? "border-fg-5"
                        : active ? "border-accent bg-accent" : "border-fg-4",
                    )}
                  >
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className={clsx("text-sm", disabled ? "text-fg-4" : "text-fg")}>{feed.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Build verification**

Run: `npm run build` from `desktop/`
Expected: Build may fail because `OnboardingWizard.tsx` doesn't pass `maxItems` yet. That's expected — Task 6 wires everything together.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/onboarding/StepConfigureFinance.tsx desktop/src/components/onboarding/StepConfigureSports.tsx desktop/src/components/onboarding/StepConfigureRss.tsx
git commit -m "feat(wizard): add tier limit enforcement to configure steps"
```

---

### Task 6: Wire Tier into OnboardingWizard + __root.tsx

**Files:**
- Modify: `desktop/src/components/onboarding/OnboardingWizard.tsx` (significant changes)
- Modify: `desktop/src/routes/__root.tsx:532`

**Context:** This task connects all the pieces: passes `tier` from `__root.tsx` → `OnboardingWizard`, computes locked channels and maxItems from `tierLimits.ts`, and passes them to child components. This task builds on Tasks 1-5.

- [ ] **Step 1: Add tier prop and imports to OnboardingWizard**

In `desktop/src/components/onboarding/OnboardingWizard.tsx`:

Add to the imports section (after the existing imports):

```tsx
import { getLimit, TIER_LIMITS } from "../../tierLimits";
import { TIER_LABELS } from "../../auth";
import type { SubscriptionTier } from "../../auth";
```

Update the `OnboardingWizardProps` interface (line 26-29):

```tsx
interface OnboardingWizardProps {
  prefs: AppPreferences;
  tier: SubscriptionTier;
  /** Called when the wizard finishes or is skipped. Updated prefs are passed. */
  onComplete: (prefs: AppPreferences) => void;
}
```

Update the component signature (line 119):

```tsx
export default function OnboardingWizard({ prefs, tier, onComplete }: OnboardingWizardProps) {
```

- [ ] **Step 2: Compute locked channels and tier labels**

Add after the component signature, before the state declarations (after line 120):

```tsx
  // ── Tier-based channel locks ──
  const channelLimitKeys: Record<ChannelType, keyof typeof TIER_LIMITS["free"]> = {
    finance: "symbols",
    sports: "leagues",
    rss: "feeds",
    fantasy: "fantasy",
  };

  const lockedChannels = new Set<ChannelType>();
  const minTierLabels: Record<string, string> = {};

  for (const [ch, limitKey] of Object.entries(channelLimitKeys) as [ChannelType, keyof typeof TIER_LIMITS["free"]][]) {
    if (getLimit(tier, limitKey) === 0) {
      lockedChannels.add(ch);
      // Find the minimum tier that unlocks this channel
      const tiers: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate"];
      for (const t of tiers) {
        if (getLimit(t, limitKey) > 0) {
          minTierLabels[ch] = TIER_LABELS[t];
          break;
        }
      }
    }
  }
```

- [ ] **Step 3: Compute maxItems helper**

Add a helper function after the locked channels computation:

```tsx
  function maxItemsFor(channel: ChannelType): number | undefined {
    const limitKey = channelLimitKeys[channel];
    const limit = getLimit(tier, limitKey);
    return limit === Infinity ? undefined : limit;
  }
```

- [ ] **Step 4: Update StepChannels render to pass new props**

In the `renderStep` function, update the `channels` case (around line 304-305):

Change:
```tsx
      case "channels":
        return <StepChannels selected={selectedChannels} onToggle={toggleChannel} />;
```

to:
```tsx
      case "channels":
        return (
          <StepChannels
            selected={selectedChannels}
            onToggle={toggleChannel}
            lockedChannels={lockedChannels}
            minTierLabels={minTierLabels}
          />
        );
```

- [ ] **Step 5: Update configure step renders to pass maxItems**

In the `renderStep` function, update each configure step case:

Change the finance case:
```tsx
          case "finance":
            return <StepConfigureFinance selected={financeSymbols} onToggle={toggleSymbol} />;
```
to:
```tsx
          case "finance":
            return <StepConfigureFinance selected={financeSymbols} onToggle={toggleSymbol} maxItems={maxItemsFor("finance")} />;
```

Change the sports case:
```tsx
          case "sports":
            return <StepConfigureSports selected={sportsLeagues} onToggle={toggleLeague} />;
```
to:
```tsx
          case "sports":
            return <StepConfigureSports selected={sportsLeagues} onToggle={toggleLeague} maxItems={maxItemsFor("sports")} />;
```

Change the rss case:
```tsx
          case "rss":
            return <StepConfigureRss selected={rssFeeds} onToggle={toggleFeed} />;
```
to:
```tsx
          case "rss":
            return <StepConfigureRss selected={rssFeeds} onToggle={toggleFeed} maxItems={maxItemsFor("rss")} />;
```

Fantasy remains unchanged — it has no item selection, just a connect button.

- [ ] **Step 6: Pass tier prop from __root.tsx**

In `desktop/src/routes/__root.tsx`, line 532, change:

```tsx
        <OnboardingWizard prefs={prefs} onComplete={handleOnboardingComplete} />
```

to:

```tsx
        <OnboardingWizard prefs={prefs} tier={auth.tier} onComplete={handleOnboardingComplete} />
```

- [ ] **Step 7: Build verification**

Run: `npm run build` from `desktop/`
Expected: `vite build` succeeds, `tsc --noEmit` succeeds, no errors.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/onboarding/OnboardingWizard.tsx desktop/src/routes/__root.tsx
git commit -m "feat(wizard): wire tier prop and enforce channel locks + item limits"
```

---

### Task 7: Weather Geolocation Fix

**Files:**
- Modify: `desktop/src/widgets/weather/FeedTab.tsx:98-141`

**Context:** The current `detectLocation` function uses `navigator.geolocation.getCurrentPosition()` which silently fails in Tauri v2 webviews. Replace with IP-based geolocation using `http://ip-api.com/json/` (free, no API key, returns city/lat/lon/country/regionName). Add loading state and error feedback via `toast`.

- [ ] **Step 1: Add toast import**

In `desktop/src/widgets/weather/FeedTab.tsx`, add `toast` to imports. At the top of the file, after the existing imports, add:

```tsx
import { toast } from "sonner";
```

- [ ] **Step 2: Add detecting state**

Inside the `WeatherFeedTab` component, after the `showSearch` state declaration (line 52), add:

```tsx
  const [detecting, setDetecting] = useState(false);
```

- [ ] **Step 3: Replace detectLocation with IP-based geolocation**

Replace the entire `detectLocation` callback (lines 98-142) with:

```tsx
  // Detect location via IP-based geolocation
  const detectLocation = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await fetch("http://ip-api.com/json/?fields=status,city,lat,lon,country,regionName");
      if (!res.ok) throw new Error("Request failed");
      const data = (await res.json()) as {
        status: string;
        city?: string;
        lat?: number;
        lon?: number;
        country?: string;
        regionName?: string;
      };
      if (data.status !== "success" || data.lat == null || data.lon == null) {
        throw new Error("Location not found");
      }
      addCity({
        name: data.city || "My Location",
        lat: data.lat,
        lon: data.lon,
        country: data.country ?? "",
        admin1: data.regionName,
      });
    } catch {
      toast.error("Couldn't detect your location — try searching for a city instead");
    } finally {
      setDetecting(false);
    }
  }, [addCity]);
```

**Note:** The `fetch` here is from `@tauri-apps/plugin-http` (already imported at the top of `FeedTab.tsx` if it uses Tauri's fetch). Check: if the file uses the standard `fetch` (global/window), keep using that. If it imports Tauri's fetch, use that instead. The global `fetch` should work for HTTP requests in Tauri webviews. The ip-api.com endpoint uses **HTTP** (not HTTPS) for free-tier access, so ensure no HTTPS-only enforcement blocks it.

**Important:** Looking at the file, it does NOT import Tauri's fetch — it uses the global `fetch`. This is correct for standard HTTP requests from the webview.

- [ ] **Step 4: Update the "Use My Location" buttons to show loading state**

In the empty state section (around lines 159-164), update the button:

Change:
```tsx
          <button
            onClick={detectLocation}
            className="text-xs font-mono text-fg px-3 py-1.5 rounded-lg bg-surface-2 border border-edge hover:border-edge-2 transition-colors"
          >
            Use My Location
          </button>
```

to:
```tsx
          <button
            onClick={detectLocation}
            disabled={detecting}
            className="text-xs font-mono text-fg px-3 py-1.5 rounded-lg bg-surface-2 border border-edge hover:border-edge-2 transition-colors disabled:opacity-40"
          >
            {detecting ? "Detecting..." : "Use My Location"}
          </button>
```

In the header section (around lines 187-193), update the pin button:

Change:
```tsx
          <Tooltip content="Use my location">
            <button
              onClick={detectLocation}
              className="text-xs font-mono text-widget-weather/70 hover:text-widget-weather transition-colors"
            >
              {"\u{1F4CD}"}
            </button>
          </Tooltip>
```

to:
```tsx
          <Tooltip content="Use my location">
            <button
              onClick={detectLocation}
              disabled={detecting}
              className="text-xs font-mono text-widget-weather/70 hover:text-widget-weather transition-colors disabled:opacity-40"
            >
              {detecting ? "..." : "\u{1F4CD}"}
            </button>
          </Tooltip>
```

- [ ] **Step 5: Build verification**

Run: `npm run build` from `desktop/`
Expected: Succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/widgets/weather/FeedTab.tsx
git commit -m "fix(weather): replace broken browser geolocation with IP-based detection"
```

---

### Task 8: Final Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run from `desktop/`:
```bash
npm run build
```

Expected: `vite build` and `tsc --noEmit` both succeed with zero errors.

- [ ] **Step 2: Verify all commits on branch**

Run from repo root:
```bash
git log --oneline feature/wizard-overhaul --not main
```

Expected: 6-7 commits covering all tasks.

- [ ] **Step 3: Verify changed files**

Run from repo root:
```bash
git diff --stat main...feature/wizard-overhaul
```

Expected files changed:
- `desktop/src/components/onboarding/OnboardingWizard.tsx`
- `desktop/src/components/onboarding/StepChannels.tsx`
- `desktop/src/components/onboarding/StepConfigureFinance.tsx`
- `desktop/src/components/onboarding/StepConfigureSports.tsx`
- `desktop/src/components/onboarding/StepConfigureRss.tsx`
- `desktop/src/routes/__root.tsx`
- `desktop/src/widgets/weather/FeedTab.tsx`
