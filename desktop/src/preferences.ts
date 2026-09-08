// ── Preferences system ──────────────────────────────────────────
// Centralized types, defaults, and helpers for all desktop settings.
// All prefs are persisted via Tauri plugin-store (disk-backed).

import { getStore, removeStore, setStore } from "./lib/store";
import { LS_CLOCK_FORMAT, LS_WEATHER_UNIT } from "./constants";

// ── Types ────────────────────────────────────────────────────────

/**
 * Color mode controls light/dark resolution, independent of the
 * selected theme family. "system" follows the OS preference.
 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * The ten built-in theme families. Each family carries its own light
 * and dark palette in `style.css`, applied via
 * `data-theme="<family>-<resolved-mode>"`.
 */
export type ThemeFamily =
  | "scrollr"
  | "catppuccin"
  | "dracula"
  | "tokyo-night"
  | "nord"
  | "gruvbox"
  | "solarized"
  | "rose-pine"
  | "one"
  | "everforest";

export const THEME_FAMILIES: ThemeFamily[] = [
  "scrollr",
  "catppuccin",
  "dracula",
  "tokyo-night",
  "nord",
  "gruvbox",
  "solarized",
  "rose-pine",
  "one",
  "everforest",
];

/** Display label for the theme family selector. */
export const THEME_FAMILY_LABELS: Record<ThemeFamily, string> = {
  scrollr: "Scrollr",
  catppuccin: "Catppuccin",
  dracula: "Dracula",
  "tokyo-night": "Tokyo Night",
  nord: "Nord",
  gruvbox: "Gruvbox",
  solarized: "Solarized",
  "rose-pine": "Rose Pine",
  one: "One",
  everforest: "Everforest",
};

export function isThemeFamily(value: unknown): value is ThemeFamily {
  return (
    typeof value === "string" && (THEME_FAMILIES as string[]).includes(value)
  );
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}
// Stored values match their labels on the Ticker page (REL-207). The
// old spellings — comfort, weave, accent/muted, step/flip — are mapped
// forward in `migrateTicker`.
export type TickerMode = "compact" | "detailed";
export type MixMode = "grouped" | "mixed";
export type ChipColorMode = "widget" | "theme" | "subtle";
/** Rotate ("flip") folded into Page 2026-09-06 (REL-204). */
export type ScrollMode = "continuous" | "page";
/** What the bar does under the mouse. Continuous: keep / slow to 30 % /
 *  stop. Page: keep advancing / hold the page (slow and pause alike). */
export type HoverBehavior = "keep" | "slow" | "pause";
export type PinSide = "left" | "right";

export type FontWeight = "normal" | "medium" | "bold";

export interface AppearancePrefs {
  /**
   * Color mode for the active theme family. `system` follows the OS.
   * Renamed from the legacy `theme` field; see migration in
   * `loadPrefs` / `migrateAppearance`.
   */
  themeMode: ThemeMode;
  /**
   * Selected theme family (color palette identity). Combines with
   * `themeMode` at runtime to form the `data-theme` attribute, e.g.
   * `data-theme="catppuccin-dark"`.
   */
  themeFamily: ThemeFamily;
  /**
   * App-window zoom, one of `SCALE_PRESETS`. Older builds allowed any
   * of 75–150; `snapToPreset` folds those onto the nearest preset on
   * load so the App size control always has something selected.
   */
  uiScale: number;
  /**
   * Independent zoom for the ticker window (75–150, default 100). Lets
   * users size the ticker chips without affecting the main app, and
   * vice versa. Seeded from `uiScale` on first load after upgrade so
   * existing users keep their current scale.
   */
  tickerScale: number;
  fontWeight: FontWeight;
  highContrast: boolean;
  /** App-wide units — read by the Weather, Sysmon and Clock widgets. */
  units: UnitsPrefs;
}

export type TempUnit = "celsius" | "fahrenheit";
export type TimeFormat = "12h" | "24h";

export interface UnitsPrefs {
  temperature: TempUnit;
  timeFormat: TimeFormat;
}

/**
 * Units used to live in three places: the Weather bar wrote
 * `LS_WEATHER_UNIT`, the Clock bar `LS_CLOCK_FORMAT`, and the Sysmon
 * bar `widgets.sysmon.tempUnit`. One-shot fold into `appearance.units`
 * (REL-205). A saved block wins; otherwise Weather's key decides the
 * temperature. Sysmon's stored value is ignored on purpose: its default
 * ("celsius") was written to disk for everyone, so it cannot tell a
 * choice from a default, and Weather was what most people looked at.
 */
export function migrateUnits(
  saved: unknown,
  legacy: { weather?: unknown; clock?: unknown },
): UnitsPrefs {
  const s = (saved ?? {}) as Partial<Record<keyof UnitsPrefs, unknown>>;
  const isTemp = (v: unknown): v is TempUnit =>
    v === "celsius" || v === "fahrenheit";
  const isTime = (v: unknown): v is TimeFormat => v === "12h" || v === "24h";
  return {
    temperature: isTemp(s.temperature)
      ? s.temperature
      : isTemp(legacy.weather)
        ? legacy.weather
        : "fahrenheit",
    timeFormat: isTime(s.timeFormat)
      ? s.timeFormat
      : isTime(legacy.clock)
        ? legacy.clock
        : "12h",
  };
}

export interface TickerPrefs {
  showTicker: boolean;
  /** px/s; one of TICKER_SPEEDS (Slow / Normal / Fast on the page). */
  tickerSpeed: number;
  onHover: HoverBehavior;
  tickerMode: TickerMode;
  mixMode: MixMode;
  chipColors: ChipColorMode;
  scrollMode: ScrollMode;
  /** Seconds each page stays put; one of STEP_PAUSES (Page mode only). */
  stepPause: number;
}

// The Ticker page offers presets, never raw numbers (SETTINGS_AUDIT §3).
// The prefs stay numbers so nothing downstream changes; a value off the
// list (an old slider position) is snapped to the nearest preset on load.
export const TICKER_SPEEDS = { slow: 20, normal: 40, fast: 80 } as const;
export const STEP_PAUSES = [3, 5, 8] as const;
export const SCALE_PRESETS = [85, 100, 115, 130] as const;

export function snapToPreset(
  value: unknown,
  presets: readonly number[],
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return presets.reduce((best, p) =>
    Math.abs(p - value) < Math.abs(best - value) ? p : best,
  );
}

export interface StartupPrefs {
  /**
   * When true, launching Scrollr brings up the ticker only; the main
   * window stays hidden until the tray's "Open Scrollr", a second
   * launch, or the dock shows it. Read by the Rust side at setup
   * (lib.rs) straight from the store file, so the window never flashes.
   * Defaults to false.
   *
   * The only field here. `autoCheckUpdates` (REL-206: the check always
   * runs now), `defaultView`, `refreshInterval` and `autostart` used to
   * sit alongside it and are stripped on load. The real launch-at-login
   * state is owned by the Tauri autostart plugin (see `autostartOn` in
   * routes/__root.tsx), not by this object.
   */
  startInBackground: boolean;
}

