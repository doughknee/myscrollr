// ── Preferences system ──────────────────────────────────────────
// Centralized types, defaults, and helpers for all desktop settings.
// All prefs are persisted via Tauri plugin-store (disk-backed).

import { getStore, setStore } from "./lib/store";

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
  return typeof value === "string" && (THEME_FAMILIES as string[]).includes(value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}
type TaskbarHeight = "compact" | "default" | "comfortable";
export type TickerGap = "tight" | "normal" | "spacious";
export type TickerMode = "compact" | "comfort";
type DefaultView = "feed" | "dashboard" | "last";
export type MixMode = "grouped" | "weave";
export type ChipColorMode = "widget" | "accent" | "muted";
export type TickerDirection = "left" | "right";
export type ScrollMode = "continuous" | "step" | "flip";
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
  uiScale: number; // 75–150, default 100 — app window only
  /**
   * Independent zoom for the ticker window (75–150, default 100). Lets
   * users size the ticker chips without affecting the main app, and
   * vice versa. Seeded from `uiScale` on first load after upgrade so
   * existing users keep their current scale.
   */
  tickerScale: number;
  fontWeight: FontWeight;
  highContrast: boolean;
}

export interface TickerPrefs {
  showTicker: boolean;
  tickerSpeed: number;
  pauseOnHover: boolean;
  hoverSpeed: number;
  tickerGap: TickerGap;
  tickerMode: TickerMode;
  mixMode: MixMode;
  chipColors: ChipColorMode;
  tickerDirection: TickerDirection;
  scrollMode: ScrollMode;
  stepPause: number; // seconds between transitions (1–10)
}

export interface StartupPrefs {
  defaultView: DefaultView;
  refreshInterval: number;
  autostart: boolean;
  /**
   * When true, the main window runs a single update check shortly after
   * launch and surfaces a toast if a new version is available. The user
   * confirms before any download happens — we never auto-install.
   * Defaults to true; opt out via Settings → General → Updates.
   */
  autoCheckUpdates: boolean;
}

export type TickerPosition = "top" | "bottom";

export interface WindowPrefs {
  pinned: boolean;
  defaultWidth: "full" | "narrow";
  narrowWidth: number;
  skipTaskbar: boolean;
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
}

interface TaskbarPrefs {
  showWidgetGlyphIcons: boolean;
  showConnectionIndicator: boolean;
  showCanvasToggle: boolean;
  taskbarHeight: TaskbarHeight;
  pinnedActions: string[];
}

// ── Per-widget config types ─────────────────────────────────────

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

export interface WeatherTickerConfig {
  /** City display names excluded from the ticker (empty = all configured cities shown). */
  excludedCities: string[];
}

export interface WeatherWidgetConfig {
  ticker: WeatherTickerConfig;
}

export type TempUnit = "celsius" | "fahrenheit";

export interface SysmonTickerConfig {
  cpu: boolean;
  memory: boolean;
  gpu: boolean;
  gpuPower: boolean;
}

export interface SysmonWidgetConfig {
  refreshInterval: number;
  tempUnit: TempUnit;
  ticker: SysmonTickerConfig;
}

export interface UptimeTickerConfig {
  /** Monitor IDs excluded from the ticker (empty = all configured monitors shown). */
  excludedMonitors: number[];
}

export interface UptimeWidgetConfig {
  /** The user's Uptime Kuma public status page URL. Empty = not configured. */
  url: string;
  /** Poll interval in seconds (default 60). */
  pollInterval: number;
  ticker: UptimeTickerConfig;
}

export interface GitHubTickerConfig {
  /** Repo keys ("owner/repo") excluded from the ticker. */
  excludedRepos: string[];
}

export interface GitHubWidgetConfig {
  /** Configured repos to track. */
  repos: Array<{ owner: string; repo: string }>;
  /** Poll interval in seconds (default 120). */
  pollInterval: number;
  ticker: GitHubTickerConfig;
}

export interface WidgetPinConfig {
  side: PinSide;
}

