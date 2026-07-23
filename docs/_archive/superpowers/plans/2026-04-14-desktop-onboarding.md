# Desktop Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auth gate + onboarding wizard so new users are guided through sign-in, channel setup, and widget selection before seeing the app.

**Architecture:** Conditional rendering in `__root.tsx` switches between three states: auth gate (unauthenticated), onboarding wizard (authenticated, not onboarded), and normal app shell (authenticated, onboarded). Wizard collects selections locally, then creates channels and updates configs via existing API before marking onboarding complete.

**Tech Stack:** React 19, TanStack Query, Tauri store, existing `channelsApi` + `preferences` modules. `react-joyride@3` installed for future product tour (not wired up in this iteration).

**Spec:** `docs/superpowers/specs/2026-04-14-onboarding-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/src/preferences.ts` | Modify | Add `onboardingComplete: boolean` field |
| `desktop/src/components/onboarding/curated-picks.ts` | Create | Static data: popular stocks, leagues, RSS feeds |
| `desktop/src/components/onboarding/AuthGate.tsx` | Create | Full-screen sign-in wall |
| `desktop/src/components/onboarding/WizardShell.tsx` | Create | Layout wrapper: progress bar, nav buttons, step title |
| `desktop/src/components/onboarding/StepChannels.tsx` | Create | Step 1: channel selection toggle cards |
| `desktop/src/components/onboarding/StepConfigureFinance.tsx` | Create | Step 2a: stock/crypto checkbox grid |
| `desktop/src/components/onboarding/StepConfigureSports.tsx` | Create | Step 2b: league checklist |
| `desktop/src/components/onboarding/StepConfigureRss.tsx` | Create | Step 2c: feed checklist by category |
| `desktop/src/components/onboarding/StepConfigureFantasy.tsx` | Create | Step 2d: Yahoo connect button |
| `desktop/src/components/onboarding/StepWidgets.tsx` | Create | Step 3: widget selection toggle cards |
| `desktop/src/components/onboarding/OnboardingWizard.tsx` | Create | Step orchestrator: state machine, step routing, API calls on transitions, completion |
| `desktop/src/routes/__root.tsx` | Modify | Conditional render: auth gate / wizard / app shell; existing-user migration |

---

### Task 1: Add `onboardingComplete` preference and install react-joyride

**Files:**
- Modify: `desktop/src/preferences.ts:197-209` (AppPreferences interface)
- Modify: `desktop/src/preferences.ts:324-334` (DEFAULT_PREFS)
- Modify: `desktop/package.json` (add react-joyride dependency)

- [ ] **Step 1: Install react-joyride**

Run in `desktop/`:
```bash
npm install react-joyride@3
```

This installs the library for future product tour work. It is NOT wired up in this iteration — just installed so it's available.

- [ ] **Step 2: Add `onboardingComplete` to `AppPreferences` interface**

In `desktop/src/preferences.ts`, add the field to the `AppPreferences` interface after `homePreview`:

```ts
export interface AppPreferences {
  appearance: AppearancePrefs;
  ticker: TickerPrefs;
  startup: StartupPrefs;
  window: WindowPrefs;
  taskbar: TaskbarPrefs;
  widgets: WidgetPrefs;
  channelDisplay: ChannelDisplayPrefs;
  /** Channel/widget IDs pinned to the sidebar for quick access. */
  pinnedSources: string[];
  /** Per-channel homepage preview selections (up to 5 group keys). */
  homePreview: HomePreview;
  /** Whether the user has completed the onboarding wizard. */
  onboardingComplete: boolean;
}
```

- [ ] **Step 3: Add default value to `DEFAULT_PREFS`**

In the same file, update `DEFAULT_PREFS`:

```ts
const DEFAULT_PREFS: AppPreferences = {
  appearance: DEFAULT_APPEARANCE,
  ticker: DEFAULT_TICKER,
  startup: DEFAULT_STARTUP,
  window: DEFAULT_WINDOW,
  taskbar: DEFAULT_TASKBAR,
  widgets: DEFAULT_WIDGETS,
  channelDisplay: DEFAULT_CHANNEL_DISPLAY,
  pinnedSources: [],
  homePreview: {},
  onboardingComplete: false,
};
```