export interface PrivacyPrefs {
  /**
   * When false, neither Sentry client (webview or Rust) lets an event
   * leave the machine: `beforeSend` drops it and the SDK is disabled.
   * Defaults to true. See sentry.tsx / lib.rs `set_crash_reports`.
   */
  sendCrashReports: boolean;
}

export type TickerPosition = "top" | "bottom";

export interface WindowPrefs {
  pinned: boolean;
  tickerPosition: TickerPosition;
  /**
   * Windows-only. When true (default), hides the ticker when any
   * fullscreen application appears so the fullscreen content isn't
   * clipped (matches taskbar behavior). When false, ticker stays
   * visible on top of fullscreen apps — content under the ticker
   * gets visually clipped, which is the user's chosen tradeoff.
   * No effect on macOS / Linux.
   */
  hideOnFullscreen: boolean;
  /**
   * Monitor names (from the `list_monitors` command) that get a ticker
   * window, identical content on each. Empty = the primary monitor only,
   * which is what every install did before this existed. Names that are
   * no longer attached are ignored, never an error.
   */
  tickerMonitors: string[];
}

// ── Per-widget config types ─────────────────────────────────────
//
// Only what the user can actually set lives here. The per-widget
// `ticker.excluded*` lists and the clock/timer on-off gates were
// force-reset to their defaults on every load from 2026-07-17 until
// REL-208 removed them: tracked content always reaches the ticker, so
// the readers in useWidgetTickerData no longer consult a pref at all.

export interface TimerPomodoroConfig {
  workMins: number;
  shortBreakMins: number;
  longBreakMins: number;
  longBreakEvery: number;
}

export interface TimerWidgetConfig {
  pomodoro: TimerPomodoroConfig;
}


export interface SysmonTickerConfig {
  cpu: boolean;
  memory: boolean;
  gpu: boolean;
  gpuPower: boolean;
}

export interface SysmonWidgetConfig {
  ticker: SysmonTickerConfig;
}

export interface UptimeWidgetConfig {
  /** The user's Uptime Kuma public status page URL. Empty = not configured. */
  url: string;
}

export interface GitHubWidgetConfig {
  /** Configured repos to track. */
  repos: Array<{ owner: string; repo: string }>;
}

/**
 * One pin on the ticker's fixed zone.
 *
 * A pin attaches to a durable SUBJECT -- a team, a symbol, a feed, a
 * market, a monitor, or a single-chip utility -- never to a widget.
 * The fixed zone shows that subject's current chip, and shows nothing
 * when the subject has nothing to show. Pinning a whole multi-item
 * widget (what `pinnedWidgets` did until REL-239) froze that widget's
 * rotation on its first N items, which is the opposite of what a pin
 * on a glanceable bar should mean.
 *
 * `subject` is the source's own durable id for the thing:
 *   sports      -> team name           ("New York Yankees")
 *   finance     -> symbol              ("AAPL")
 *   rss         -> feed url
 *   predictions -> market id
 *   uptime      -> monitor id          github -> repo id
 *   clock / timer / weather / sysmon -> the widget id itself (one chip)
 */
export interface WidgetPin {
  /** Widget id that owns the subject (sports_mlb, finance_stocks, clock…). */
  widget: string;
  /** The durable thing the pin follows. */
  subject: string;
  side: PinSide;
  /** Reserved for a multi-row bar. Unused today; carried so a stored
   *  value survives a round-trip rather than being silently dropped. */
  row?: number;
}

/**
 * How many subjects the fixed zone will hold.
 *
 * MEASURED, not guessed (CHIP_SPEC §10.2). Real chip widths, fonts
 * loaded, from the §10.3 harness:
 *
 *   clock 1 zone / timer   221      rss feed (long headline)  527
 *   weather 1 city         239      game (MLB)                541
 *   symbol / market /               clock 3 zones             554
 *     monitor / repo       264      weather 3 cities          583
 *                                   game (worst NCAA names)   605
 *                                   sysmon 4 metrics          614
 *                                   any content-sized chip
 *                                     at CHIP_MAX_PX          640
 *
 * Narrowest bar the app runs on: 1280 logical px (a 4K panel at 300%
 * scaling; also a 1280x800 laptop). The zone's own chrome is 17px
 * (px-2 + the divider) and chips sit 8px apart.
 *
 * The tape has to stay a tape: it keeps at least one full-width chip,
 * CHIP_MAX_PX = 640. That leaves the fixed zone 1280 - 640 = 640px.
 * Against the TYPICAL pinned chip (264px -- every fixed-width chip, and
 * a one-zone clock is smaller still):
 *
 *   2 pins -> 264*2 + 8 + 17 = 553  <= 640   fits, 727px of tape
 *   3 pins -> 264*3 + 16 + 17 = 825  > 640   tape drops to 455px,
 *                                            less than one chip wide
 *
 * So: two. Accepted cost (§8.6): the cap is on COUNT, not width, so two
 * pinned wide chips (a game plus a four-metric sysmon, 541 + 614) still
 * overrun a 1280px bar. Capping width instead would mean truncating a
 * pinned chip, which §1.2 forbids outright.
 *
 * A pin past the cap is REFUSED -- the zone never evicts something the
 * user deliberately parked there.
 */
export const MAX_PINS = 2;

/** Widgets whose ticker chip is a single chip for the whole widget, so
 *  the widget IS the subject. Everything else pins per item. */
export const SINGLE_CHIP_WIDGETS = ["clock", "timer", "weather", "sysmon"] as const;

export function isSingleChipWidget(widgetId: string): boolean {
  return (SINGLE_CHIP_WIDGETS as readonly string[]).includes(widgetId);
}

export interface WidgetPrefs {
  /** Widget IDs that are enabled (shown in sidebar and feed tabs). */
  enabledWidgets: string[];
  /** User-defined order for all enabled sidebar widgets. */
  sidebarOrder: string[];
  /** Widget IDs whose data appears on the ticker. Subset of enabledWidgets. */
  widgetsOnTicker: string[];
  /** The fixed zone, in render order. Each entry pins one SUBJECT, whose
   *  current chip is lifted out of the scrolling tape (REL-239). */
  pins: WidgetPin[];
  timer: TimerWidgetConfig;
  sysmon: SysmonWidgetConfig;
  uptime: UptimeWidgetConfig;
  github: GitHubWidgetConfig;
}

// ── DataWidgetRow display preferences ─────────────────────────────────
// Controls what data is shown in FeedTabs and ticker chips.
// Sports display prefs live server-side (useSportsConfig), not here.

/**
 * Four-state visibility control for widget display settings.
 *
 *   off     — hidden everywhere
 *   feed    — shown on the feed page only; hidden from the ticker
 *   both    — shown in both places (default for migrated `true` booleans)
 *   ticker  — shown on the always-on-top ticker only; hidden from the feed
 *
 * Nothing reads a Venue any more: the last per-item toggles (fantasy's
 * Advanced block) went in REL-208, and the ticker shows a fixed set per
 * source (docs/CHIP_SPEC.md §8). The type survives only so the sports
 * migration can coerce the legacy `showUpcoming` / `showFinal` booleans.
 */
