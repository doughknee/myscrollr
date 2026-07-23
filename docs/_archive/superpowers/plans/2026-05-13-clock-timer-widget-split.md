# Clock Timer Widget Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the combined desktop Clock widget into independent Clock and Timer widgets with separate config, ticker data, preferences, and refined UI.

**Architecture:** Keep Clock in `desktop/src/widgets/clock/` and move Timer into `desktop/src/widgets/timer/`. Add timer-owned preferences and ticker data while migrating existing `clock.pomodoro`, `clock.ticker.activeTimer`, and runtime timer state without data loss.

**Tech Stack:** React 19, TypeScript, Vite 7, TanStack Router, Tailwind v4, Tauri plugin-store.

---

## File Structure

- Modify `desktop/src/preferences.ts`: add timer preference interfaces/defaults, remove timer ownership from Clock, migrate legacy clock timer settings into `widgets.timer`.
- Modify `desktop/src/types/index.ts`: add `timer` to `WidgetTickerData` so clock and timer ticker chips are independently owned.
- Modify `desktop/src/hooks/useWidgetTickerData.ts`: split clock chip building from timer chip building and return timer data under `timer`.
- Modify `desktop/src/widgets/registry.ts`: add `timer` to canonical widget order.
- Modify `desktop/src/widgets/WidgetConfigPanel.tsx`: route `timer` to a new Timer config panel.
- Modify `desktop/src/widgets/clock/FeedTab.tsx`: remove internal clock/timer tabs and expose only Clock feed behavior.
- Modify `desktop/src/widgets/clock/ConfigPanel.tsx`: remove Pomodoro and active-timer settings from Clock.
- Modify `desktop/src/widgets/clock/types.ts`: remove `ClockTab`; keep shared time-related Clock types only.
- Modify `desktop/src/widgets/clock/WorldClock.tsx`: polish Clock comfort/compact UI without Timer-specific behavior.
- Create `desktop/src/widgets/timer/FeedTab.tsx`: Timer widget manifest and feed shell.
- Create `desktop/src/widgets/timer/ConfigPanel.tsx`: Timer settings panel.
- Move/create `desktop/src/widgets/timer/Timer.tsx`: Timer component implementation.
- Create `desktop/src/widgets/timer/types.ts`: Timer mode/state types.

---

### Task 1: Add Timer-Owned Preferences

**Files:**
- Modify: `desktop/src/preferences.ts`

- [ ] **Step 1: Add timer preference interfaces next to clock interfaces**

Replace the current clock timer-owned interfaces around `ClockTickerConfig`, `ClockPomodoroConfig`, and `ClockWidgetConfig` with this shape:

```ts
export interface ClockTickerConfig {
  localTime: boolean;
  /** Whether to show world clocks on the ticker at all (default false). */
  showTimezones: boolean;
  /** Timezone IANA IDs excluded from the ticker (empty = all configured TZs shown). */
  excludedTimezones: string[];
}

export interface ClockWidgetConfig {
  ticker: ClockTickerConfig;
}

export interface TimerTickerConfig {
  activeTimer: boolean;
}

export interface TimerPomodoroConfig {
  workMins: number;
  shortBreakMins: number;
  longBreakMins: number;
  longBreakEvery: number;
}

export interface TimerWidgetConfig {
  ticker: TimerTickerConfig;
  pomodoro: TimerPomodoroConfig;
}
```

- [ ] **Step 2: Add `timer` to `WidgetPrefs`**

Change the `WidgetPrefs` interface so the widget section includes timer as a peer:

```ts
export interface WidgetPrefs {
  /** Widget IDs that are enabled (shown in sidebar and feed tabs). */
  enabledWidgets: string[];
  /** Widget IDs whose data appears on the ticker. Subset of enabledWidgets. */
  widgetsOnTicker: string[];
  /** Per-widget pin state: removes the chip from the scrolling ticker and
   *  places it as a static element on the chosen side. Keyed by widget ID. */
  pinnedWidgets: Record<string, WidgetPinConfig>;
  clock: ClockWidgetConfig;
  timer: TimerWidgetConfig;
  weather: WeatherWidgetConfig;
  sysmon: SysmonWidgetConfig;
  uptime: UptimeWidgetConfig;
  github: GitHubWidgetConfig;
}
```