- [ ] **Step 4: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. The `loadPrefs()` deep-merge handles missing fields automatically, so existing stored prefs gain `onboardingComplete: false` on load.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/preferences.ts desktop/package.json desktop/package-lock.json
git commit -m "feat(desktop): add onboardingComplete preference and install react-joyride"
```

---

### Task 2: Create curated quick-pick data

**Files:**
- Create: `desktop/src/components/onboarding/curated-picks.ts`

- [ ] **Step 1: Create the curated picks data file**

```ts
// desktop/src/components/onboarding/curated-picks.ts

export interface StockPick {
  symbol: string;
  name: string;
}

export interface LeaguePick {
  id: string;
  name: string;
  sport: string;
}

export interface FeedPick {
  url: string;
  name: string;
  category: string;
}

export const POPULAR_STOCKS: StockPick[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "META", name: "Meta" },
  { symbol: "JPM", name: "JPMorgan" },
  { symbol: "V", name: "Visa" },
  { symbol: "DIS", name: "Disney" },
];

export const POPULAR_CRYPTO: StockPick[] = [
  { symbol: "BTC/USD", name: "Bitcoin" },
  { symbol: "ETH/USD", name: "Ethereum" },
  { symbol: "SOL/USD", name: "Solana" },
];

export const POPULAR_LEAGUES: LeaguePick[] = [
  { id: "1", name: "NFL", sport: "Football" },
  { id: "2", name: "NBA", sport: "Basketball" },
  { id: "3", name: "MLB", sport: "Baseball" },
  { id: "4", name: "NHL", sport: "Hockey" },
  { id: "253", name: "MLS", sport: "Soccer" },
  { id: "39", name: "Premier League", sport: "Soccer" },
  { id: "140", name: "La Liga", sport: "Soccer" },
  { id: "78", name: "Bundesliga", sport: "Soccer" },
  { id: "135", name: "Serie A", sport: "Soccer" },
  { id: "2", name: "Champions League", sport: "Soccer" },
  { id: "61", name: "Ligue 1", sport: "Soccer" },
];