export type Venue = "off" | "feed" | "both" | "ticker";

/**
 * Fantasy ticker simplicity dial; see FantasyDisplayPrefs.tickerMode.
 *
 * Named for the widget because `TickerMode` is already taken by the
 * ticker's density setting (compact | detailed) — a genuinely different
 * axis that happens to want the same word.
 */
export type FantasyTickerMode = "essential" | "standard" | "everything";

/**
 * Coerce a saved value (boolean from the pre-v1.0.2 era, or any other
 * shape the prefs file might have) into a well-formed `Venue`.
 *
 *   true  → "both"   (keep visible everywhere; matches "Conservative"
 *                     migration option from the spec brainstorm)
 *   false → "off"    (preserve hide-everywhere behavior exactly)
 *   other → "both"   (unknown / new setting → default visible)
 */
export function migrateVenue(raw: unknown): Venue {
  if (raw === true) return "both";
  if (raw === false) return "off";
  return oneOf(raw, ["off", "feed", "both", "ticker"], "both");
}

/**
 * Coerce a persisted value to one of `allowed`, falling back when the prefs
 * file holds something stale, hand-edited, or from a future version.
 *
 * Every `migrate*Display` field below routes through this rather than an
 * inline `raw.x === "a" || raw.x === "b" ? …` chain — those were written
 * four different ways across the four migrations, and one of them (finance's
 * `defaultSort`) was a bare cast that validated nothing.
 */
function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export interface FinanceDisplayPrefs {
  defaultSort: "alpha" | "price" | "change" | "updated";
}

export interface PredictionsDisplayPrefs {
  /**
   * v1.1.5: drives the TICKER's no-stars fallback ordering (the feed is
   * lens-driven and owns its own ordering). "trending" = trailing-24h
   * volume; legacy saved "volume" values migrate to it.
   */
  defaultSort: "trending" | "movers" | "closing" | "alpha";
}

export interface RssDisplayPrefs {
  /** Sticky feed sort (2026-07-17 unification): the bar's sort choice
   *  persists per widget via the config.display override; this is the
   *  global fallback. */
  feedSort: "newest" | "oldest";
  /** Maximum eligible articles shown in the feed. 0 = all. */
  maxArticles: number;
  /** v1.1.3 Time Controls: hide articles older than N days (published_at,
   *  falling back to created_at). 0 = no age filter — every article the
   *  server sends, which is the pre-v1.1.3 behavior. */
  maxArticleAgeDays: number;
}

export type FantasySubTab = "overview" | "matchup" | "standings" | "roster";

export interface FantasyDisplayPrefs {
  // ── Followed players (Phase 2, 2026-04-25) ──
  /**
   * Yahoo player_keys the user wants surfaced as their own dedicated
   * ticker chips, separate from the league-summary chips. Use case:
   * track specific players (CMC, Mahomes) live without parsing
   * league-summary segments. Each entry renders one
   * `FollowedPlayerChip` next to the league chips in the ticker.
   *
   * Stored as an array (not a Set) so the JSON round-trips cleanly
   * through the prefs store. Order is preservation-only (no inherent
   * meaning to position).
   *
   * Empty array = no followed players, no chips render.
   */
  followedPlayerKeys: string[];

  // ── Ticker simplicity dial (2026-08) ──
  /**
   * How much of the fantasy story reaches the ticker. Each position is
   * a fixed set built in ticker.tsx — there is no per-item control
   * underneath it any more (REL-208; docs/CHIP_SPEC.md §8).
   *
   *   essential  — one smart chip per league, nothing else
   *   standard   — + live moment chips (in-play, breaking injury).
   *                THE DEFAULT for fresh installs.
   *   everything — + top scorers, worst starter, bench top, injury report
   *
   * Followed players are deliberately outside the dial — an explicit
   * opt-in shouldn't be silently dropped by a simplicity setting.
   */
  tickerMode: FantasyTickerMode;

  /** Which sub-tab the Feed view opens on. Defaults to overview when in 2+ leagues, matchup otherwise. */
  defaultSubTab: FantasySubTab;
  /** The user-preferred "primary" league key shown as the hero in Overview/Matchup tabs. */
  primaryLeagueKey: string | null;
  /** Explicit list of league keys the user wants visible. Empty array means "all imported leagues". */
  enabledLeagueKeys: string[];
}

export interface WidgetDisplayPrefs {
  finance: FinanceDisplayPrefs;
  rss: RssDisplayPrefs;
  fantasy: FantasyDisplayPrefs;
  predictions: PredictionsDisplayPrefs;
}

/**
 * Per-widget homepage preview filter.
 *
 * Keys are group identifiers: symbols for finance, league names for
 * sports, source names for rss, and league keys for fantasy.
 * An empty array means "auto" — use default sort/slice.
 */