- [ ] **Step 3: Replace defaults with clock-only and timer-owned defaults**

Use these defaults:

```ts
export const DEFAULT_CLOCK_TICKER: ClockTickerConfig = {
  localTime: true,
  showTimezones: false,
  excludedTimezones: [],
};

export const DEFAULT_TIMER_TICKER: TimerTickerConfig = {
  activeTimer: true,
};

export const DEFAULT_TIMER_POMODORO: TimerPomodoroConfig = {
  workMins: 25,
  shortBreakMins: 5,
  longBreakMins: 15,
  longBreakEvery: 4,
};
```

- [ ] **Step 4: Add timer to `DEFAULT_WIDGETS`**

Make the default widget config section look like this:

```ts
const DEFAULT_WIDGETS: WidgetPrefs = {
  enabledWidgets: [],
  widgetsOnTicker: [],
  pinnedWidgets: {},
  clock: {
    ticker: { ...DEFAULT_CLOCK_TICKER },
  },
  timer: {
    ticker: { ...DEFAULT_TIMER_TICKER },
    pomodoro: { ...DEFAULT_TIMER_POMODORO },
  },
  weather: {
    ticker: { ...DEFAULT_WEATHER_TICKER },
  },
  sysmon: {
    refreshInterval: 2,
    tempUnit: "celsius",
    ticker: { ...DEFAULT_SYSMON_TICKER },
  },
  uptime: {
    url: "",
    pollInterval: 60,
    ticker: { ...DEFAULT_UPTIME_TICKER },
  },
  github: {
    repos: [],
    pollInterval: 120,
    ticker: { ...DEFAULT_GITHUB_TICKER },
  },
};
```

- [ ] **Step 5: Migrate saved timer prefs in `mergeWidgetPrefs`**

Inside `mergeWidgetPrefs`, add `tmr` and build timer from either saved timer prefs or legacy clock prefs:

```ts
const clk = obj(saved.clock);
const tmr = obj(saved.timer);
const wth = obj(saved.weather);
const sys = obj(saved.sysmon);
const upt = obj(saved.uptime);
const ghb = obj(saved.github);
const legacyClockTicker = obj(clk?.ticker);
```

Then return clock and timer like this:

```ts
clock: {
  ticker: { ...DEFAULT_CLOCK_TICKER, ...legacyClockTicker },
},
timer: {
  ticker: {
    ...DEFAULT_TIMER_TICKER,
    activeTimer:
      typeof obj(tmr?.ticker)?.activeTimer === "boolean"
        ? Boolean(obj(tmr?.ticker)?.activeTimer)
        : typeof legacyClockTicker?.activeTimer === "boolean"
          ? Boolean(legacyClockTicker.activeTimer)
          : DEFAULT_TIMER_TICKER.activeTimer,
  },
  pomodoro: {
    ...DEFAULT_TIMER_POMODORO,
    ...obj(clk?.pomodoro),
    ...obj(tmr?.pomodoro),
  },
},
```

After this edit, remove any references to `ClockPomodoroConfig` and `DEFAULT_CLOCK_POMODORO` from `preferences.ts`.

- [ ] **Step 6: Run TypeScript build to expose dependent errors**

Run: `npm run build`

Working directory: `desktop/`

Expected: FAIL with TypeScript errors in clock config, widget ticker data, and timer imports because the rest of the split has not been implemented yet.

- [ ] **Step 7: Commit preference migration**

```bash
git add desktop/src/preferences.ts
git commit -m "refactor(desktop): add timer widget preferences"
```

---

### Task 2: Split Clock And Timer Ticker Data

**Files:**
- Modify: `desktop/src/types/index.ts`
- Modify: `desktop/src/hooks/useWidgetTickerData.ts`

- [ ] **Step 1: Add `timer` to widget ticker data**

In `desktop/src/types/index.ts`, update `WidgetTickerData`:

```ts
export interface WidgetTickerData {
  clock: ClockChipData[];
  timer: ClockChipData[];
  weather: WeatherChipData[];
  sysmon: SysmonChipData[];
  uptime: UptimeChipData[];
  github: GitHubChipData[];
}
```