export interface WidgetPrefs {
  /** Widget IDs that are enabled (shown in sidebar and feed tabs). */
  enabledWidgets: string[];
  /** User-defined order for all enabled sidebar widgets. */
  sidebarOrder: string[];
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
 * There is no longer a UI for switching these: the `VenueRow` segmented
 * control lived on the Configure pages, which v1.1.9 retired. The values
 * still drive rendering — `shouldShowOnTicker` / `shouldShowOnFeed` are read
 * by the ticker and the chips — they just come from stored prefs and the
 * per-widget defaults now, not from a settings screen.
 */
export type Venue = "off" | "feed" | "both" | "ticker";

/** True when the venue indicates the setting should render on the ticker. */
export function shouldShowOnTicker(venue: Venue): boolean {
  return venue === "both" || venue === "ticker";
}

/** True when the venue indicates the setting should render on the feed page. */
export function shouldShowOnFeed(venue: Venue): boolean {
  return venue === "both" || venue === "feed";
}

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
  /**
   * Direction marker on the ticker chip. "arrow" uses ▲▼ glyphs,
   * "sign" uses +/− text, "none" hides the marker entirely
   * (% change still renders, just without the leading marker).
   */
  tickerDirectionMarker: "arrow" | "sign" | "none";
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
  articlesPerSource: number; // 0 = all (the default since v1.1.1); 1/3/5/10 legacy per-source caps
  /** Maximum eligible articles shown in the feed. 0 = all. */
  maxArticles: number;
  /** v1.1.3 Time Controls: hide articles older than N days (published_at,
   *  falling back to created_at). 0 = no age filter — every article the
   *  server sends, which is the pre-v1.1.3 behavior. */
  maxArticleAgeDays: number;
}

export type FantasySubTab = "overview" | "matchup" | "standings" | "roster";

export interface FantasyDisplayPrefs {
  // ── Per-item venue controls (visibility) ──
  /** Live matchup score: "My Team 89.5 — 76.2 Opponent". */
  matchupScore: Venue;
  /** "62% win" — uses estimateWinProbability. */
  winProbability: Venue;
  /** LIVE / FINAL / PRE badge on the matchup summary. */
  matchupStatus: Venue;
  /** "Proj 95.2" on the user's team this week. */
  projectedPoints: Venue;
  /** "Week 5" label. */
  week: Venue;
  /** Season record "6-3-1". */
  record: Venue;
  /** "3rd of 10" standings position. */
  standingsPosition: Venue;
  /** Streak badge ("W3" / "L2"). */
  streak: Venue;
  /** Injury count on the user's roster ("2 injured"). */
  injuryCount: Venue;
  /** Top scorer on the user's active roster this week ("LeBron 42.3"). */
  topScorer: Venue;

  // ── Player-stats segments (Phase 1, 2026-04-25) ──
  /** Top three active starters by current points
   *  ("Mahomes 32 · Hill 18 · CMC 14"). One combined segment, not three. */
  topThreeScorers: Venue;
  /** Lowest-scoring active starter ("Worst: Andrews 0.0"). Surfaces
   *  sit/start regret. Skipped silently when there are no starters. */
  worstStarter: Venue;
  /** Highest-scoring bench player ("Bench top: Pacheco 18.0"). Hidden
   *  when no bench player has any points yet — avoids a meaningless
   *  "Bench top: someone 0.0" cluttering the chip pre-kickoff. */
  benchOpportunity: Venue;
  /** Names + statuses for injured players on the roster
   *  ("🚨 Saquon OUT, Mixon DTD"). Capped at 3 names; spillover shown
   *  as "+N more". Complementary to `injuryCount` — both can be on. */
  injuryDetail: Venue;

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

  // ── Feed-structural settings (not venue-toggled) ──
  /** Render the standings section inside the Fantasy feed view. */
  showStandings: boolean;
  /** Render the matchups section inside the Fantasy feed view. */
  showMatchups: boolean;
  defaultSort: "name" | "season" | "record" | "matchup";
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
  window: WindowPrefs;
  taskbar: TaskbarPrefs;
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
};

const DEFAULT_TICKER: TickerPrefs = {
  showTicker: true,
  tickerSpeed: 40,
  pauseOnHover: true,
  hoverSpeed: 0.3,
  tickerGap: "tight",
  tickerMode: "comfort",
  mixMode: "weave",
  chipColors: "widget",
  tickerDirection: "left",
  scrollMode: "continuous",
  stepPause: 5,
};

const DEFAULT_STARTUP: StartupPrefs = {
  defaultView: "last",
  refreshInterval: 60_000,
  autostart: false,
  autoCheckUpdates: true,
};

const DEFAULT_WINDOW: WindowPrefs = {
  pinned: true,
  defaultWidth: "full",
  narrowWidth: 800,
  skipTaskbar: true,
  tickerPosition: "top",
  hideOnFullscreen: true,
};