export interface AppPreferences {
  appearance: AppearancePrefs;
  ticker: TickerPrefs;
  startup: StartupPrefs;
  privacy: PrivacyPrefs;
  window: WindowPrefs;
  widgets: WidgetPrefs;
  widgetDisplay: WidgetDisplayPrefs;
  /**
   * IDs of one-time discovery tips the user has already seen.
   *
   * Phase 2 (Apr 26): the desktop app introduces a `showTipOnce(id)`
   * pattern (see `lib/tips.ts`) for "did you know you can right-click
   * the ticker?"-style nudges that should fire exactly once per user
   * across the lifetime of their install. We store ids (not booleans)
   * so we can add new tips later without a schema migration — every
   * fresh tip id is implicitly "not shown yet" until the user sees it.
   *
   * Storing as an array (not Set) for JSON-roundtrip cleanliness.
   */
  tipsShown: string[];
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULT_APPEARANCE: AppearancePrefs = {
  themeFamily: "scrollr",
  themeMode: "system",
  uiScale: 100,
  tickerScale: 100,
  fontWeight: "normal",
  highContrast: false,
  units: { temperature: "fahrenheit", timeFormat: "12h" },
};

const DEFAULT_TICKER: TickerPrefs = {
  showTicker: true,
  tickerSpeed: TICKER_SPEEDS.normal,
  onHover: "slow",
  tickerMode: "detailed",
  mixMode: "mixed",
  chipColors: "widget",
  scrollMode: "continuous",
  stepPause: 5,
};

const DEFAULT_STARTUP: StartupPrefs = {
  startInBackground: false,
};

const DEFAULT_PRIVACY: PrivacyPrefs = {
  sendCrashReports: true,
};

const DEFAULT_WINDOW: WindowPrefs = {
  pinned: true,
  tickerPosition: "top",
  hideOnFullscreen: true,
  tickerMonitors: [],
};

export const DEFAULT_TIMER_POMODORO: TimerPomodoroConfig = {
  workMins: 25,
  shortBreakMins: 5,
  longBreakMins: 15,
  longBreakEvery: 4,
};

// All-on since the 2026-07-17 unification: the stat toggles are content
// selection and gate BOTH the feed cards and the ticker chips, so
// defaults must match what the feed always showed (everything the
// hardware has). Sysmon is the one widget that kept a ticker sub-config.
export const DEFAULT_SYSMON_TICKER: SysmonTickerConfig = {
  cpu: true,
  memory: true,
  gpu: true,
  gpuPower: true,
};

export const DEFAULT_WIDGET_DISPLAY: WidgetDisplayPrefs = {
  finance: {
    defaultSort: "alpha",
  },
  rss: {
    feedSort: "newest",
    maxArticles: 0,
    maxArticleAgeDays: 0,
  },
  predictions: {
    defaultSort: "trending",
  },
  fantasy: {
    followedPlayerKeys: [],
    // Standard, not Essential: the smart league chip tells you a league
    // is live but not WHO is doing it, and the player mid-game is the
    // thing worth glancing at. Standard adds exactly those moment chips
    // and nothing else, so it stays calm while being useful. Essential
    // remains for anyone who wants strictly one chip per league.
    //
    // Existing users keep their configured ticker regardless — see
    // migrateFantasyDisplay.
    tickerMode: "standard",
    defaultSubTab: "overview",
    primaryLeagueKey: null,
    enabledLeagueKeys: [],
  },
};

const DEFAULT_WIDGETS: WidgetPrefs = {
  // Onboarding default (widget/slot redesign, 2026-06-30): a brand-new
  // account starts with the zero-config Clock so the ticker has something to
  // show immediately instead of an empty bar. It costs 1 of the free plan's
  // 3 slots and needs no setup. Existing users keep their saved prefs — this
  // only seeds fresh installs.
  enabledWidgets: ["clock"],
  sidebarOrder: [],
  widgetsOnTicker: ["clock"],
  pins: [],
  timer: {
    pomodoro: { ...DEFAULT_TIMER_POMODORO },
  },
  sysmon: {
    ticker: { ...DEFAULT_SYSMON_TICKER },
  },
  uptime: {
    url: "",
  },
  github: {
    repos: [],
  },
};

const DEFAULT_PREFS: AppPreferences = {
  appearance: DEFAULT_APPEARANCE,
  ticker: DEFAULT_TICKER,
  startup: DEFAULT_STARTUP,
  privacy: DEFAULT_PRIVACY,
  window: DEFAULT_WINDOW,
  widgets: DEFAULT_WIDGETS,
  widgetDisplay: DEFAULT_WIDGET_DISPLAY,
  tipsShown: [],
};

// ── Storage helpers ─────────────────────────────────────────────

const PREFIX = "scrollr:settings";
/** Pre-REL-207 per-window mirrors of `window.pinned` / `window.tickerPosition`. */
const LEGACY_MIRROR_KEYS = ["scrollr:feedPinned", "scrollr:tickerPosition"];

/** Migrate v1 prefs (general/taskbar/ticker/window) to v2 shape. */
function migrateV1(saved: Record<string, unknown>): Partial<AppPreferences> {
  const result: Record<string, unknown> = {};

  // Old "general" → split into startup + appearance. Nothing survives
  // the split: v1's defaultView, refreshInterval and autostart were
  // migrated forward for years without anything ever reading them, and
  // autoCheckUpdates went with REL-206 (the check always runs now).
  // smoothScroll and scrollSmoothness went earlier.
  if (saved.general) {
    result.startup = { ...DEFAULT_STARTUP };
  }

  // v1's "taskbar" block is dropped: nothing ever read it (REL-208).

  // "ticker" stays the same shape
  if (saved.ticker) {
    result.ticker = {
      ...DEFAULT_TICKER,
      ...(saved.ticker as Record<string, unknown>),
    };
  }

  // "window" stays the same shape
  if (saved.window) {
    result.window = {
      ...DEFAULT_WINDOW,
      ...(saved.window as Record<string, unknown>),
    };
  }

  // New keys — use defaults (appearance didn't exist in v1)
  if (!result.appearance && !saved.appearance) {
    result.appearance = { ...DEFAULT_APPEARANCE };
  }

  return result as Partial<AppPreferences>;
}

// ── Single-key helpers ──────────────────────────────────────────
// For ad-hoc prefs not in the structured AppPreferences object
// (e.g. feedHeight, activeTab, canvasMode). Used by both windows.

export function loadPref<T>(key: string, fallback: T): T {
  return getStore(`scrollr:${key}`, fallback);
}

export function savePref<T>(key: string, value: T): void {
  setStore(`scrollr:${key}`, value);
}

// ── Structured preferences ─────────────────────────────────────

/**
 * Legacy clock→timer split: true when the saved blob predates the timer
 * widget and its active-timer chip should follow clock onto the ticker.
 * The single predicate behind both halves of the migration — the
 * `widgetsOnTicker` list (mergeWidgetPrefs) and the explicit ticker
 * layout rows (loadPrefs).
 */
function shouldAddLegacyTimerToTicker(
  saved: Partial<WidgetPrefs> | undefined,
): boolean {
  if (!saved) return false;
  if (saved.timer != null && typeof saved.timer === "object") return false;
  // `clock` is no longer on WidgetPrefs (REL-208); this reads the raw
  // pre-split blob, where the timer lived under the clock widget.
  const clockTicker = (
    (saved as Record<string, unknown>).clock as
      { ticker?: { activeTimer?: unknown } } | null | undefined
  )?.ticker;
  if (clockTicker?.activeTimer === false) return false;
  const enabled = Array.isArray(saved.enabledWidgets)
    ? saved.enabledWidgets
    : DEFAULT_WIDGETS.enabledWidgets;
  const onTicker = Array.isArray(saved.widgetsOnTicker)
    ? saved.widgetsOnTicker
    : enabled;
  return onTicker.includes("clock") && !onTicker.includes("timer");
}

/** Deep-merge saved widget prefs with defaults.
 *  Handles migration from the old flat shape gracefully. */
export function mergeWidgetPrefs(saved?: Partial<WidgetPrefs>): WidgetPrefs {
  if (!saved) return { ...DEFAULT_WIDGETS };

  // Safe accessor for nested sub-objects that may not exist in old formats
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v != null && typeof v === "object"
      ? (v as Record<string, unknown>)
      : undefined;

  // Pre-split blobs kept the pomodoro config under `clock`.
  const clk = obj((saved as Record<string, unknown>).clock);
  const tmr = obj(saved.timer);
  const sys = obj(saved.sysmon);
  const upt = obj(saved.uptime);
  const ghb = obj(saved.github);

  const savedEnabledWidgets = Array.isArray(saved.enabledWidgets)
    ? saved.enabledWidgets
    : DEFAULT_WIDGETS.enabledWidgets;
  const savedWidgetsOnTicker = Array.isArray(saved.widgetsOnTicker)
    ? saved.widgetsOnTicker
    : savedEnabledWidgets;
  const shouldEnableLegacyTimer = !tmr && savedEnabledWidgets.includes("clock");
  const enabledWidgets =
    shouldEnableLegacyTimer && !savedEnabledWidgets.includes("timer")
      ? [...savedEnabledWidgets, "timer"]
      : savedEnabledWidgets;
  const widgetsOnTicker = shouldAddLegacyTimerToTicker(saved)
    ? [...savedWidgetsOnTicker, "timer"]
    : savedWidgetsOnTicker;

  return {
    enabledWidgets,
    sidebarOrder: Array.isArray(saved.sidebarOrder)
      ? saved.sidebarOrder.filter((id): id is string => typeof id === "string")
      : [],
    // Migration: if widgetsOnTicker doesn't exist, default to enabledWidgets
    widgetsOnTicker,
    pins: migratePins(saved as Record<string, unknown>),
    // Stored clock/weather blocks and the per-widget `ticker` sub-configs
    // (other than sysmon's) are dropped here: the fields were force-reset
    // on every load since 2026-07-17 and REL-208 removed them outright.
    // Not spreading them is what sheds them from disk on the next save.
    timer: {
      pomodoro: {
        ...DEFAULT_TIMER_POMODORO,
        ...obj(clk?.pomodoro),
        ...obj(tmr?.pomodoro),
      },
    },
    // sysmon.refreshInterval and uptime/github.pollInterval are not
    // carried (REL-206): the sysmon select was inert and poll cadence is
    // not a user decision, so the feed tabs hold fixed intervals now.
    sysmon: {
      ticker: { ...DEFAULT_SYSMON_TICKER, ...obj(sys?.ticker) },
    },
    uptime: {
      url: typeof upt?.url === "string" ? upt.url : DEFAULT_WIDGETS.uptime.url,
    },
    github: {
      repos: Array.isArray(ghb?.repos)
        ? (ghb.repos as unknown[]).filter(
            (r): r is { owner: string; repo: string } =>
              r != null &&
              typeof r === "object" &&
              typeof (r as Record<string, unknown>).owner === "string" &&
              typeof (r as Record<string, unknown>).repo === "string",
          )
        : DEFAULT_WIDGETS.github.repos,
    },
  };
}

/** Keep saved positions, remove stale/duplicate IDs, then append new widgets. */
export function reconcileSidebarOrder(
  saved: readonly string[],
  available: readonly string[],
): string[] {
  const remaining = new Set(available);
  const ordered: string[] = [];

  for (const id of saved) {
    if (remaining.delete(id)) ordered.push(id);
  }
  for (const id of available) {
    if (remaining.delete(id)) ordered.push(id);
  }

  return ordered;
}

// ── DataWidgetRow display migrations (v1.0.2 venue-enum migration) ────
//
// Each widget's display prefs went from all-booleans to `Venue` strings
// in v1.0.2 (see 2026-04-25-display-venue-toggle-design.md). These
// helpers run `migrateVenue` on every field that was previously a
// boolean; unknown and never-seen fields get the `"both"` default so new
// widgets and new fields are visible immediately post-upgrade.

export function migrateFinanceDisplay(
  saved: Partial<FinanceDisplayPrefs> | undefined,
): FinanceDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULT_WIDGET_DISPLAY.finance,
    defaultSort: oneOf(
      raw.defaultSort,
      ["alpha", "price", "change", "updated"],
      DEFAULT_WIDGET_DISPLAY.finance.defaultSort,
    ),
  };
}