- [ ] **Step 2: Update empty ticker data**

In `desktop/src/hooks/useWidgetTickerData.ts`, change `EMPTY`:

```ts
const EMPTY: WidgetTickerData = { clock: [], timer: [], weather: [], sysmon: [], uptime: [], github: [] };
```

- [ ] **Step 3: Split `buildClockChips` so it only builds clocks**

Replace the existing `buildClockChips` with:

```ts
const buildClockChips = useCallback((): ClockChipData[] => {
  if (!enabledWidgets.has("clock")) return [];
  const cfg = widgetPrefs.clock;
  const chips: ClockChipData[] = [];
  const now = new Date();
  const format = getStore<string>(LS_CLOCK_FORMAT, "12h");

  if (cfg.ticker.localTime) {
    chips.push({
      id: "clock-local",
      kind: "clock",
      label: "Local",
      value: formatTime(now, undefined, format),
      detail: formatDetail(now, undefined),
    });
  }

  if (cfg.ticker.showTimezones) {
    const tzs = getStore<string[]>(LS_CLOCK_TIMEZONES, []);
    for (const tz of Array.isArray(tzs) ? tzs : []) {
      if (cfg.ticker.excludedTimezones.includes(tz)) continue;
      chips.push({
        id: `clock-${tz}`,
        kind: "clock",
        label: tzShortLabel(tz),
        value: formatTime(now, tz, format),
        detail: formatDetail(now, tz),
      });
    }
  }

  return chips;
}, [widgetPrefs.clock, enabledWidgets]);
```

- [ ] **Step 4: Add `buildTimerChips`**

Add this directly after `buildClockChips`:

```ts
const buildTimerChips = useCallback((): ClockChipData[] => {
  if (!enabledWidgets.has("timer")) return [];
  if (!widgetPrefs.timer.ticker.activeTimer) return [];

  const state = getStore<TimerState | null>(LS_TIMER_STATE, null);
  if (!state) return [];

  const chip = getTimerChipData(state);
  return chip ? [chip] : [];
}, [widgetPrefs.timer, enabledWidgets]);
```

- [ ] **Step 5: Include timer in the returned ticker data**

In the effect that calls all builders, set `timer: buildTimerChips()` next to `clock: buildClockChips()`:

```ts
setData({
  clock: buildClockChips(),
  timer: buildTimerChips(),
  weather: buildWeatherChips(),
  sysmon: buildSysmonChips(),
  uptime: buildUptimeChips(),
  github: buildGitHubChips(),
});
```

Add `buildTimerChips` to that effect's dependency list.

- [ ] **Step 6: Keep timer state store subscriptions**

Keep `LS_TIMER_STATE` in the store-change listener list in `useWidgetTickerData.ts`. This keeps timer ticker chips updating when Timer writes runtime state.

- [ ] **Step 7: Run TypeScript build**

Run: `npm run build`

Working directory: `desktop/`

Expected: FAIL only on remaining widget split/config import errors. There should be no `WidgetTickerData` missing-property error.

- [ ] **Step 8: Commit ticker split**

```bash
git add desktop/src/types/index.ts desktop/src/hooks/useWidgetTickerData.ts
git commit -m "refactor(desktop): split timer ticker data from clock"
```

---

### Task 3: Create Independent Timer Widget Module

**Files:**
- Create: `desktop/src/widgets/timer/types.ts`
- Create: `desktop/src/widgets/timer/Timer.tsx`
- Create: `desktop/src/widgets/timer/FeedTab.tsx`
- Create: `desktop/src/widgets/timer/ConfigPanel.tsx`
- Modify: `desktop/src/widgets/registry.ts`
- Modify: `desktop/src/widgets/WidgetConfigPanel.tsx`
- Modify: `desktop/src/widgets/clock/types.ts`
- Modify: `desktop/src/widgets/clock/FeedTab.tsx`

- [ ] **Step 1: Create timer types**

Create `desktop/src/widgets/timer/types.ts`:

```ts
export type TimerMode = "pomodoro" | "countdown" | "stopwatch";

export interface TimerState {
  mode: TimerMode;
  startedAt: number | null;
  bankedMs: number;
  targetSecs: number;
  completedSessions: number;
}
```

- [ ] **Step 2: Move Timer implementation**

Move the current contents of `desktop/src/widgets/clock/Timer.tsx` into `desktop/src/widgets/timer/Timer.tsx` and update imports:

```ts
import { useState, useEffect, useCallback, useRef } from "react";
import { LS_TIMER_STATE } from "../../constants";
import { getStore, setStore } from "../../lib/store";
import type { TimerMode, TimerState } from "./types";
```

Replace the hard-coded `TIMER_KEY` constant with:

```ts
const TIMER_KEY = LS_TIMER_STATE;
```

- [ ] **Step 3: Remove timer types from clock types**

Change `desktop/src/widgets/clock/types.ts` to contain only:

```ts
export type TimeFormat = "12h" | "24h";

export interface TimezoneEntry {
  tz: string;
  label: string;
  region: string;
}
```

- [ ] **Step 4: Update ticker data type import**

In `desktop/src/hooks/useWidgetTickerData.ts`, change the timer type import:

```ts
import type { TimerState } from "../widgets/timer/types";
```

- [ ] **Step 5: Create Timer feed manifest**

Create `desktop/src/widgets/timer/FeedTab.tsx`:

```tsx
import { TimerReset } from "lucide-react";
import { Timer } from "./Timer";
import type { FeedTabProps, WidgetManifest } from "../../types";

export const timerWidget: WidgetManifest = {
  id: "timer",
  name: "Timer",
  tabLabel: "Timer",
  description: "Pomodoro, countdown, and stopwatch tools",
  hex: "#f59e0b",
  icon: TimerReset,
  info: {
    about:
      "The Timer widget provides Pomodoro sessions, countdown timers, and a stopwatch as a focused desktop control surface.",
    usage: [
      "Choose Pomodoro, Countdown, or Stopwatch from the mode selector.",
      "Use Space to start or pause and R to reset while the timer feed is focused.",
      "Enable active timer ticker output in the Configure tab.",
      "Adjust Pomodoro session lengths and long-break cadence in Configure.",
    ],
  },
  FeedTab: TimerFeedTab,
};

function TimerFeedTab({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <Timer compact={mode === "compact"} />
    </div>
  );
}
```

- [ ] **Step 6: Create Timer config panel**

Create `desktop/src/widgets/timer/ConfigPanel.tsx`:

```tsx
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  SliderRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { DEFAULT_TIMER_TICKER, DEFAULT_TIMER_POMODORO } from "../../preferences";
import type { TimerPomodoroConfig } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const LONG_BREAK_OPTIONS = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

export default function TimerConfigPanel({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("timer", prefs, onPrefsChange);

  const setPomodoro = useCallback(
    (patch: Partial<TimerPomodoroConfig>) => {
      update({ pomodoro: { ...config.pomodoro, ...patch } });
    },
    [update, config.pomodoro],
  );

  const resetAll = useCallback(() => {
    update({
      ticker: { ...DEFAULT_TIMER_TICKER },
      pomodoro: { ...DEFAULT_TIMER_POMODORO },
    });
  }, [update]);

  const timerIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-widget-timer)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2h4" />
      <path d="M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );

  return (
    <ConfigPanelLayout
      icon={timerIcon}
      hex="var(--color-widget-timer)"
      title="Timer Settings"
      subtitle="Pomodoro, countdown, and stopwatch"
      onReset={resetAll}
    >
      <Section title="Ticker">
        <ToggleRow
          label="Active timer"
          description="Show running or paused timers on the scrolling ticker"
          checked={config.ticker.activeTimer}
          onChange={(v) => setTicker({ activeTimer: v })}
        />
        <TickerPinSection widgetId="timer" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

      <Section title="Pomodoro">
        <SliderRow
          label="Work session"
          value={config.pomodoro.workMins}
          min={10}
          max={60}
          step={5}
          displayValue={`${config.pomodoro.workMins} min`}
          onChange={(v) => setPomodoro({ workMins: v })}
        />
        <SliderRow
          label="Short break"
          value={config.pomodoro.shortBreakMins}
          min={1}
          max={15}
          step={1}
          displayValue={`${config.pomodoro.shortBreakMins} min`}
          onChange={(v) => setPomodoro({ shortBreakMins: v })}
        />
        <SliderRow
          label="Long break"
          value={config.pomodoro.longBreakMins}
          min={5}
          max={30}
          step={5}
          displayValue={`${config.pomodoro.longBreakMins} min`}
          onChange={(v) => setPomodoro({ longBreakMins: v })}
        />
        <SegmentedRow
          label="Long break every"
          description="Sessions before a long break"
          value={String(config.pomodoro.longBreakEvery)}
          options={LONG_BREAK_OPTIONS}
          onChange={(v) => setPomodoro({ longBreakEvery: Number(v) })}
        />
      </Section>
    </ConfigPanelLayout>
  );
}
```