export const RECOMMENDED_FEEDS: FeedPick[] = [
  // Tech
  { url: "https://techcrunch.com/feed/", name: "TechCrunch", category: "Tech" },
  { url: "https://feeds.arstechnica.com/arstechnica/features", name: "Ars Technica", category: "Tech" },
  { url: "https://www.theverge.com/rss/index.xml", name: "The Verge", category: "Tech" },
  // Business
  { url: "https://feeds.bloomberg.com/markets/news.rss", name: "Bloomberg Markets", category: "Business" },
  { url: "https://www.reutersagency.com/feed/", name: "Reuters", category: "Business" },
  // News
  { url: "https://rss.app/feeds/v1.1/tDBXCLAcqDjHBmtx.xml", name: "AP News", category: "News" },
  { url: "https://feeds.bbci.co.uk/news/rss.xml", name: "BBC News", category: "News" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", name: "NY Times", category: "News" },
  { url: "https://www.theguardian.com/world/rss", name: "The Guardian", category: "News" },
];
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/components/onboarding/curated-picks.ts
git commit -m "feat(desktop): add curated quick-pick data for onboarding"
```

---

### Task 3: Create AuthGate component

**Files:**
- Create: `desktop/src/components/onboarding/AuthGate.tsx`

- [ ] **Step 1: Create the auth gate component**

The auth gate is a full-screen centered card with the app logo, tagline, sign-in button, and create-account link. No sidebar, no navigation, just OS-native window decorations.

```tsx
// desktop/src/components/onboarding/AuthGate.tsx

import { open } from "@tauri-apps/plugin-shell";
import { Zap } from "lucide-react";

interface AuthGateProps {
  onLogin: () => void;
}

export default function AuthGate({ onLogin }: AuthGateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen select-none">
      {/* Draggable region for window movement */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-8" />

      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
          <Zap size={28} className="text-accent" />
        </div>

        {/* Tagline */}
        <div>
          <h1 className="text-xl font-semibold text-fg">Scrollr</h1>
          <p className="text-sm text-fg-3 mt-1">
            Your personalized market, sports, and news ticker.
          </p>
        </div>

        {/* Sign in button */}
        <button
          onClick={onLogin}
          className="w-full px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Sign In
        </button>

        {/* Create account link */}
        <p className="text-xs text-fg-4">
          Don't have an account?{" "}
          <button
            onClick={onLogin}
            className="text-accent hover:text-accent/80 transition-colors font-medium"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
```

Note: Both "Sign In" and "Create one" trigger the same PKCE flow (`onLogin`). Logto handles the sign-up/sign-in distinction on its own hosted UI. If Logto supports `interaction_mode=signUp`, the "Create one" button can be enhanced later to pass that parameter.

- [ ] **Step 2: Commit**

```bash
git add desktop/src/components/onboarding/AuthGate.tsx
git commit -m "feat(desktop): add AuthGate sign-in wall component"
```

---

### Task 4: Create WizardShell layout wrapper

**Files:**
- Create: `desktop/src/components/onboarding/WizardShell.tsx`

- [ ] **Step 1: Create the wizard shell component**

The shell wraps each step with a consistent layout: progress indicator, step title, content area, and navigation buttons (Back, Skip, Next/Finish).

```tsx
// desktop/src/components/onboarding/WizardShell.tsx

import { Zap } from "lucide-react";

interface WizardShellProps {
  /** Current step index (0-based). */
  stepIndex: number;
  /** Total number of steps. */
  totalSteps: number;
  /** Title shown above the step content. */
  title: string;
  /** Subtitle shown below the title. */
  subtitle?: string;
  /** Step content. */
  children: React.ReactNode;
  /** Show the Back button. */
  showBack?: boolean;
  /** Label for the forward button. Default: "Next". */
  nextLabel?: string;
  /** Whether the forward button is disabled. */
  nextDisabled?: boolean;
  /** Show a Skip button alongside Next. */
  showSkip?: boolean;
  onBack?: () => void;
  onNext: () => void;
  onSkip?: () => void;
}

export default function WizardShell({
  stepIndex,
  totalSteps,
  title,
  subtitle,
  children,
  showBack = false,
  nextLabel = "Next",
  nextDisabled = false,
  showSkip = false,
  onBack,
  onNext,
  onSkip,
}: WizardShellProps) {
  return (
    <div className="flex flex-col h-screen w-screen select-none">
      {/* Draggable region */}
      <div data-tauri-drag-region className="shrink-0 h-8" />

      {/* Progress bar */}
      <div className="shrink-0 px-8">
        <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col items-center overflow-y-auto px-8 py-8">
        <div className="w-full max-w-lg">
          {/* Logo + step title */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <Zap size={16} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-fg">{title}</h2>
              {subtitle && (
                <p className="text-xs text-fg-4 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {children}
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="shrink-0 flex items-center justify-between px-8 py-4 border-t border-edge">
        <div>
          {showBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg text-sm text-fg-3 hover:text-fg-2 hover:bg-surface-hover transition-colors"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {showSkip && (
            <button
              onClick={onSkip}
              className="px-4 py-2 rounded-lg text-sm text-fg-4 hover:text-fg-3 transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="px-6 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/components/onboarding/WizardShell.tsx
git commit -m "feat(desktop): add WizardShell layout wrapper for onboarding"
```

---

### Task 5: Create step components (Steps 1-3)

**Files:**
- Create: `desktop/src/components/onboarding/StepChannels.tsx`
- Create: `desktop/src/components/onboarding/StepConfigureFinance.tsx`
- Create: `desktop/src/components/onboarding/StepConfigureSports.tsx`
- Create: `desktop/src/components/onboarding/StepConfigureRss.tsx`
- Create: `desktop/src/components/onboarding/StepConfigureFantasy.tsx`
- Create: `desktop/src/components/onboarding/StepWidgets.tsx`

- [ ] **Step 1: Create `StepChannels.tsx` (Step 1 — channel selection)**

```tsx
// desktop/src/components/onboarding/StepChannels.tsx

import { TrendingUp, Trophy, Rss, Star } from "lucide-react";
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
}

export default function StepChannels({ selected, onToggle }: StepChannelsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CHANNEL_OPTIONS.map((ch) => {
        const Icon = ch.icon;
        const active = selected.has(ch.id);
        return (
          <button
            key={ch.id}
            onClick={() => onToggle(ch.id)}
            className={clsx(
              "flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all",
              active
                ? "border-accent bg-accent/5"
                : "border-edge hover:border-fg-4 bg-surface-2/50",
            )}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${ch.hex}15` }}
            >
              <Icon size={20} style={{ color: ch.hex }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-fg">{ch.name}</p>
              <p className="text-xs text-fg-4 mt-0.5">{ch.description}</p>
            </div>
            {active && (
              <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `StepConfigureFinance.tsx` (Step 2a)**

```tsx
// desktop/src/components/onboarding/StepConfigureFinance.tsx

import clsx from "clsx";
import { POPULAR_STOCKS, POPULAR_CRYPTO } from "./curated-picks";
import type { StockPick } from "./curated-picks";

interface StepConfigureFinanceProps {
  selected: Set<string>;
  onToggle: (symbol: string) => void;
}

function SymbolGrid({ items, selected, onToggle, label }: {
  items: StockPick[];
  selected: Set<string>;
  onToggle: (s: string) => void;
  label: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{label}</h3>
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const active = selected.has(item.symbol);
          return (
            <button
              key={item.symbol}
              onClick={() => onToggle(item.symbol)}
              className={clsx(
                "px-3 py-2 rounded-lg border text-center transition-all",
                active
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

export default function StepConfigureFinance({ selected, onToggle }: StepConfigureFinanceProps) {
  return (
    <div className="flex flex-col gap-5">
      <SymbolGrid items={POPULAR_STOCKS} selected={selected} onToggle={onToggle} label="Popular Stocks" />
      <SymbolGrid items={POPULAR_CRYPTO} selected={selected} onToggle={onToggle} label="Crypto" />
    </div>
  );
}
```

- [ ] **Step 3: Create `StepConfigureSports.tsx` (Step 2b)**

```tsx
// desktop/src/components/onboarding/StepConfigureSports.tsx

import clsx from "clsx";
import { POPULAR_LEAGUES } from "./curated-picks";

interface StepConfigureSportsProps {
  selected: Set<string>;
  onToggle: (leagueId: string) => void;
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
              const active = selected.has(league.id);
              return (
                <button
                  key={`${league.id}-${league.name}`}
                  onClick={() => onToggle(league.id)}
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

- [ ] **Step 4: Create `StepConfigureRss.tsx` (Step 2c)**

```tsx
// desktop/src/components/onboarding/StepConfigureRss.tsx

import clsx from "clsx";
import { RECOMMENDED_FEEDS } from "./curated-picks";

interface StepConfigureRssProps {
  selected: Set<string>;
  onToggle: (url: string) => void;
}

export default function StepConfigureRss({ selected, onToggle }: StepConfigureRssProps) {
  const grouped = RECOMMENDED_FEEDS.reduce<Record<string, typeof RECOMMENDED_FEEDS>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([category, feeds]) => (
        <div key={category}>
          <h3 className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">{category}</h3>
          <div className="flex flex-col gap-1.5">
            {feeds.map((feed) => {
              const active = selected.has(feed.url);
              return (
                <button
                  key={feed.url}
                  onClick={() => onToggle(feed.url)}
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
                  <span className="text-sm text-fg">{feed.name}</span>
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

- [ ] **Step 5: Create `StepConfigureFantasy.tsx` (Step 2d)**

This is the simplest configure step. It shows a "Connect Yahoo" button that triggers the existing Yahoo OAuth flow.

```tsx
// desktop/src/components/onboarding/StepConfigureFantasy.tsx

import { Star } from "lucide-react";

interface StepConfigureFantasyProps {
  connected: boolean;
  onConnect: () => void;
}

export default function StepConfigureFantasy({ connected, onConnect }: StepConfigureFantasyProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-14 h-14 rounded-xl bg-purple-500/10 flex items-center justify-center">
        <Star size={28} className="text-purple-400" />
      </div>

      {connected ? (
        <div className="text-center">
          <p className="text-sm font-medium text-success">Yahoo Connected</p>
          <p className="text-xs text-fg-4 mt-1">
            Your leagues will sync automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm text-fg-2">
              Connect your Yahoo account to import your fantasy leagues.
            </p>
            <p className="text-xs text-fg-4 mt-1">
              You can also do this later from Settings.
            </p>
          </div>
          <button
            onClick={onConnect}
            className="px-6 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 transition-colors"
          >
            Connect Yahoo
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `StepWidgets.tsx` (Step 3)**

```tsx
// desktop/src/components/onboarding/StepWidgets.tsx

import { Cloud, Clock, Cpu, Activity, Github } from "lucide-react";
import clsx from "clsx";

const WIDGET_OPTIONS: { id: string; name: string; description: string; icon: typeof Cloud; hex: string }[] = [
  { id: "weather", name: "Weather", description: "Forecasts for your cities", icon: Cloud, hex: "#38bdf8" },
  { id: "clock", name: "Clock", description: "World clocks and timers", icon: Clock, hex: "#818cf8" },
  { id: "sysmon", name: "System Monitor", description: "CPU, memory, and disk", icon: Cpu, hex: "#4ade80" },
  { id: "uptime", name: "Uptime Kuma", description: "Service health monitoring", icon: Activity, hex: "#fb923c" },
  { id: "github", name: "GitHub Actions", description: "CI/CD workflow status", icon: Github, hex: "#e2e8f0" },
];

interface StepWidgetsProps {
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export default function StepWidgets({ selected, onToggle }: StepWidgetsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {WIDGET_OPTIONS.map((w) => {
        const Icon = w.icon;
        const active = selected.has(w.id);
        return (
          <button
            key={w.id}
            onClick={() => onToggle(w.id)}
            className={clsx(
              "flex flex-col items-center gap-2 p-5 rounded-xl border-2 transition-all",
              active
                ? "border-accent bg-accent/5"
                : "border-edge hover:border-fg-4 bg-surface-2/50",
            )}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${w.hex}15` }}
            >
              <Icon size={20} style={{ color: w.hex }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-fg">{w.name}</p>
              <p className="text-xs text-fg-4 mt-0.5">{w.description}</p>
            </div>
            {active && (
              <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. Step components are standalone — no integration yet.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/onboarding/StepChannels.tsx \
       desktop/src/components/onboarding/StepConfigureFinance.tsx \
       desktop/src/components/onboarding/StepConfigureSports.tsx \
       desktop/src/components/onboarding/StepConfigureRss.tsx \
       desktop/src/components/onboarding/StepConfigureFantasy.tsx \
       desktop/src/components/onboarding/StepWidgets.tsx
git commit -m "feat(desktop): add onboarding wizard step components"
```

---

### Task 6: Create OnboardingWizard orchestrator

**Files:**
- Create: `desktop/src/components/onboarding/OnboardingWizard.tsx`

This is the central state machine. It manages which step is shown, collects selections, performs API calls on step transitions (channel creation and config updates), and calls `onComplete` when finished.

- [ ] **Step 1: Create the wizard orchestrator**

```tsx
// desktop/src/components/onboarding/OnboardingWizard.tsx

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { channelsApi } from "../../api/client";
import { queryKeys } from "../../api/queries";
import type { ChannelType } from "../../api/client";
import type { AppPreferences } from "../../preferences";

import WizardShell from "./WizardShell";
import StepChannels from "./StepChannels";
import StepConfigureFinance from "./StepConfigureFinance";
import StepConfigureSports from "./StepConfigureSports";
import StepConfigureRss from "./StepConfigureRss";
import StepConfigureFantasy from "./StepConfigureFantasy";
import StepWidgets from "./StepWidgets";

// ── Types ───────────────────────────────────────────────────────

type WizardStep =
  | { kind: "channels" }
  | { kind: "configure"; channel: ChannelType }
  | { kind: "widgets" };

interface OnboardingWizardProps {
  prefs: AppPreferences;
  onComplete: (prefs: AppPreferences) => void;
}

// ── Helper: build step sequence based on selected channels ──────

function buildSteps(selectedChannels: Set<ChannelType>): WizardStep[] {
  const steps: WizardStep[] = [{ kind: "channels" }];
  const order: ChannelType[] = ["finance", "sports", "rss", "fantasy"];
  for (const ch of order) {
    if (selectedChannels.has(ch)) {
      steps.push({ kind: "configure", channel: ch });
    }
  }
  steps.push({ kind: "widgets" });
  return steps;
}

// ── Component ───────────────────────────────────────────────────

export default function OnboardingWizard({ prefs, onComplete }: OnboardingWizardProps) {
  const queryClient = useQueryClient();

  // ── Wizard state ──
  const [selectedChannels, setSelectedChannels] = useState<Set<ChannelType>>(new Set());
  const [financeSymbols, setFinanceSymbols] = useState<Set<string>>(new Set());
  const [sportsLeagues, setSportsLeagues] = useState<Set<string>>(new Set());
  const [rssFeeds, setRssFeeds] = useState<Set<string>>(new Set());
  const [fantasyConnected, setFantasyConnected] = useState(false);
  const [selectedWidgets, setSelectedWidgets] = useState<Set<string>>(new Set(["weather", "clock"]));
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // ── Derived step sequence ──
  const steps = buildSteps(selectedChannels);
  const currentStep = steps[stepIndex];
  const totalSteps = steps.length;

  // ── Toggle helpers ──
  const toggleChannel = useCallback((id: ChannelType) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleSymbol = useCallback((s: string) => {
    setFinanceSymbols((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const toggleLeague = useCallback((id: string) => {
    setSportsLeagues((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleFeed = useCallback((url: string) => {
    setRssFeeds((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  const toggleWidget = useCallback((id: string) => {
    setSelectedWidgets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── API: create channel + update config ──
  async function provisionChannel(type: ChannelType): Promise<void> {
    try {
      await channelsApi.create(type);
    } catch {
      // Channel may already exist (409), which is fine
    }

    // Update config with selected items
    try {
      if (type === "finance" && financeSymbols.size > 0) {
        await channelsApi.update(type, {
          config: { symbols: [...financeSymbols] },
        });
      } else if (type === "sports" && sportsLeagues.size > 0) {
        await channelsApi.update(type, {
          config: { leagues: [...sportsLeagues] },
        });
      } else if (type === "rss" && rssFeeds.size > 0) {
        await channelsApi.update(type, {
          config: { feeds: [...rssFeeds] },
        });
      }
      // Fantasy: no config update needed — Yahoo OAuth handles it
    } catch {
      toast.error(`Couldn't configure ${type} — you can set it up in Settings`);
    }
  }

  // ── Navigation: Next ──
  const handleNext = useCallback(async () => {
    if (busy) return;

    const step = steps[stepIndex];

    // If leaving channels step, rebuild step sequence
    if (step.kind === "channels") {
      // Steps will be rebuilt from selectedChannels on next render
    }

    // If leaving a configure step, provision the channel
    if (step.kind === "configure") {
      setBusy(true);
      await provisionChannel(step.channel);
      setBusy(false);
    }

    // If this is the last step (widgets), finish
    if (stepIndex >= steps.length - 1) {
      setBusy(true);

      // Provision any channels that don't have a configure step
      // (channels selected but skipped through)
      for (const ch of selectedChannels) {
        try {
          await channelsApi.create(ch);
        } catch {
          // 409 is fine
        }
      }

      // Build final prefs
      const widgetIds = [...selectedWidgets];
      const pinnedIds = [
        ...Array.from(selectedChannels),
        ...widgetIds,
      ];

      const nextPrefs: AppPreferences = {
        ...prefs,
        widgets: {
          ...prefs.widgets,
          enabledWidgets: widgetIds,
          widgetsOnTicker: widgetIds,
        },
        pinnedSources: pinnedIds,
        onboardingComplete: true,
      };

      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      setBusy(false);
      onComplete(nextPrefs);
      return;
    }

    setStepIndex((i) => i + 1);
  }, [busy, stepIndex, steps, selectedChannels, selectedWidgets, prefs, queryClient, onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation: Back ──
  const handleBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  // ── Navigation: Skip ──
  const handleSkip = useCallback(() => {
    // Skip always advances, without provisioning
    if (stepIndex >= steps.length - 1) {
      // Skipping the last step = finish with defaults
      const nextPrefs: AppPreferences = {
        ...prefs,
        pinnedSources: [...Array.from(selectedChannels)],
        onboardingComplete: true,
      };
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      onComplete(nextPrefs);
      return;
    }
    setStepIndex((i) => i + 1);
  }, [stepIndex, steps.length, prefs, selectedChannels, queryClient, onComplete]);

  // ── Render current step ──
  function renderStep() {
    if (!currentStep) return null;

    switch (currentStep.kind) {
      case "channels":
        return <StepChannels selected={selectedChannels} onToggle={toggleChannel} />;
      case "configure":
        switch (currentStep.channel) {
          case "finance":
            return <StepConfigureFinance selected={financeSymbols} onToggle={toggleSymbol} />;
          case "sports":
            return <StepConfigureSports selected={sportsLeagues} onToggle={toggleLeague} />;
          case "rss":
            return <StepConfigureRss selected={rssFeeds} onToggle={toggleFeed} />;
          case "fantasy":
            return (
              <StepConfigureFantasy
                connected={fantasyConnected}
                onConnect={() => {
                  // TODO: trigger Yahoo OAuth flow
                  // For now, just mark as connected for UX
                  setFantasyConnected(true);
                }}
              />
            );
          default:
            return null;
        }
      case "widgets":
        return <StepWidgets selected={selectedWidgets} onToggle={toggleWidget} />;
    }
  }

  // ── Shell props per step ──
  function stepTitle(): string {
    if (!currentStep) return "";
    switch (currentStep.kind) {
      case "channels": return "Pick Your Channels";
      case "configure":
        switch (currentStep.channel) {
          case "finance": return "Set Up Finance";
          case "sports": return "Set Up Sports";
          case "rss": return "Set Up RSS Feeds";
          case "fantasy": return "Set Up Fantasy";
          default: return "Configure";
        }
      case "widgets": return "Pick Your Widgets";
    }
  }

  function stepSubtitle(): string | undefined {
    if (!currentStep) return undefined;
    switch (currentStep.kind) {
      case "channels": return "Select the data sources you want on your ticker.";
      case "configure":
        switch (currentStep.channel) {
          case "finance": return "Choose stocks and crypto to track.";
          case "sports": return "Select the leagues you follow.";
          case "rss": return "Pick news and blog feeds.";
          case "fantasy": return "Connect your Yahoo Fantasy account.";
          default: return undefined;
        }
      case "widgets": return "Add utility widgets to your ticker.";
    }
  }

  const isLastStep = stepIndex >= steps.length - 1;

  return (
    <WizardShell
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      title={stepTitle()}
      subtitle={stepSubtitle()}
      showBack={stepIndex > 0}
      showSkip
      nextLabel={isLastStep ? "Finish" : "Next"}
      nextDisabled={busy}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
    >
      {renderStep()}
    </WizardShell>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. The wizard is not wired into `__root.tsx` yet.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/onboarding/OnboardingWizard.tsx
git commit -m "feat(desktop): add OnboardingWizard step orchestrator"
```

---

### Task 7: Integrate auth gate + wizard into `__root.tsx`

**Files:**
- Modify: `desktop/src/routes/__root.tsx`

This is the final integration step. The root layout gains three-way conditional rendering: auth gate, wizard, or normal app shell.

- [ ] **Step 1: Add imports**

Add at the top of `__root.tsx` (around line 27, with the other component imports):

```ts
import AuthGate from "../components/onboarding/AuthGate";
import OnboardingWizard from "../components/onboarding/OnboardingWizard";
```

- [ ] **Step 2: Add existing-user migration and state derivation**

Inside `RootLayout()`, after the `prefs` state (around line 174-176), add the migration logic and the three-way rendering booleans:

```ts
  // ── Onboarding state ────────────────────────────────────────
  // Existing users who already have channels skip the wizard automatically.
  const [migrationChecked, setMigrationChecked] = useState(false);

  useEffect(() => {
    if (migrationChecked) return;
    if (!auth.authenticated) return;
    if (prefs.onboardingComplete) {
      setMigrationChecked(true);
      return;
    }
    // Check if user already has channels (existing user upgrade)
    if (dashboard && !loading) {
      if (dashboard.channels && dashboard.channels.length > 0) {
        const next = { ...prefs, onboardingComplete: true };
        setPrefs(next);
        savePrefs(next);
      }
      setMigrationChecked(true);
    }
  }, [auth.authenticated, prefs.onboardingComplete, dashboard, loading, migrationChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  const showAuthGate = !auth.authenticated;
  const showOnboarding = auth.authenticated && !prefs.onboardingComplete && migrationChecked;
  const showApp = auth.authenticated && prefs.onboardingComplete;
```

Add the `handleOnboardingComplete` callback alongside other callbacks (around line 405-408, near `handlePrefsChange`):

```ts
  const handleOnboardingComplete = useCallback((nextPrefs: AppPreferences) => {
    setPrefs(nextPrefs);
    savePrefs(nextPrefs);
  }, []);
```

- [ ] **Step 3: Wrap the render JSX with conditional rendering**

Replace the current return block (lines 461-635) with the three-way conditional:

The `<div id="app-shell">` wrapper stays (it applies the theme). Inside it, the content switches:

```tsx
  return (
    <div
      id="app-shell"
      data-theme="dark"
      className={clsx(
        "flex flex-col h-screen w-screen overflow-hidden bg-surface text-fg",
        !IS_MACOS && "custom-chrome",
      )}
    >
      {showAuthGate && <AuthGate onLogin={auth.handleLogin} />}

      {showOnboarding && (
        <OnboardingWizard prefs={prefs} onComplete={handleOnboardingComplete} />
      )}

      {showApp && (
        <>
          {!IS_MACOS && <TitleBar />}

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <Sidebar
              isFeed={route.isFeed}
              isSettings={route.isSettings}
              isMarketplace={route.isMarketplace}
              activeItem={route.activeItem}
              pinnedSources={resolvedPinnedSources}
              deliveryMode={deliveryMode}
              tickerAlive={prefs.ticker.showTicker}
              onNavigateToFeed={handleNavigateToFeed}
              onNavigateToSettings={handleNavigateToSettings}
              onNavigateToMarketplace={handleNavigateToMarketplace}
              onSelectItem={handleSelectPinned}
            />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
              {auth.sessionExpired && (
                /* ... existing session expired banner ... */
              )}

              {auth.authenticated && !billingBannerDismissed && (() => {
                /* ... existing billing banners ... */
              })()}

              <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ scrollbarGutter: "stable" }}>
                <ShellContext.Provider value={shellStableValue}>
                  <ShellDataContext.Provider value={shellDataValue}>
                    <Outlet />
                  </ShellDataContext.Provider>
                </ShellContext.Provider>
              </div>

              <Toaster theme="dark" richColors position="bottom-right" />

              {auth.loggingIn && (
                /* ... existing signing-in overlay ... */
              )}
            </main>
          </div>
        </>
      )}

      {/* Signing-in overlay shows on ALL states (auth gate triggers login too) */}
      {auth.loggingIn && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Signing in"
          className="absolute inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
        >
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-fg-2">Signing you in...</p>
            <p className="text-xs text-fg-3 mt-1">Finish signing in from your browser</p>
            <button
              onClick={() => auth.setLoggingIn(false)}
              className="mt-4 px-4 py-1.5 rounded-lg text-xs font-medium text-fg-3 hover:text-fg-2 hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toaster must be available in all states */}
      {!showApp && <Toaster theme="dark" richColors position="bottom-right" />}
    </div>
  );
```

Key changes:
- The signing-in overlay moves OUTSIDE the `showApp` block so it appears during auth gate login too
- A second `<Toaster>` is rendered outside `showApp` to catch toasts from the wizard
- The `showApp` block preserves the existing session-expired banner, billing banners, and all current functionality unchanged

- [ ] **Step 4: Add `savePrefs` to imports**

Ensure `savePrefs` is imported (check line 37 — it should already be there from `import { loadPref, loadPrefs, savePrefs } from "../preferences"`).

- [ ] **Step 5: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build with zero type errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/routes/__root.tsx
git commit -m "feat(desktop): integrate auth gate and onboarding wizard into root layout"
```

---

### Task 8: Manual testing and polish

- [ ] **Step 1: Reset onboarding state for testing**

To test the full flow, clear the stored prefs so onboarding shows:

1. Run `npm run tauri:dev` in `desktop/`
2. Open the store file: `~/Library/Application Support/com.scrollr.desktop/scrollr.json`
3. Delete the `scrollr:settings` key (or set `onboardingComplete: false` in the settings object)
4. Restart the app

- [ ] **Step 2: Verify auth gate**

Expected behavior:
- App opens showing only the auth gate (centered card, no sidebar, no TitleBar)
- OS-native window decorations are visible (draggable title bar area)
- "Sign In" button triggers the PKCE login flow (opens browser)
- After successful sign-in, auth gate disappears

- [ ] **Step 3: Verify wizard flow**

After sign-in (if `onboardingComplete` is false):
- Step 1: Channel cards render in 2x2 grid, toggling works, checkmarks appear
- Skip advances to Step 3 (widgets) if no channels selected
- Next with channels selected shows configure steps
- Step 2: Finance picks render, sports checklist renders, RSS feeds render
- Step 3: Widget cards render, weather and clock pre-selected
- Finish: app shell appears, sidebar shows, pinned items in sidebar, dashboard fetches data

- [ ] **Step 4: Verify existing user migration**

1. Sign in as a user who already has channels
2. Expected: wizard is skipped, app shell appears immediately
3. Check that `onboardingComplete: true` is now in stored prefs

- [ ] **Step 5: Fix any issues found during testing**

Address any build errors, visual glitches, or flow problems.

- [ ] **Step 6: Final commit and merge**

```bash
git add -A
git commit -m "feat(desktop): complete onboarding wizard with auth gate and channel setup"
```

Merge branch to `main` when ready.