export function migratePredictionsDisplay(
  saved: Partial<PredictionsDisplayPrefs> | undefined,
): PredictionsDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;
  // v1.1.5: the all-time volume sort became Trending (24h).
  const stored = raw.defaultSort === "volume" ? "trending" : raw.defaultSort;
  return {
    ...DEFAULT_WIDGET_DISPLAY.predictions,
    defaultSort: oneOf(
      stored,
      ["trending", "movers", "closing", "alpha"],
      DEFAULT_WIDGET_DISPLAY.predictions.defaultSort,
    ),
  };
}

export function migrateRssDisplay(
  saved: Partial<RssDisplayPrefs> | undefined,
): RssDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULT_WIDGET_DISPLAY.rss,
    // Sticky feed sort (2026-07-17 unification).
    feedSort: oneOf(
      raw.feedSort,
      ["newest", "oldest"],
      DEFAULT_WIDGET_DISPLAY.rss.feedSort,
    ),
    // A stored `articlesPerSource` (the retired per-source cap, REL-208)
    // is not carried: the feed shows every eligible article per source.
    maxArticles:
      typeof raw.maxArticles === "number" &&
      Number.isFinite(raw.maxArticles) &&
      raw.maxArticles > 0
        ? Math.round(raw.maxArticles)
        : DEFAULT_WIDGET_DISPLAY.rss.maxArticles,
    // v1.1.3: clamp to a sane range; missing/invalid → 0 (no filter),
    // which is exactly the pre-v1.1.3 behavior.
    maxArticleAgeDays:
      typeof raw.maxArticleAgeDays === "number" &&
      Number.isFinite(raw.maxArticleAgeDays)
        ? Math.min(30, Math.max(0, Math.round(raw.maxArticleAgeDays)))
        : DEFAULT_WIDGET_DISPLAY.rss.maxArticleAgeDays,
  };
}

export function isFantasyTickerMode(v: unknown): v is FantasyTickerMode {
  return v === "essential" || v === "standard" || v === "everything";
}

export function migrateFantasyDisplay(
  saved: Partial<FantasyDisplayPrefs> | undefined,
): FantasyDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;

  // A prefs file that predates the dial resolves to "everything": every
  // per-item venue pref defaulted to "both" back then, so that is the
  // ticker those users already had. Only genuinely fresh installs, which
  // never reach this function, get the calm default.
  //
  // The 14 venue prefs, the two legacy booleans they were folded from
  // (`tickerShowMatchup`, `showInjuryCount`), and the never-read
  // `showStandings` / `showMatchups` / `defaultSort` are not carried
  // (REL-208) — the object built here is what gets saved back, so they
  // fall off on the next write.
  const tickerMode: FantasyTickerMode = isFantasyTickerMode(raw.tickerMode)
    ? raw.tickerMode
    : "everything";

  return {
    ...DEFAULT_WIDGET_DISPLAY.fantasy,
    tickerMode,
    // Followed players is just a string array — no enum migration.
    // Filter to strings defensively in case the persisted shape is
    // garbled (older prefs files with no key get [] from the default).
    followedPlayerKeys: Array.isArray(raw.followedPlayerKeys)
      ? (raw.followedPlayerKeys as unknown[]).filter(
          (k): k is string => typeof k === "string",
        )
      : DEFAULT_WIDGET_DISPLAY.fantasy.followedPlayerKeys,
    defaultSubTab: oneOf(
      raw.defaultSubTab,
      ["overview", "matchup", "standings", "roster"],
      DEFAULT_WIDGET_DISPLAY.fantasy.defaultSubTab,
    ),
    primaryLeagueKey:
      typeof raw.primaryLeagueKey === "string" || raw.primaryLeagueKey === null
        ? (raw.primaryLeagueKey as string | null)
        : DEFAULT_WIDGET_DISPLAY.fantasy.primaryLeagueKey,
    enabledLeagueKeys: Array.isArray(raw.enabledLeagueKeys)
      ? (raw.enabledLeagueKeys as string[])
      : DEFAULT_WIDGET_DISPLAY.fantasy.enabledLeagueKeys,
  };
}