- [ ] **Step 7: Route Timer config panel**

In `desktop/src/widgets/WidgetConfigPanel.tsx`, add the import:

```ts
import TimerConfigPanel from "./timer/ConfigPanel";
```

Add the switch case after `clock`:

```tsx
case "timer":
  return (
    <TimerConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
  );
```

- [ ] **Step 8: Register Timer as a peer widget**

In `desktop/src/widgets/registry.ts`, update order:

```ts
["clock", "timer", "weather", "sysmon", "uptime", "github"],
```

- [ ] **Step 9: Replace Clock feed with clock-only manifest**

Replace `desktop/src/widgets/clock/FeedTab.tsx` with:

```tsx
import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
import type { FeedTabProps, WidgetManifest } from "../../types";

export const clockWidget: WidgetManifest = {
  id: "clock",
  name: "Clock",
  tabLabel: "Clock",
  description: "Local time and world clocks",
  hex: "#6366f1",
  icon: Clock,
  info: {
    about:
      "The Clock widget displays your local time and world clocks for tracking multiple time zones.",
    usage: [
      "Your local time appears in the Clock feed and can appear on the ticker.",
      "Add world clocks from the feed view to track more time zones.",
      "Turn on world clocks in Configure to include selected time zones on the ticker.",
      "Use the 12h/24h control to change clock formatting.",
    ],
  },
  FeedTab: ClockFeedTab,
};

function ClockFeedTab({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <WorldClock compact={mode === "compact"} />
    </div>
  );
}
```

- [ ] **Step 10: Remove old clock timer file**

Delete `desktop/src/widgets/clock/Timer.tsx` after `desktop/src/widgets/timer/Timer.tsx` exists and imports have been updated.

- [ ] **Step 11: Run TypeScript build**

Run: `npm run build`

Working directory: `desktop/`

Expected: FAIL only on Clock config references to removed timer settings, or PASS if Task 4 has already been done in the same branch.

- [ ] **Step 12: Commit widget module split**

```bash
git add desktop/src/widgets desktop/src/hooks/useWidgetTickerData.ts desktop/src/types/index.ts
git commit -m "refactor(desktop): split timer into its own widget"
```

---

### Task 4: Make Clock Config Clock-Only

**Files:**
- Modify: `desktop/src/widgets/clock/ConfigPanel.tsx`

- [ ] **Step 1: Remove timer-owned imports**

Use these imports at the top:

```tsx
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { DEFAULT_CLOCK_TICKER } from "../../preferences";
import { LS_CLOCK_FORMAT, LS_CLOCK_TIMEZONES } from "../../constants";
import { loadTimezones, loadFormat, tzLabel } from "./storage";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";
```

- [ ] **Step 2: Remove Pomodoro state/update logic**

Delete `LONG_BREAK_OPTIONS`, the `ClockPomodoroConfig` type import, and the `setPomodoro` callback.

- [ ] **Step 3: Reset only clock settings**

Use this `resetAll` callback:

```ts
const resetAll = useCallback(() => {
  update({
    ticker: { ...DEFAULT_CLOCK_TICKER },
  });
  setStore(LS_CLOCK_FORMAT, "12h");
  setFormatState("12h");
}, [update]);
```