const DEFAULT_TASKBAR: TaskbarPrefs = {
  showWidgetGlyphIcons: true,
  showConnectionIndicator: true,
  showCanvasToggle: true,
  taskbarHeight: "default",
  pinnedActions: ["showTicker", "width", "pinned"],
};

// 2026-07-17 settings-model unification: per-item ticker exclusions and
// the on/off ticker gates left the UI — "if you track it, it's on the
// ticker". These defaults are FORCED at migration (stored values are
// ignored); the fields survive so the ticker-data readers stay
// untouched (empty exclusion lists filter nothing). Sysmon is the one
// exception: its stat toggles remain user-editable content selection.
export const DEFAULT_CLOCK_TICKER: ClockTickerConfig = {
  localTime: true,
  // true since the unification — tracked world clocks appear.
  showTimezones: true,
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

export const DEFAULT_WEATHER_TICKER: WeatherTickerConfig = {
  excludedCities: [],
};

// All-on since the unification: the stat toggles are content selection
// now and gate BOTH the feed cards and the ticker chips, so defaults
// must match what the feed always showed (everything the hardware has).
export const DEFAULT_SYSMON_TICKER: SysmonTickerConfig = {
  cpu: true,
  memory: true,
  gpu: true,
  gpuPower: true,
};

export const DEFAULT_UPTIME_TICKER: UptimeTickerConfig = {
  excludedMonitors: [],
};

export const DEFAULT_GITHUB_TICKER: GitHubTickerConfig = {
  excludedRepos: [],
};

export const DEFAULT_WIDGET_DISPLAY: WidgetDisplayPrefs = {
  finance: {
    defaultSort: "alpha",
    tickerDirectionMarker: "arrow",
  },
  rss: {
    feedSort: "newest",
    articlesPerSource: 0,
    maxArticles: 0,
    maxArticleAgeDays: 0,
  },
  predictions: {
    defaultSort: "trending",
  },
  fantasy: {
    matchupScore: "both",
    winProbability: "both",
    matchupStatus: "both",
    projectedPoints: "both",
    week: "both",
    record: "both",
    standingsPosition: "both",
    streak: "both",
    injuryCount: "both",
    topScorer: "both",
    // Phase 1 player-stats: all default to "both" — users have been
    // explicitly asking for these, so make them visible on the ticker
    // out of the box. Users who find the chip too dense can flip
    // individual ones to "feed" or "off" via Display tab. The
    // migration helper also defaults these to "both" via its
    // unknown-input fallback, so existing users see them post-upgrade.
    topThreeScorers: "both",
    worstStarter: "both",
    benchOpportunity: "both",
    injuryDetail: "both",
    followedPlayerKeys: [],
    showStandings: true,
    showMatchups: true,
    defaultSort: "name",
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

const DEFAULT_PREFS: AppPreferences = {
  appearance: DEFAULT_APPEARANCE,
  ticker: DEFAULT_TICKER,
  startup: DEFAULT_STARTUP,
  window: DEFAULT_WINDOW,
  taskbar: DEFAULT_TASKBAR,
  widgets: DEFAULT_WIDGETS,
  widgetDisplay: DEFAULT_WIDGET_DISPLAY,
  tipsShown: [],
};

// ── Storage helpers ─────────────────────────────────────────────

const PREFIX = "scrollr:settings";

/** Migrate v1 prefs (general/taskbar/ticker/window) to v2 shape. */
function migrateV1(saved: Record<string, unknown>): Partial<AppPreferences> {
  const result: Record<string, unknown> = {};

  // Old "general" → split into startup + appearance
  const general = saved.general as Record<string, unknown> | undefined;
  if (general) {
    result.startup = {
      defaultView: general.defaultView ?? DEFAULT_STARTUP.defaultView,
      refreshInterval: general.refreshInterval ?? DEFAULT_STARTUP.refreshInterval,
      autostart: general.autostart ?? DEFAULT_STARTUP.autostart,
      autoCheckUpdates: DEFAULT_STARTUP.autoCheckUpdates,
    };
    // smoothScroll and scrollSmoothness are dropped (removed)
  }

  // Old "taskbar" → taskbar (add pinnedActions)
  const taskbar = saved.taskbar as Record<string, unknown> | undefined;
  if (taskbar) {
    result.taskbar = {
      ...DEFAULT_TASKBAR,
      ...taskbar,
      // v1 had no pinnedActions; default to the standard set
      pinnedActions: (taskbar.pinnedActions as string[]) ?? DEFAULT_TASKBAR.pinnedActions,
    };
  }

  // "ticker" stays the same shape
  if (saved.ticker) {
    result.ticker = { ...DEFAULT_TICKER, ...(saved.ticker as Record<string, unknown>) };
  }

  // "window" stays the same shape
  if (saved.window) {
    result.window = { ...DEFAULT_WINDOW, ...(saved.window as Record<string, unknown>) };
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
function shouldAddLegacyTimerToTicker(saved: Partial<WidgetPrefs> | undefined): boolean {
  if (!saved) return false;
  if (saved.timer != null && typeof saved.timer === "object") return false;
  const clockTicker = (
    saved.clock as unknown as { ticker?: { activeTimer?: unknown } } | null | undefined
  )?.ticker;
  if (clockTicker?.activeTimer === false) return false;
  const enabled = Array.isArray(saved.enabledWidgets) ? saved.enabledWidgets : DEFAULT_WIDGETS.enabledWidgets;
  const onTicker = Array.isArray(saved.widgetsOnTicker) ? saved.widgetsOnTicker : enabled;
  return onTicker.includes("clock") && !onTicker.includes("timer");
}

/** Deep-merge saved widget prefs with defaults.
 *  Handles migration from the old flat shape gracefully. */
export function mergeWidgetPrefs(saved?: Partial<WidgetPrefs>): WidgetPrefs {
  if (!saved) return { ...DEFAULT_WIDGETS };

  // Safe accessor for nested sub-objects that may not exist in old formats
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v != null && typeof v === "object" ? (v as Record<string, unknown>) : undefined;

  const clk = obj(saved.clock);
  const tmr = obj(saved.timer);
  const wth = obj(saved.weather);
  const sys = obj(saved.sysmon);
  const upt = obj(saved.uptime);
  const ghb = obj(saved.github);

  const savedEnabledWidgets = Array.isArray(saved.enabledWidgets) ? saved.enabledWidgets : DEFAULT_WIDGETS.enabledWidgets;
  const savedWidgetsOnTicker = Array.isArray(saved.widgetsOnTicker) ? saved.widgetsOnTicker : savedEnabledWidgets;
  const shouldEnableLegacyTimer = !tmr && savedEnabledWidgets.includes("clock");
  const enabledWidgets = shouldEnableLegacyTimer && !savedEnabledWidgets.includes("timer")
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
    pinnedWidgets: (saved.pinnedWidgets != null && typeof saved.pinnedWidgets === "object" && !Array.isArray(saved.pinnedWidgets))
      ? saved.pinnedWidgets as Record<string, WidgetPinConfig>
      : {},
    // 2026-07-17 unification reset: clock/timer/weather/uptime/github
    // ticker configs are forced to defaults — the exclusion/on-off UIs
    // are gone and tracked content always reaches the ticker. Stored
    // values are deliberately ignored (idempotent, zero-write; same
    // idiom as the display-venue reset).
    clock: {
      ticker: { ...DEFAULT_CLOCK_TICKER },
    },
    timer: {
      ticker: { ...DEFAULT_TIMER_TICKER },
      pomodoro: {
        ...DEFAULT_TIMER_POMODORO,
        ...obj(clk?.pomodoro),
        ...obj(tmr?.pomodoro),
      },
    },
    weather: {
      ticker: { ...DEFAULT_WEATHER_TICKER },
    },
    sysmon: {
      refreshInterval: typeof sys?.refreshInterval === "number" ? sys.refreshInterval : DEFAULT_WIDGETS.sysmon.refreshInterval,
      tempUnit: (sys?.tempUnit as TempUnit) ?? DEFAULT_WIDGETS.sysmon.tempUnit,
      ticker: { ...DEFAULT_SYSMON_TICKER, ...obj(sys?.ticker) },
    },
    uptime: {
      url: typeof upt?.url === "string" ? upt.url : DEFAULT_WIDGETS.uptime.url,
      pollInterval: typeof upt?.pollInterval === "number" ? upt.pollInterval : DEFAULT_WIDGETS.uptime.pollInterval,
      ticker: { ...DEFAULT_UPTIME_TICKER },
    },
    github: {
      repos: Array.isArray(ghb?.repos)
        ? (ghb.repos as unknown[]).filter(
            (r): r is { owner: string; repo: string } =>
              r != null && typeof r === "object" &&
              typeof (r as Record<string, unknown>).owner === "string" &&
              typeof (r as Record<string, unknown>).repo === "string",
          )
        : DEFAULT_WIDGETS.github.repos,
      pollInterval: typeof ghb?.pollInterval === "number" ? ghb.pollInterval : DEFAULT_WIDGETS.github.pollInterval,
      ticker: { ...DEFAULT_GITHUB_TICKER },
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
    tickerDirectionMarker: oneOf(
      raw.tickerDirectionMarker,
      ["arrow", "sign", "none"],
      DEFAULT_WIDGET_DISPLAY.finance.tickerDirectionMarker,
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
    // One-shot migration (v1.1.1): 4 was the pre-widget-era DEFAULT and
    // never appeared in the picker (1/3/5/10), so a stored 4 is an
    // untouched default, not a user's choice — map it to 0 (all).
    // Deliberately chosen values (1/3/5/10) survive.
    articlesPerSource:
      typeof raw.articlesPerSource === "number" && raw.articlesPerSource !== 4
        ? raw.articlesPerSource
        : DEFAULT_WIDGET_DISPLAY.rss.articlesPerSource,
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

export function migrateFantasyDisplay(
  saved: Partial<FantasyDisplayPrefs> | undefined,
): FantasyDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;

  // tickerShowMatchup (pre-v1.0.2 boolean) folds into matchupScore:
  //   true  → "both" (score visible everywhere)
  //   false → "feed" (hide from ticker; keep in feed cards)
  // If the user already has a `matchupScore` Venue stored, use it.
  const legacyTickerMatchup = raw.tickerShowMatchup;
  const explicitMatchupScore = raw.matchupScore;
  const matchupScore: Venue = explicitMatchupScore
    ? migrateVenue(explicitMatchupScore)
    : legacyTickerMatchup === false
      ? "feed"
      : "both";

  // showInjuryCount (pre-v1.0.2 boolean) folds into injuryCount.
  const legacyInjuryCount = raw.showInjuryCount;
  const explicitInjuryCount = raw.injuryCount;
  const injuryCount: Venue = explicitInjuryCount
    ? migrateVenue(explicitInjuryCount)
    : legacyInjuryCount === false
      ? "off"
      : "both";

  return {
    ...DEFAULT_WIDGET_DISPLAY.fantasy,
    matchupScore,
    winProbability: migrateVenue(raw.winProbability),
    matchupStatus: migrateVenue(raw.matchupStatus),
    projectedPoints: migrateVenue(raw.projectedPoints),
    week: migrateVenue(raw.week),
    record: migrateVenue(raw.record),
    standingsPosition: migrateVenue(raw.standingsPosition),
    streak: migrateVenue(raw.streak),
    injuryCount,
    topScorer: migrateVenue(raw.topScorer),
    // Phase 1 player-stats fields. New fields default to "both" via
    // migrateVenue's fallback for unknown inputs, so existing prefs
    // files (which won't have these keys) get the new segments
    // visible by default. The DEFAULT_WIDGET_DISPLAY values above
    // are what fresh installs and `handleReset` produce; this
    // migration is what existing users see post-upgrade.
    topThreeScorers: migrateVenue(raw.topThreeScorers),
    worstStarter: migrateVenue(raw.worstStarter),
    benchOpportunity: migrateVenue(raw.benchOpportunity),
    injuryDetail: migrateVenue(raw.injuryDetail),
    // Followed players is just a string array — no enum migration.
    // Filter to strings defensively in case the persisted shape is
    // garbled (older prefs files with no key get [] from the default).
    followedPlayerKeys: Array.isArray(raw.followedPlayerKeys)
      ? (raw.followedPlayerKeys as unknown[]).filter(
          (k): k is string => typeof k === "string",
        )
      : DEFAULT_WIDGET_DISPLAY.fantasy.followedPlayerKeys,
    showStandings:
      typeof raw.showStandings === "boolean"
        ? raw.showStandings
        : DEFAULT_WIDGET_DISPLAY.fantasy.showStandings,
    showMatchups:
      typeof raw.showMatchups === "boolean"
        ? raw.showMatchups
        : DEFAULT_WIDGET_DISPLAY.fantasy.showMatchups,
    defaultSort: oneOf(
      raw.defaultSort,
      ["name", "season", "record", "matchup"],
      DEFAULT_WIDGET_DISPLAY.fantasy.defaultSort,
    ),
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
      | Partial<WidgetDisplayPrefs>
      | undefined;
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
    const savedUiScale = typeof appearanceRest.uiScale === "number" ? appearanceRest.uiScale : 100;
    const savedTickerScale = typeof appearanceRest.tickerScale === "number"
      ? appearanceRest.tickerScale
      : savedUiScale;
    const mergedAppearance: AppearancePrefs = {
      ...DEFAULT_APPEARANCE,
      ...appearanceRest,
      tickerScale: savedTickerScale,
      themeFamily,
      themeMode,
    };
    const merged: AppPreferences = {
      appearance: mergedAppearance,
      ticker: { ...DEFAULT_TICKER, ...source.ticker },
      startup: { ...DEFAULT_STARTUP, ...source.startup },
      window: { ...DEFAULT_WINDOW, ...source.window },
      taskbar: { ...DEFAULT_TASKBAR, ...source.taskbar },
      widgets: mergeWidgetPrefs(source.widgets as Partial<WidgetPrefs> | undefined),
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
    if (shouldAddLegacyTimerToTicker(source.widgets as Partial<WidgetPrefs> | undefined)) {
      const onTicker = merged.widgets.widgetsOnTicker;
      if (onTicker.includes("clock") && !onTicker.includes("timer")) {
        merged.widgets = {
          ...merged.widgets,
          widgetsOnTicker: [...onTicker, "timer"],
        };
      }
    }

    // If migrated from v1, persist the new format
    if (isV1) {
      setStore(PREFIX, merged);
    }

    return merged;
  } catch {
    return { ...DEFAULT_PREFS };
  }
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
  const value = typeof def === "object" && def !== null && !Array.isArray(def)
    ? { ...def }
    : def;
  return { ...prefs, [category]: value };
}

/** Reset everything to defaults. */
export function resetAll(): AppPreferences {
  const defaults: AppPreferences = {
    appearance: { ...DEFAULT_APPEARANCE },
    ticker: { ...DEFAULT_TICKER },
    startup: { ...DEFAULT_STARTUP },
    window: { ...DEFAULT_WINDOW },
    taskbar: { ...DEFAULT_TASKBAR },
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

export const TASKBAR_HEIGHTS: Record<TaskbarHeight, number> = {
  compact: 28,
  default: 36,
  comfortable: 44,
};

export const TICKER_GAPS: Record<TickerGap, number> = {
  tight: 8,
  normal: 12,
  spacious: 20,
};

export const TICKER_HEIGHTS: Record<TickerMode, number> = {
  compact: 44,
  comfort: 64,
};

// ── Ticker layout helpers ───────────────────────────────────────

// ── Pure preference updaters ────────────────────────────────────

/** Toggle a widget on/off the ticker. Returns a new AppPreferences. */
export function toggleWidgetOnTicker(prefs: AppPreferences, widgetId: string): AppPreferences {
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
export function disableWidget(prefs: AppPreferences, widgetId: string): AppPreferences {
  const enabledWidgets = prefs.widgets.enabledWidgets;
  if (!enabledWidgets.includes(widgetId)) return prefs;
  return {
    ...prefs,
    widgets: {
      ...prefs.widgets,
      enabledWidgets: enabledWidgets.filter((id) => id !== widgetId),
      widgetsOnTicker: prefs.widgets.widgetsOnTicker.filter((id) => id !== widgetId),
    },
  };
}

/**
 * Default pin config for a newly-added widget.
 *
 * Walkthrough fix 2026-05-11 — testers added widgets and saw nothing
 * "happen" because the widget joined the scrolling ticker tape rather
 * than appearing in the static pinned zone where they expected widget-
 * style controls (clock, weather, etc.) to live. Defaulting to a
 * right-side pin on row 0 means a newly-added widget appears in the
 * pinned zone immediately. Users can still drag or re-pin to the left
 * or unpin to make it scroll.
 *
 * Lives in one place so the catalog add path, the sidebar toggle path,
 * and the first-time toggleWidgetPin default all stay consistent.
 */
export function defaultPinForNewWidget(): WidgetPinConfig {
  return { side: "right" };
}

/** Toggle a widget's pin state. Returns a new AppPreferences. */
export function toggleWidgetPin(prefs: AppPreferences, widgetId: string): AppPreferences {
  const pinned = { ...prefs.widgets.pinnedWidgets };
  if (pinned[widgetId]) {
    delete pinned[widgetId];
  } else {
    // First-time pin from the toggle uses the same default as a
    // brand-new widget so the manual-pin path doesn't diverge from
    // the auto-pin path.
    pinned[widgetId] = defaultPinForNewWidget();
  }
  return {
    ...prefs,
    widgets: { ...prefs.widgets, pinnedWidgets: pinned },
  };
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