export function loadPrefs(): AppPreferences {
  try {
    const saved = getStore<Record<string, unknown> | null>(PREFIX, null);
    if (!saved) return { ...DEFAULT_PREFS };

    // Detect v1 format: has "general" key but no "appearance" key
    const isV1 = "general" in saved && !("appearance" in saved);
    const source = isV1 ? migrateV1(saved) : (saved as Partial<AppPreferences>);

    // Deep merge with defaults so new keys are always present.
    const savedDisplay = source.widgetDisplay as
      Partial<WidgetDisplayPrefs> | undefined;
    // Strip the legacy `tickerRows` scalar and the `tickerLayout`
    // object that replaced it. Both described a multi-row ticker; the
    // ticker is single-row now, so neither is read and neither is
    // written back — they simply fall off on the next save.
    const savedAppearance = source.appearance as
      | (Partial<AppearancePrefs> & {
          tickerRows?: unknown;
          tickerLayout?: unknown;
          theme?: unknown;
        })
      | undefined;
    // Strip legacy fields:
    //  - `tickerRows` was a derived scalar from pre-multi-row builds.
    //  - `theme` was the pre-multi-theme color-mode field; the
    //    migration helper below folds it into themeMode + themeFamily.
    const {
      tickerRows: _legacyTickerRows,
      tickerLayout: _legacyTickerLayout,
      theme: _legacyTheme,
      themeFamily: _savedFamily,
      themeMode: _savedMode,
      ...appearanceRest
    } = savedAppearance ?? {};
    void _legacyTickerRows; // intentionally discarded
    void _legacyTickerLayout; // multi-row ticker, removed
    void _legacyTheme; // folded into themeMode below
    void _savedFamily; // re-applied via migrateAppearanceTheme
    void _savedMode; // re-applied via migrateAppearanceTheme
    const { themeFamily, themeMode } = migrateAppearanceTheme(
      savedAppearance as Record<string, unknown> | undefined,
    );
    // Seed `tickerScale` from `uiScale` when missing/invalid so the
    // ticker keeps the same scale users had before the split.
    const savedUiScale =
      typeof appearanceRest.uiScale === "number" ? appearanceRest.uiScale : 100;
    const savedTickerScale =
      typeof appearanceRest.tickerScale === "number"
        ? appearanceRest.tickerScale
        : savedUiScale;
    const legacyWeatherUnit = getStore<unknown>(LS_WEATHER_UNIT, undefined);
    const legacyClockFormat = getStore<unknown>(LS_CLOCK_FORMAT, undefined);
    const hadLegacyUnits =
      legacyWeatherUnit !== undefined || legacyClockFormat !== undefined;
    const mergedAppearance: AppearancePrefs = {
      ...DEFAULT_APPEARANCE,
      ...appearanceRest,
      uiScale: snapToPreset(
        appearanceRest.uiScale,
        SCALE_PRESETS,
        DEFAULT_APPEARANCE.uiScale,
      ),
      tickerScale: snapToPreset(
        savedTickerScale,
        SCALE_PRESETS,
        DEFAULT_APPEARANCE.tickerScale,
      ),
      themeFamily,
      themeMode,
      units: migrateUnits(appearanceRest.units, {
        weather: legacyWeatherUnit,
        clock: legacyClockFormat,
      }),
    };
    // Strip the retired startup/window fields the same way the legacy
    // appearance keys above are stripped. Spreading saved-over-defaults
    // would otherwise carry `autoCheckUpdates`, `defaultView`,
    // `refreshInterval`, `autostart`, `defaultWidth`, `narrowWidth` and
    // `skipTaskbar` straight back out to disk on the next save, so
    // removing them from the types alone would never actually shed them.
    const {
      autoCheckUpdates: _autoCheckUpdates,
      defaultView: _defaultView,
      refreshInterval: _refreshInterval,
      autostart: _autostart,
      ...savedStartup
    } = (source.startup ?? {}) as Partial<StartupPrefs> & {
      autoCheckUpdates?: unknown;
      defaultView?: unknown;
      refreshInterval?: unknown;
      autostart?: unknown;
    };
    const {
      defaultWidth: _defaultWidth,
      narrowWidth: _narrowWidth,
      skipTaskbar: _skipTaskbar,
      ...savedWindow
    } = (source.window ?? {}) as Partial<WindowPrefs> & {
      defaultWidth?: unknown;
      narrowWidth?: unknown;
      skipTaskbar?: unknown;
    };
    const merged: AppPreferences = {
      appearance: mergedAppearance,
      ticker: migrateTicker(source.ticker),
      startup: { ...DEFAULT_STARTUP, ...savedStartup },
      // Absent on every pre-REL-209 install → on. Only a literal
      // `false` turns reporting off; anything else is the default.
      privacy: {
        sendCrashReports: source.privacy?.sendCrashReports !== false,
      },
      window: {
        ...DEFAULT_WINDOW,
        ...savedWindow,
        // Absent on every pre-REL-200 install; anything but a string
        // list is treated as "primary only" rather than trusted.
        tickerMonitors: Array.isArray(savedWindow.tickerMonitors)
          ? savedWindow.tickerMonitors.filter((m): m is string => typeof m === "string")
          : [],
      },
      // No `taskbar`: the block was migrated, defaulted and reset for
      // years without a reader. Not carrying it here sheds it on save.
      widgets: mergeWidgetPrefs(
        source.widgets as Partial<WidgetPrefs> | undefined,
      ),
      widgetDisplay: {
        finance: migrateFinanceDisplay(savedDisplay?.finance),
        rss: migrateRssDisplay(savedDisplay?.rss),
        fantasy: migrateFantasyDisplay(savedDisplay?.fantasy),
        predictions: migratePredictionsDisplay(savedDisplay?.predictions),
      },
      // Tolerate older builds that didn't have `tipsShown`. Treat
      // missing/invalid as "no tips shown yet" so the user gets a
      // proper first-run experience after upgrading.
      tipsShown: Array.isArray(source.tipsShown)
        ? (source.tipsShown.filter((id) => typeof id === "string") as string[])
        : [],
    };

    // Legacy split: users who had the combined clock/timer widget on the
    // ticker should get the timer too. This used to walk each ticker row's
    // source list; with a single row it is just the one membership list.
    if (
      shouldAddLegacyTimerToTicker(
        source.widgets as Partial<WidgetPrefs> | undefined,
      )
    ) {
      const onTicker = merged.widgets.widgetsOnTicker;
      if (onTicker.includes("clock") && !onTicker.includes("timer")) {
        merged.widgets = {
          ...merged.widgets,
          widgetsOnTicker: [...onTicker, "timer"],
        };
      }
    }

    // Persist the migrated shape so it runs once: v1 → v2, and the
    // legacy unit keys folding into appearance.units (their store keys
    // go away here; sysmon.tempUnit falls off on the next save).
    if (isV1 || hadLegacyUnits) {
      setStore(PREFIX, merged);
      removeStore(LS_WEATHER_UNIT);
      removeStore(LS_CLOCK_FORMAT);
    }
    // The ticker window used to mirror `window.pinned` and
    // `window.tickerPosition` into their own keys and read those first
    // (REL-207). It reads the prefs now; shed the mirrors once.
    for (const key of LEGACY_MIRROR_KEYS) {
      if (getStore<unknown>(key, undefined) !== undefined) removeStore(key);
    }

    return merged;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * REL-204 (2026-09-06): the Ticker page went from sliders and switches to
 * presets and one hover row. Retired keys are dropped, not carried:
 *  - `pauseOnHover` + `hoverSpeed` → `onHover`
 *    (false → keep; true + 0 → pause; true otherwise → slow)
 *  - `tickerGap` (Spacing) and `tickerDirection` (Direction) → gone
 *  - `tickerSpeed` / `stepPause` snap to the nearest preset
 *
 * REL-207: stored values renamed to match their labels. Anything
 * unrecognised falls back to the default:
 *  - tickerMode  comfort → detailed
 *  - mixMode     weave → mixed
 *  - chipColors  accent → theme, muted → subtle
 *  - scrollMode  step → page, and flip (Rotate, REL-204) → page
 */
export function migrateTicker(raw: unknown): TickerPrefs {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Omit<
    Partial<TickerPrefs>,
    "scrollMode" | "tickerMode" | "mixMode" | "chipColors"
  > & {
    pauseOnHover?: unknown;
    hoverSpeed?: unknown;
    tickerGap?: unknown;
    tickerDirection?: unknown;
    scrollMode?: unknown;
    tickerMode?: unknown;
    mixMode?: unknown;
    chipColors?: unknown;
  };
  const {
    pauseOnHover,
    hoverSpeed,
    tickerGap: _gap,
    tickerDirection: _direction,
    scrollMode,
    tickerMode,
    mixMode,
    chipColors,
    onHover,
    ...rest
  } = saved;
  void _gap;
  void _direction;
  const isHover = (v: unknown): v is HoverBehavior =>
    v === "keep" || v === "slow" || v === "pause";
  const migratedHover: HoverBehavior = isHover(onHover)
    ? onHover
    : pauseOnHover === false
      ? "keep"
      : pauseOnHover === true && hoverSpeed === 0
        ? "pause"
        : DEFAULT_TICKER.onHover;
  return {
    ...DEFAULT_TICKER,
    ...rest,
    onHover: migratedHover,
    tickerMode: tickerMode === "compact" ? "compact" : "detailed",
    mixMode: mixMode === "grouped" ? "grouped" : "mixed",
    chipColors:
      chipColors === "theme" || chipColors === "accent"
        ? "theme"
        : chipColors === "subtle" || chipColors === "muted"
          ? "subtle"
          : "widget",
    scrollMode:
      scrollMode === "page" || scrollMode === "step" || scrollMode === "flip"
        ? "page"
        : "continuous",
    tickerSpeed: snapToPreset(
      rest.tickerSpeed,
      Object.values(TICKER_SPEEDS),
      DEFAULT_TICKER.tickerSpeed,
    ),
    stepPause: snapToPreset(rest.stepPause, STEP_PAUSES, DEFAULT_TICKER.stepPause),
  };
}

export function savePrefs(prefs: AppPreferences): void {
  setStore(PREFIX, prefs);
}

/** Reset a single category to its defaults. */
export function resetCategory<K extends keyof AppPreferences>(
  prefs: AppPreferences,
  category: K,
): AppPreferences {
  const def = DEFAULT_PREFS[category];
  const value =
    typeof def === "object" && def !== null && !Array.isArray(def)
      ? { ...def }
      : def;
  return { ...prefs, [category]: value };
}

/**
 * Everything the Ticker page shows: `ticker.*`, the whole `window.*`
 * block (edge, monitors, stay-above, hide-on-fullscreen) and the bar's
 * own scale. The button, toast and undo all say "Reset ticker settings".
 */
export function resetTickerPage(prefs: AppPreferences): AppPreferences {
  return {
    ...prefs,
    ticker: { ...DEFAULT_TICKER },
    window: { ...DEFAULT_WINDOW },
    appearance: {
      ...prefs.appearance,
      tickerScale: DEFAULT_APPEARANCE.tickerScale,
    },
  };
}

/** Reset everything to defaults. */
export function resetAll(): AppPreferences {
  const defaults: AppPreferences = {
    appearance: { ...DEFAULT_APPEARANCE },
    ticker: { ...DEFAULT_TICKER },
    startup: { ...DEFAULT_STARTUP },
    privacy: { ...DEFAULT_PRIVACY },
    window: { ...DEFAULT_WINDOW },
    widgets: { ...DEFAULT_WIDGETS },
    widgetDisplay: { ...DEFAULT_WIDGET_DISPLAY },
    // Reset clears tipsShown — the user explicitly asked for a clean
    // slate, so they'll re-experience first-run discovery hints.
    tipsShown: [],
  };
  savePrefs(defaults);
  return defaults;
}

// ── Theme resolution ────────────────────────────────────────

/** Resolve a `ThemeMode` to a concrete light/dark value.
 *  "system" follows the OS preference; otherwise returns as-is. */
export function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

/**
 * Build the `data-theme` attribute value for a family + resolved mode.
 *
 *   resolveThemeName("catppuccin", "dark") → "catppuccin-dark"
 *   resolveThemeName("scrollr", "light")   → "scrollr-light"
 */
export function resolveThemeName(
  family: ThemeFamily,
  resolvedMode: "light" | "dark",
): string {
  return `${family}-${resolvedMode}`;
}

/**
 * Migrate a saved appearance blob to the new themeFamily + themeMode
 * shape. Existing builds wrote `{ theme: "light" | "dark" | "system" }`;
 * the new shape splits that into `themeFamily` + `themeMode`.
 *
 * Rules:
 *   - Legacy `theme` → `themeMode`, `themeFamily` defaults to "scrollr"
 *   - Unknown / missing `themeFamily` → "scrollr"
 *   - Unknown / missing `themeMode`   → "system"
 *
 * This function only normalizes the theme fields; the caller is still
 * responsible for merging the rest of AppearancePrefs (uiScale,
 * tickerScale, fontWeight, highContrast) against DEFAULT_APPEARANCE.
 */
export function migrateAppearanceTheme(
  saved: Record<string, unknown> | undefined,
): { themeFamily: ThemeFamily; themeMode: ThemeMode } {
  if (!saved) {
    return { themeFamily: "scrollr", themeMode: "system" };
  }
  const family = isThemeFamily(saved.themeFamily)
    ? saved.themeFamily
    : "scrollr";
  // Prefer the new field; fall back to the legacy `theme` field.
  let mode: ThemeMode = "system";
  if (isThemeMode(saved.themeMode)) {
    mode = saved.themeMode;
  } else if (isThemeMode(saved.theme)) {
    mode = saved.theme;
  }
  return { themeFamily: family, themeMode: mode };
}

// ── Derived values ──────────────────────────────────────────────

export const TICKER_HEIGHTS: Record<TickerMode, number> = {
  compact: 44,
  detailed: 64,
};

// ── Ticker layout helpers ───────────────────────────────────────

// ── Pure preference updaters ────────────────────────────────────

/** Toggle a widget on/off the ticker. Returns a new AppPreferences. */
export function toggleWidgetOnTicker(
  prefs: AppPreferences,
  widgetId: string,
): AppPreferences {
  const onTicker = prefs.widgets.widgetsOnTicker;
  const next = onTicker.includes(widgetId)
    ? onTicker.filter((id) => id !== widgetId)
    : [...onTicker, widgetId];
  return {
    ...prefs,
    widgets: { ...prefs.widgets, widgetsOnTicker: next },
  };
}

/**
 * Remove a widget from the user's enabled set AND the ticker. Pure
 * counterpart to `useWidgetActions.handleToggleWidget`'s "currently
 * enabled" branch — extracted so the widget route can route the Trash
 * button through `useUndoableAction` (Phase 1, Apr 26) and recover
 * with a single snapshot restore.
 *
 * No-op if the widget wasn't enabled in the first place — returns the
 * same `prefs` reference so the undoable hook can short-circuit and
 * avoid showing a phantom "Removed ___" toast for a click that did
 * nothing.
 */
export function disableWidget(
  prefs: AppPreferences,
  widgetId: string,
): AppPreferences {
  const enabledWidgets = prefs.widgets.enabledWidgets;
  if (!enabledWidgets.includes(widgetId)) return prefs;
  return {
    ...prefs,
    widgets: {
      ...prefs.widgets,
      enabledWidgets: enabledWidgets.filter((id) => id !== widgetId),
      widgetsOnTicker: prefs.widgets.widgetsOnTicker.filter(
        (id) => id !== widgetId,
      ),
      // A pin outlives a refetch on purpose, but not the widget that owns
      // its subject: a pinned symbol from a deleted watchlist would hold a
      // slot in the fixed zone that can never render anything again.
      pins: prefs.widgets.pins.filter((p) => p.widget !== widgetId),
    },
  };
}

/**
 * Read the stored pin list, migrating the pre-REL-239 blob.
 *
 * `pinnedWidgets` was `Record<widgetId, {side}>` -- a pin on a WIDGET.
 * For a multi-item widget that meant "park this widget's first N chips
 * in the fixed zone", which froze its rotation: the ninth monitor or
 * the twentieth symbol could never come round. Those pins are dropped,
 * not translated, because there is no subject in them to translate to.
 *
 * A single-chip utility (clock, timer, weather, sysmon) has exactly one
 * chip, so its old pin already WAS a pin on a subject. Those carry over
 * unchanged -- a pinned clock looks and behaves identically after the
 * migration, which is the point.
 */
function migratePins(saved: Record<string, unknown>): WidgetPin[] {
  if (Array.isArray(saved.pins)) {
    return saved.pins
      .filter(
        (p): p is WidgetPin =>
          p != null &&
          typeof p === "object" &&
          typeof (p as WidgetPin).widget === "string" &&
          (p as WidgetPin).widget !== "" &&
          typeof (p as WidgetPin).subject === "string" &&
          // An empty subject names nothing, so its chip can never resolve:
          // it would hold a slot in a capped zone forever. Shed it on load.
          (p as WidgetPin).subject !== "",
      )
      .map((p) => ({
        widget: p.widget,
        subject: p.subject,
        side: (p.side === "left" ? "left" : "right") as PinSide,
        ...(typeof p.row === "number" ? { row: p.row } : {}),
      }))
      .slice(0, MAX_PINS);
  }

  const legacy = saved.pinnedWidgets;
  if (legacy == null || typeof legacy !== "object" || Array.isArray(legacy)) {
    return [];
  }
  return Object.entries(legacy as Record<string, { side?: unknown }>)
    .filter(([widgetId]) => isSingleChipWidget(widgetId))
    .map(([widgetId, cfg]) => ({
      widget: widgetId,
      subject: widgetId,
      side: (cfg?.side === "left" ? "left" : "right") as PinSide,
    }))
    .slice(0, MAX_PINS);
}

/** Is this subject currently pinned? */
export function isPinned(
  prefs: AppPreferences,
  widget: string,
  subject: string,
): boolean {
  return prefs.widgets.pins.some(
    (p) => p.widget === widget && p.subject === subject,
  );
}

/**
 * Pins in the fixed zone.
 *
 * Counted across both sides, not per side: the two zones sit at opposite
 * ends of ONE bar and take their width out of the same tape. Only the
 * right side is reachable from the UI anyway -- a left-side pin can now
 * only arrive from the pre-REL-239 migration.
 */
export function pinCount(prefs: AppPreferences): number {
  return prefs.widgets.pins.length;
}

/**
 * Toggle a pin on one subject.
 *
 * Adding past `MAX_PINS` is REFUSED: the same `prefs` reference comes
 * back, so the caller can tell nothing happened and say so. The zone
 * never evicts an existing pin to make room -- the user put it there on
 * purpose and a bar that silently drops things is worse than one that
 * says "full".
 */
export function togglePin(
  prefs: AppPreferences,
  pin: WidgetPin,
): AppPreferences {
  // An empty subject names nothing. Guarded here rather than at each call
  // site because every write routes through this function, and a source
  // row with a missing name is a data gap, not a caller's mistake -- a
  // standings row with no `team_name` produced exactly this, and the pin
  // it made held a slot in the zone that could never render a chip.
  if (pin.widget === "" || pin.subject === "") return prefs;
  const pins = prefs.widgets.pins;
  const at = pins.findIndex(
    (p) => p.widget === pin.widget && p.subject === pin.subject,
  );
  if (at >= 0) {
    return {
      ...prefs,
      widgets: { ...prefs.widgets, pins: pins.filter((_, i) => i !== at) },
    };
  }
  if (pinCount(prefs) >= MAX_PINS) return prefs;
  return { ...prefs, widgets: { ...prefs.widgets, pins: [...pins, pin] } };
}

/** Drop every pin belonging to a widget. Used when the widget is removed. */
export function dropPinsForWidget(
  prefs: AppPreferences,
  widgetId: string,
): AppPreferences {
  const pins = prefs.widgets.pins.filter((p) => p.widget !== widgetId);
  if (pins.length === prefs.widgets.pins.length) return prefs;
  return { ...prefs, widgets: { ...prefs.widgets, pins } };
}

/** Shallow-merge a patch into a widget's config. Returns a new AppPreferences. */
export function updateWidgetPrefs(
  prefs: AppPreferences,
  widgetKey: string,
  patch: Record<string, unknown>,
): AppPreferences {
  const widgets = prefs.widgets as unknown as Record<string, unknown>;
  const current = widgets[widgetKey];
  return {
    ...prefs,
    widgets: {
      ...prefs.widgets,
      [widgetKey]: { ...(current as Record<string, unknown>), ...patch },
    },
  };
}