- [ ] **Step 4: Update panel copy**

Use this layout header:

```tsx
<ConfigPanelLayout
  icon={clockIcon}
  hex="var(--color-widget-clock)"
  title="Clock Settings"
  subtitle="Local time and world clocks"
  onReset={resetAll}
>
```

- [ ] **Step 5: Remove Active Timer and Pomodoro sections**

Keep only the Ticker section with time format, local time, show world clocks, timezone toggles, and clock pin section:

```tsx
<Section title="Ticker">
  <SegmentedRow
    label="Time format"
    description="12-hour or 24-hour clock"
    value={format}
    options={FORMAT_OPTIONS}
    onChange={handleFormatChange}
  />
  <ToggleRow
    label="Local time"
    description="Show your local clock on the scrolling ticker"
    checked={config.ticker.localTime}
    onChange={(v) => setTicker({ localTime: v })}
  />
  <ToggleRow
    label="Show world clocks"
    description="Include configured timezones on the ticker"
    checked={config.ticker.showTimezones}
    onChange={(v) => setTicker({ showTimezones: v })}
  />
  {config.ticker.showTimezones && timezones.map((tz) => (
    <ToggleRow
      key={tz}
      label={tzLabel(tz)}
      checked={!isTimezoneExcluded(tz)}
      onChange={() => toggleTimezone(tz)}
    />
  ))}
  {config.ticker.showTimezones && timezones.length === 0 && (
    <div className="px-3 py-2.5 text-[11px] text-fg-4">
      Add world clocks in the Clock tab to see them here.
    </div>
  )}
  <TickerPinSection widgetId="clock" prefs={prefs} onPrefsChange={onPrefsChange} />
</Section>
```

- [ ] **Step 6: Run TypeScript build**

Run: `npm run build`

Working directory: `desktop/`

Expected: PASS if Tasks 1-3 are complete and no UI polish task has introduced errors.

- [ ] **Step 7: Commit clock config cleanup**

```bash
git add desktop/src/widgets/clock/ConfigPanel.tsx
git commit -m "refactor(desktop): make clock config clock-only"
```

---

### Task 5: Polish Clock And Timer Feed UI

**Files:**
- Modify: `desktop/src/widgets/clock/WorldClock.tsx`
- Modify: `desktop/src/widgets/timer/Timer.tsx`

- [ ] **Step 1: Make Clock feed feel dashboard-like**

In `WorldClock.tsx`, keep the existing state/storage logic. Adjust `ClockCard` comfort-mode classes so the local card is the hero card and world clock cards are quieter:

```tsx
className={
  "group relative overflow-hidden px-4 py-3 rounded-xl border transition-colors " +
  (isLocal
    ? "bg-widget-clock/[0.07] border-widget-clock/25 shadow-[inset_0_1px_0_0_rgba(99,102,241,0.12)]"
    : "bg-surface-2/70 border-widget-clock/10 hover:border-widget-clock/25")
}
```

For the local card, render the local badge and offset exactly as it does now, but ensure the main time remains the largest visual element:

```tsx
<div className={isLocal ? "text-2xl font-mono font-bold text-fg tabular-nums leading-none" : "text-xl font-mono font-bold text-fg tabular-nums leading-none"}>
  {time}
</div>
```

- [ ] **Step 2: Make Clock compact rows match other widget rows**

In compact `ClockCard`, use this row class:

```tsx
className="group flex items-center justify-between px-3 py-2 rounded-lg bg-widget-clock/[0.04] border border-widget-clock/10 hover:border-widget-clock/25 transition-colors"
```

Keep the existing remove button, offset, label, and time behavior.

- [ ] **Step 3: Keep Clock picker empty states explicit**

Verify `WorldClock.tsx` still renders these strings unchanged:

```tsx
{search ? "No matching cities" : "All timezones added"}
```

- [ ] **Step 4: Make Timer compact card include mode label**

In `Timer.tsx` compact mode, add a small mode label next to the display time:

```tsx
<div className="flex flex-col min-w-0">
  <span className="text-[10px] font-mono uppercase tracking-wider text-widget-timer/70">
    {state.mode === "pomodoro" ? "Pomodoro" : state.mode === "countdown" ? "Countdown" : "Stopwatch"}
  </span>
  <span
    className={`text-lg font-mono font-bold tabular-nums ${isComplete ? "text-widget-timer" : "text-fg"}`}
  >
    {displayTime}
  </span>
</div>
```

- [ ] **Step 5: Wrap Timer comfort display in an active card**

In `Timer.tsx` comfort mode, wrap the display section in this shell:

```tsx
<div className="rounded-2xl border border-widget-timer/15 bg-widget-timer/[0.04] px-4 py-5 shadow-[inset_0_1px_0_0_rgba(245,158,11,0.08)]">
  <div className="flex flex-col items-center">
    {/* existing circular progress or stopwatch display */}
  </div>
</div>
```

Do not change timer behavior in this step.

- [ ] **Step 6: Run TypeScript build**

Run: `npm run build`

Working directory: `desktop/`

Expected: PASS.

- [ ] **Step 7: Commit feed UI polish**

```bash
git add desktop/src/widgets/clock/WorldClock.tsx desktop/src/widgets/timer/Timer.tsx
git commit -m "style(desktop): refine clock and timer widget UI"
```

---

### Task 6: Final Verification

**Files:**
- Verify: `desktop/src/widgets/registry.ts`
- Verify: `desktop/src/widgets/WidgetConfigPanel.tsx`
- Verify: `desktop/src/hooks/useWidgetTickerData.ts`
- Verify: `desktop/src/preferences.ts`
- Verify: `desktop/src/widgets/clock/FeedTab.tsx`
- Verify: `desktop/src/widgets/timer/FeedTab.tsx`

- [ ] **Step 1: Run desktop build**

Run: `npm run build`

Working directory: `desktop/`

Expected: PASS with Vite build output and `tsc --noEmit` completing successfully.

- [ ] **Step 2: Search for legacy combined-widget references**

Run: `rg "ClockTab|clock/Timer|activeTimer|DEFAULT_CLOCK_POMODORO|ClockPomodoroConfig|timer tab|timers" desktop/src`

Expected: Only legitimate timer-owned references remain. There should be no `ClockTab`, no `clock/Timer`, no `DEFAULT_CLOCK_POMODORO`, no `ClockPomodoroConfig`, and no Clock widget copy claiming it owns timers.

- [ ] **Step 3: Confirm registry/config ownership by reading exact files**

Check that `desktop/src/widgets/registry.ts` contains:

```ts
["clock", "timer", "weather", "sysmon", "uptime", "github"],
```

Check that `desktop/src/widgets/WidgetConfigPanel.tsx` has both cases:

```tsx
case "clock":
  return (
    <ClockConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
  );
case "timer":
  return (
    <TimerConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
  );
```

- [ ] **Step 4: Confirm ticker ownership by reading exact code**

Check that `desktop/src/hooks/useWidgetTickerData.ts` returns independent arrays:

```ts
setData({
  clock: buildClockChips(),
  timer: buildTimerChips(),
  weather: buildWeatherChips(),
  sysmon: buildSysmonChips(),
  uptime: buildUptimeChips(),
  github: buildGitHubChips(),
});
```

- [ ] **Step 5: Commit final verification cleanup if needed**

If verification required fixes, commit them:

```bash
git add desktop/src
git commit -m "fix(desktop): complete clock timer widget split"
```

If verification required no fixes, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Independent widget architecture is covered by Tasks 1, 3, and 4.
- Clock UI direction is covered by Tasks 3, 4, and 5.
- Timer UI direction is covered by Tasks 3 and 5.
- Ticker ownership is covered by Task 2 and verified in Task 6.
- Preference migration is covered by Task 1.
- Error handling and empty states are preserved in Tasks 3 and 5.
- Build/manual verification is covered by Task 6.

Placeholder scan: no placeholder markers or unspecified implementation steps remain.

Type consistency: timer preferences use `TimerTickerConfig`, `TimerPomodoroConfig`, and `TimerWidgetConfig`; runtime timer state uses `TimerState` from `desktop/src/widgets/timer/types.ts`; ticker data uses `WidgetTickerData.timer`.
