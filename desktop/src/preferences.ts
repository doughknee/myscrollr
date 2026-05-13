// ── Preferences system ──────────────────────────────────────────
// Centralized types, defaults, and helpers for all desktop settings.
// All prefs are persisted via Tauri plugin-store (disk-backed).

import { getStore, setStore } from "./lib/store";
import { getTier } from "./auth";
import { getMaxTickerRows } from "./tierLimits";

// ── Types ────────────────────────────────────────────────────────

/**
 * Color mode controls light/dark resolution, independent of the
 * selected theme family. "system" follows the OS preference.
 *
 * Historically this type was called `Theme` and lived on
 * `appearance.theme`. As of the multi-theme refactor, the field is
 * `appearance.themeMode` and is paired with `appearance.themeFamily`.
 * The legacy `Theme` alias is kept as a deprecated export for any
 * consumer that hasn't been migrated yet.
 */
export type ThemeMode = "light" | "dark" | "system";

/** @deprecated Use `ThemeMode` instead. */
export type Theme = ThemeMode;

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

export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

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
export type ChipColorMode = "channel" | "accent" | "muted";
export type TickerDirection = "left" | "right";
export type ScrollMode = "continuous" | "step" | "flip";
export type PinSide = "left" | "right";

export type FontWeight = "normal" | "medium" | "bold";

/** Content + optional customization for a single ticker row. */
export interface TickerRowConfig {
  /**
   * Channel/widget IDs shown on this row. Empty array falls back to
   * "all sources visible in activeTabs" — behaves like 1-row mode.
   */
  sources: string[];

  // ── Per-row scroll overrides (Ultimate-only) ──
  // When undefined, the row inherits the global prefs (prefs.ticker.*).
  scrollMode?: ScrollMode;
  direction?: TickerDirection;
  speed?: number;
  mixMode?: MixMode;
}

export interface TickerLayout {
  /** length 1..MaxTickerRows (tier-clamped on read) */
  rows: TickerRowConfig[];
}

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
  /**
   * Source of truth for the multi-row ticker layout. The number of
   * rows visible on the ticker is `tickerLayout.rows.length`; per-row
   * source assignments live on `rows[i].sources[]`.
   *
   * Window-height math (App.tsx) and the row pickers on Home / Settings
   * / tray all read directly from this single field — no derived
   * scalars, no mirror values.
   */
  tickerLayout: TickerLayout;
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
  showChannelIcons: boolean;
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
  /** Which ticker row this pin belongs to (0-indexed). Defaults to 0. */
  row?: number;
}

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

// ── Channel display preferences ─────────────────────────────────
// Controls what data is shown in FeedTabs and ticker chips.
// Sports display prefs live server-side (useSportsConfig), not here.

/**
 * Four-state visibility control for channel display settings.
 *
 *   off     — hidden everywhere
 *   feed    — shown on the feed page only; hidden from the ticker
 *   both    — shown in both places (default for migrated `true` booleans)
 *   ticker  — shown on the always-on-top ticker only; hidden from the feed
 *
 * See docs/superpowers/specs/2026-04-25-display-venue-toggle-design.md
 * for the rationale. The `VenueRow` component in SettingsControls
 * renders a segmented control for switching between these states.
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
  if (raw === "off" || raw === "feed" || raw === "both" || raw === "ticker") {
    return raw;
  }
  if (raw === true) return "both";
  if (raw === false) return "off";
  return "both";
}

/**
 * Decompose a `Venue` enum into the two booleans used by
 * `<DisplayLocationGrid>` (one checkbox per surface). The grid renders
 * each row as `[Feed checkbox] [Ticker checkbox]` and writes back via
 * `boolsToEnum`. Keeping the conversion in one place prevents drift
 * between the persisted enum and the UI's two-checkbox view.
 */
export function enumToBools(venue: Venue): {
  feed: boolean;
  ticker: boolean;
} {
  return {
    feed: shouldShowOnFeed(venue),
    ticker: shouldShowOnTicker(venue),
  };
}

/**
 * Inverse of `enumToBools`. Combines the two surface checkboxes back
 * into a single `Venue` for storage. The four combinations exhaust
 * the enum:
 *
 *   feed=false ticker=false → "off"
 *   feed=true  ticker=false → "feed"
 *   feed=false ticker=true  → "ticker"
 *   feed=true  ticker=true  → "both"
 */
export function boolsToEnum(feed: boolean, ticker: boolean): Venue {
  if (feed && ticker) return "both";
  if (feed) return "feed";
  if (ticker) return "ticker";
  return "off";
}

export interface FinanceDisplayPrefs {
  showChange: Venue;
  showPrevClose: Venue;
  showLastUpdated: Venue;
  defaultSort: "alpha" | "price" | "change" | "updated";
  /**
   * Feed density. "comfort" (default) renders the two-row card with
   * symbol + category badge + price + change + relative timestamp.
   * "compact" renders a single-row condensed view — symbol, price,
   * percent only — and stacks roughly twice as many tickers per
   * viewport. Drives the per-row component in FeedTab.
   */
  feedDensity: "compact" | "comfort";
  /**
   * Direction marker on the ticker chip. "arrow" uses ▲▼ glyphs,
   * "sign" uses +/− text, "none" hides the marker entirely
   * (% change still renders, just without the leading marker).
   */
  tickerDirectionMarker: "arrow" | "sign" | "none";
}

export interface RssDisplayPrefs {
  showDescription: Venue;
  showSource: Venue;
  showTimestamps: Venue;
  articlesPerSource: number; // 1, 3, 5, 10, or 0 (all) — feed-only structural
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

export interface ChannelDisplayPrefs {
  finance: FinanceDisplayPrefs;
  rss: RssDisplayPrefs;
  fantasy: FantasyDisplayPrefs;
}

/**
 * Per-channel homepage preview filter.
 *
 * Keys are group identifiers: symbols for finance, league names for
 * sports, source names for rss, and league keys for fantasy.
 * An empty array means "auto" — use default sort/slice.
 */
export type HomePreview = Record<string, string[]>;

export interface AppPreferences {
  appearance: AppearancePrefs;
  ticker: TickerPrefs;
  startup: StartupPrefs;
  window: WindowPrefs;
  taskbar: TaskbarPrefs;
  widgets: WidgetPrefs;
  channelDisplay: ChannelDisplayPrefs;
  /** Per-channel homepage preview selections (up to 5 group keys). */
  homePreview: HomePreview;
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

const DEFAULT_TICKER_LAYOUT: TickerLayout = {
  rows: [{ sources: [] }],
};

const DEFAULT_APPEARANCE: AppearancePrefs = {
  themeFamily: "scrollr",
  themeMode: "system",
  uiScale: 100,
  tickerScale: 100,
  tickerLayout: { rows: [{ sources: [] }] },
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
  chipColors: "channel",
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
  showChannelIcons: true,
  showConnectionIndicator: true,
  showCanvasToggle: true,
  taskbarHeight: "default",
  pinnedActions: ["showTicker", "width", "pinned"],
};

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

export const DEFAULT_WEATHER_TICKER: WeatherTickerConfig = {
  excludedCities: [],
};

export const DEFAULT_SYSMON_TICKER: SysmonTickerConfig = {
  cpu: true,
  memory: true,
  gpu: false,
  gpuPower: false,
};

export const DEFAULT_UPTIME_TICKER: UptimeTickerConfig = {
  excludedMonitors: [],
};

export const DEFAULT_GITHUB_TICKER: GitHubTickerConfig = {
  excludedRepos: [],
};

const DEFAULT_CHANNEL_DISPLAY: ChannelDisplayPrefs = {
  finance: {
    showChange: "both",
    showPrevClose: "both",
    showLastUpdated: "both",
    defaultSort: "alpha",
    feedDensity: "comfort",
    tickerDirectionMarker: "arrow",
  },
  rss: {
    showDescription: "both",
    showSource: "both",
    showTimestamps: "both",
    articlesPerSource: 4,
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

const DEFAULT_PREFS: AppPreferences = {
  appearance: DEFAULT_APPEARANCE,
  ticker: DEFAULT_TICKER,
  startup: DEFAULT_STARTUP,
  window: DEFAULT_WINDOW,
  taskbar: DEFAULT_TASKBAR,
  widgets: DEFAULT_WIDGETS,
  channelDisplay: DEFAULT_CHANNEL_DISPLAY,
  homePreview: {},
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
  const legacyClockTicker = obj(clk?.ticker);
  const { activeTimer: _legacyActiveTimer, ...clockTicker } = legacyClockTicker ?? {};
  void _legacyActiveTimer;
  const timerTicker = obj(tmr?.ticker);

  const savedEnabledWidgets = Array.isArray(saved.enabledWidgets) ? saved.enabledWidgets : DEFAULT_WIDGETS.enabledWidgets;
  const savedWidgetsOnTicker = Array.isArray(saved.widgetsOnTicker) ? saved.widgetsOnTicker : savedEnabledWidgets;
  const hasLegacyTimerPrefs = !tmr;
  const shouldEnableLegacyTimer = hasLegacyTimerPrefs && savedEnabledWidgets.includes("clock");
  const shouldShowLegacyTimerOnTicker = hasLegacyTimerPrefs && legacyClockTicker?.activeTimer !== false && savedWidgetsOnTicker.includes("clock");
  const enabledWidgets = shouldEnableLegacyTimer && !savedEnabledWidgets.includes("timer")
    ? [...savedEnabledWidgets, "timer"]
    : savedEnabledWidgets;
  const widgetsOnTicker = shouldShowLegacyTimerOnTicker && !savedWidgetsOnTicker.includes("timer")
    ? [...savedWidgetsOnTicker, "timer"]
    : savedWidgetsOnTicker;

  return {
    enabledWidgets,
    // Migration: if widgetsOnTicker doesn't exist, default to enabledWidgets
    widgetsOnTicker,
    pinnedWidgets: (saved.pinnedWidgets != null && typeof saved.pinnedWidgets === "object" && !Array.isArray(saved.pinnedWidgets))
      ? saved.pinnedWidgets as Record<string, WidgetPinConfig>
      : {},
    clock: {
      ticker: { ...DEFAULT_CLOCK_TICKER, ...clockTicker },
    },
    timer: {
      ticker: {
        ...DEFAULT_TIMER_TICKER,
        activeTimer:
          typeof timerTicker?.activeTimer === "boolean"
            ? Boolean(timerTicker.activeTimer)
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
    weather: {
      ticker: { ...DEFAULT_WEATHER_TICKER, ...obj(wth?.ticker) },
    },
    sysmon: {
      refreshInterval: typeof sys?.refreshInterval === "number" ? sys.refreshInterval : DEFAULT_WIDGETS.sysmon.refreshInterval,
      tempUnit: (sys?.tempUnit as TempUnit) ?? DEFAULT_WIDGETS.sysmon.tempUnit,
      ticker: { ...DEFAULT_SYSMON_TICKER, ...obj(sys?.ticker) },
    },
    uptime: {
      url: typeof upt?.url === "string" ? upt.url : DEFAULT_WIDGETS.uptime.url,
      pollInterval: typeof upt?.pollInterval === "number" ? upt.pollInterval : DEFAULT_WIDGETS.uptime.pollInterval,
      ticker: { ...DEFAULT_UPTIME_TICKER, ...obj(upt?.ticker) },
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
      ticker: { ...DEFAULT_GITHUB_TICKER, ...obj(ghb?.ticker) },
    },
  };
}

// ── Ticker layout migration ─────────────────────────────────────

/** Clamp any number to the inclusive 1..3 range used for row counts. */
function clampRowCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return Math.round(n);
}

/**
 * Build or migrate `tickerLayout` from a saved AppearancePrefs fragment.
 *
 * Responsibilities:
 *   1. Synthesize a layout when none exists. We derive the row count
 *      from the legacy `tickerRows` field if present (some users still
 *      have it on disk from pre-multi-row builds); sources default to
 *      [] = "show all visible tabs".
 *   2. Tier-clamp the row count — if the current tier allows fewer rows
 *      than stored, drop from the BOTTOM so row 0 is preserved.
 *
 * Returns a `changed` flag when the user lost pinned sources due to the
 * tier-clamp (i.e. removed rows had non-empty `sources`). The caller is
 * expected to surface a toast so the user understands why their layout
 * shrank — silent data loss on tier downgrade is an UX trap.
 */
function migrateTickerLayout(
  saved: (Partial<AppearancePrefs> & { tickerRows?: unknown }) | undefined,
): {
  layout: TickerLayout;
  changed: boolean;
  /** Pre-clamp rows, populated only when `changed === true`. */
  preClampRows?: TickerRowConfig[];
  /** Sources from dropped rows, populated only when `changed === true`. */
  droppedSources?: string[];
} {
  // Legacy path: pre-multi-row builds persisted a `tickerRows: 1|2|3`
  // scalar but no `tickerLayout`. We accept it on read so existing users
  // upgrade cleanly, but we never write it back — the layout is the
  // authoritative shape.
  const legacyRows =
    typeof saved?.tickerRows === "number" ? saved.tickerRows : 1;
  const fallbackRowCount = clampRowCount(legacyRows);

  const savedLayout = saved?.tickerLayout;
  let rows: TickerRowConfig[];

  const isValidRow = (r: unknown): r is TickerRowConfig => {
    if (r == null || typeof r !== "object") return false;
    const rec = r as Record<string, unknown>;
    return Array.isArray(rec.sources) && rec.sources.every((s) => typeof s === "string");
  };

  if (
    savedLayout &&
    typeof savedLayout === "object" &&
    Array.isArray((savedLayout as TickerLayout).rows) &&
    (savedLayout as TickerLayout).rows.every(isValidRow) &&
    (savedLayout as TickerLayout).rows.length > 0
  ) {
    rows = (savedLayout as TickerLayout).rows.map((r) => ({ ...r, sources: [...r.sources] }));
  } else {
    // Synthesize N empty-sourced rows from the legacy tickerRows field.
    rows = Array.from({ length: fallbackRowCount }, () => ({ sources: [] }));
  }

  // Tier-clamp on read. Reading auth synchronously; if auth isn't ready
  // yet (e.g. first paint) getTier() returns "free" — which just clamps
  // to 1 row, the safest fallback. Subsequent loads post-auth will reflect
  // the real tier.
  let maxRows = 3;
  try {
    maxRows = getMaxTickerRows(getTier());
  } catch {
    maxRows = 3;
  }

  let changed = false;
  let preClampRows: TickerRowConfig[] | undefined;
  let droppedSources: string[] | undefined;

  if (rows.length > maxRows) {
    // Inspect the rows we're about to drop. Only flag the layout as
    // "changed" if the user actually loses pinned sources — empty rows
    // sliced off don't warrant a toast.
    const dropped = rows.slice(maxRows);
    const lostSources = dropped.some((r) => r.sources.length > 0);

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        `[prefs] tickerLayout clamped from ${rows.length} to ${maxRows} rows (tier cap)`,
      );
    }

    if (lostSources) {
      // Snapshot the unclamped rows so the shell can offer Undo via
      // the tier-downgrade toast. This is a deep copy already (we
      // cloned each row's sources above on line ~734).
      preClampRows = rows.map((r) => ({ ...r, sources: [...r.sources] }));
      droppedSources = dropped.flatMap((r) => r.sources);
    }

    rows = rows.slice(0, maxRows);
    changed = lostSources;
  }

  if (rows.length === 0) rows = [{ sources: [] }];

  return { layout: { rows }, changed, preClampRows, droppedSources };
}

// ── Transient signal: tickerLayout was clamped on the most recent load ──
//
// `loadPrefs` runs as a `useState` initializer in two places (the ticker
// window and the main window). Returning a tuple from `loadPrefs` would
// force both call sites to restructure for a flag only the main window
// cares about. Instead we stash the flag here and let the main window
// call `consumeTickerLayoutChanged()` once mounted, which reads and
// clears it. The ticker window simply ignores the signal.

/**
 * Details captured the last time `loadPrefs` had to drop rows due to a
 * tier downgrade. `null` means the most recent load did not lose any
 * pinned sources.
 */
export interface TickerLayoutChangedDetails {
  /** The pre-clamp row layout — used to power the toast's Undo. */
  preClampRows: TickerRowConfig[];
  /** Sources that were on rows that got dropped. Surfaced in toast copy. */
  droppedSources: string[];
}

let tickerLayoutChangedSignal: TickerLayoutChangedDetails | null = null;

/**
 * Consume the tier-clamp signal exactly once.
 *
 * Returns the change details (pre-clamp rows + dropped source ids) if
 * the most recent `loadPrefs()` call clamped the ticker layout AND the
 * dropped rows held pinned sources. Returns `null` otherwise.
 *
 * Subsequent calls return `null` until the next `loadPrefs()` triggers
 * another clamp. The shell's `useEffect` reads this once on mount and
 * pipes the details into a toast with an Undo button (Phase 1, Apr 26).
 */
export function consumeTickerLayoutChanged(): TickerLayoutChangedDetails | null {
  const v = tickerLayoutChangedSignal;
  tickerLayoutChangedSignal = null;
  return v;
}

// ── Channel display migrations (v1.0.2 venue-enum migration) ────
//
// Each channel's display prefs went from all-booleans to `Venue` strings
// in v1.0.2 (see 2026-04-25-display-venue-toggle-design.md). These
// helpers run `migrateVenue` on every field that was previously a
// boolean; unknown and never-seen fields get the `"both"` default so new
// channels and new fields are visible immediately post-upgrade.

export function migrateFinanceDisplay(
  saved: Partial<FinanceDisplayPrefs> | undefined,
): FinanceDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;
  const density =
    raw.feedDensity === "compact" || raw.feedDensity === "comfort"
      ? raw.feedDensity
      : DEFAULT_CHANNEL_DISPLAY.finance.feedDensity;
  const dirMarker =
    raw.tickerDirectionMarker === "arrow" ||
    raw.tickerDirectionMarker === "sign" ||
    raw.tickerDirectionMarker === "none"
      ? raw.tickerDirectionMarker
      : DEFAULT_CHANNEL_DISPLAY.finance.tickerDirectionMarker;
  return {
    ...DEFAULT_CHANNEL_DISPLAY.finance,
    showChange: migrateVenue(raw.showChange),
    showPrevClose: migrateVenue(raw.showPrevClose),
    showLastUpdated: migrateVenue(raw.showLastUpdated),
    defaultSort:
      (raw.defaultSort as FinanceDisplayPrefs["defaultSort"] | undefined) ??
      DEFAULT_CHANNEL_DISPLAY.finance.defaultSort,
    feedDensity: density,
    tickerDirectionMarker: dirMarker,
  };
}

export function migrateRssDisplay(
  saved: Partial<RssDisplayPrefs> | undefined,
): RssDisplayPrefs {
  const raw = (saved ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULT_CHANNEL_DISPLAY.rss,
    showDescription: migrateVenue(raw.showDescription),
    showSource: migrateVenue(raw.showSource),
    showTimestamps: migrateVenue(raw.showTimestamps),
    articlesPerSource:
      typeof raw.articlesPerSource === "number"
        ? raw.articlesPerSource
        : DEFAULT_CHANNEL_DISPLAY.rss.articlesPerSource,
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
    ...DEFAULT_CHANNEL_DISPLAY.fantasy,
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
    // visible by default. The DEFAULT_CHANNEL_DISPLAY values above
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
      : DEFAULT_CHANNEL_DISPLAY.fantasy.followedPlayerKeys,
    showStandings:
      typeof raw.showStandings === "boolean"
        ? raw.showStandings
        : DEFAULT_CHANNEL_DISPLAY.fantasy.showStandings,
    showMatchups:
      typeof raw.showMatchups === "boolean"
        ? raw.showMatchups
        : DEFAULT_CHANNEL_DISPLAY.fantasy.showMatchups,
    defaultSort:
      (raw.defaultSort as FantasyDisplayPrefs["defaultSort"] | undefined) ??
      DEFAULT_CHANNEL_DISPLAY.fantasy.defaultSort,
    defaultSubTab:
      (raw.defaultSubTab as FantasyDisplayPrefs["defaultSubTab"] | undefined) ??
      DEFAULT_CHANNEL_DISPLAY.fantasy.defaultSubTab,
    primaryLeagueKey:
      typeof raw.primaryLeagueKey === "string" || raw.primaryLeagueKey === null
        ? (raw.primaryLeagueKey as string | null)
        : DEFAULT_CHANNEL_DISPLAY.fantasy.primaryLeagueKey,
    enabledLeagueKeys: Array.isArray(raw.enabledLeagueKeys)
      ? (raw.enabledLeagueKeys as string[])
      : DEFAULT_CHANNEL_DISPLAY.fantasy.enabledLeagueKeys,
  };
}

export function loadPrefs(): AppPreferences {
  try {
    const saved = getStore<Record<string, unknown> | null>(PREFIX, null);
    if (!saved) return { ...DEFAULT_PREFS };

    // Detect v1 format: has "general" key but no "appearance" key
    const isV1 = "general" in saved && !("appearance" in saved);
    const source = isV1 ? migrateV1(saved) : (saved as Partial<AppPreferences>);

    // Deep merge with defaults so new keys are always present
    const savedDisplay = source.channelDisplay as Partial<ChannelDisplayPrefs> | undefined;
    const layoutResult = migrateTickerLayout(
      source.appearance as Partial<AppearancePrefs> | undefined,
    );
    // Latch the "user lost rows" signal for the main window to read
    // once via consumeTickerLayoutChanged(). This must come before the
    // function returns — see the helper's docs for why we don't pipe
    // it through the return value. We carry the pre-clamp rows + the
    // dropped source ids alongside the flag so the shell's toast can
    // offer Undo (Phase 1, Apr 26) AND tell the user which sources
    // were affected, instead of the previous generic "your layout
    // was simplified" wording.
    if (
      layoutResult.changed &&
      layoutResult.preClampRows &&
      layoutResult.droppedSources
    ) {
      tickerLayoutChangedSignal = {
        preClampRows: layoutResult.preClampRows,
        droppedSources: layoutResult.droppedSources,
      };
    }
    // Strip any legacy `tickerRows` field that might still be sitting
    // on disk from pre-multi-row builds. The layout is the source of
    // truth; persisting a derived scalar alongside it caused the
    // Home/Settings drift this refactor was written to kill.
    const savedAppearance = source.appearance as
      | (Partial<AppearancePrefs> & {
          tickerRows?: unknown;
          theme?: unknown;
        })
      | undefined;
    // Strip legacy fields:
    //  - `tickerRows` was a derived scalar from pre-multi-row builds.
    //  - `theme` was the pre-multi-theme color-mode field; the
    //    migration helper below folds it into themeMode + themeFamily.
    const {
      tickerRows: _legacyTickerRows,
      theme: _legacyTheme,
      themeFamily: _savedFamily,
      themeMode: _savedMode,
      ...appearanceRest
    } = savedAppearance ?? {};
    void _legacyTickerRows; // intentionally discarded
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
      tickerLayout: layoutResult.layout,
    };
    const merged: AppPreferences = {
      appearance: mergedAppearance,
      ticker: { ...DEFAULT_TICKER, ...source.ticker },
      startup: { ...DEFAULT_STARTUP, ...source.startup },
      window: { ...DEFAULT_WINDOW, ...source.window },
      taskbar: { ...DEFAULT_TASKBAR, ...source.taskbar },
      widgets: mergeWidgetPrefs(source.widgets as Partial<WidgetPrefs> | undefined),
      channelDisplay: {
        finance: migrateFinanceDisplay(savedDisplay?.finance),
        rss: migrateRssDisplay(savedDisplay?.rss),
        fantasy: migrateFantasyDisplay(savedDisplay?.fantasy),
      },
      homePreview:
        source.homePreview && typeof source.homePreview === "object" && !Array.isArray(source.homePreview)
          ? (source.homePreview as HomePreview)
          : {},
      // Tolerate older builds that didn't have `tipsShown`. Treat
      // missing/invalid as "no tips shown yet" so the user gets a
      // proper first-run experience after upgrading.
      tipsShown: Array.isArray(source.tipsShown)
        ? (source.tipsShown.filter((id) => typeof id === "string") as string[])
        : [],
    };

    const savedWidgets = source.widgets as Record<string, unknown> | undefined;
    const savedClock = savedWidgets?.clock != null && typeof savedWidgets.clock === "object"
      ? (savedWidgets.clock as Record<string, unknown>)
      : undefined;
    const savedClockTicker = savedClock?.ticker != null && typeof savedClock.ticker === "object"
      ? (savedClock.ticker as Record<string, unknown>)
      : undefined;
    const hasSavedTimerPrefs = savedWidgets?.timer != null && typeof savedWidgets.timer === "object";
    const savedWidgetIdsOnTicker = Array.isArray(savedWidgets?.widgetsOnTicker)
      ? (savedWidgets.widgetsOnTicker as unknown[]).filter((id): id is string => typeof id === "string")
      : Array.isArray(savedWidgets?.enabledWidgets)
        ? (savedWidgets.enabledWidgets as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
    const shouldMigrateTimerRows =
      !hasSavedTimerPrefs &&
      savedClockTicker?.activeTimer !== false &&
      savedWidgetIdsOnTicker.includes("clock") &&
      !savedWidgetIdsOnTicker.includes("timer");
    if (shouldMigrateTimerRows) {
      let rowsChanged = false;
      const rows = merged.appearance.tickerLayout.rows.map((row) => {
        if (!row.sources.includes("clock") || row.sources.includes("timer")) return row;
        rowsChanged = true;
        return { ...row, sources: [...row.sources, "timer"] };
      });

      if (rowsChanged) {
        merged.appearance = {
          ...merged.appearance,
          tickerLayout: { rows },
        };
      }
    }

    // Clamp any widget pin rows that reference rows above the current
    // layout's row count (e.g. user downgraded from Pro to Uplink and
    // lost row 2). See spec §Edge Cases #2 — pins on dropped rows
    // reassign to row 0, not silently reduced, so the user sees them.
    const layoutRowCount = merged.appearance.tickerLayout.rows.length;
    let pinsChanged = false;
    const clampedPins: Record<string, WidgetPinConfig> = {};
    for (const [widgetId, pin] of Object.entries(merged.widgets.pinnedWidgets)) {
      const currentRow = pin.row ?? 0;
      if (currentRow >= layoutRowCount) {
        clampedPins[widgetId] = { ...pin, row: 0 };
        pinsChanged = true;
      } else {
        clampedPins[widgetId] = pin;
      }
    }
    if (pinsChanged) {
      merged.widgets = { ...merged.widgets, pinnedWidgets: clampedPins };
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
    appearance: { ...DEFAULT_APPEARANCE, tickerLayout: { rows: [{ sources: [] }] } },
    ticker: { ...DEFAULT_TICKER },
    startup: { ...DEFAULT_STARTUP },
    window: { ...DEFAULT_WINDOW },
    taskbar: { ...DEFAULT_TASKBAR },
    widgets: { ...DEFAULT_WIDGETS },
    channelDisplay: { ...DEFAULT_CHANNEL_DISPLAY },
    homePreview: {},
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
 * @deprecated Use `resolveThemeMode` instead.
 * Kept as a thin alias so older imports continue to compile during
 * the multi-theme rollout. Will be removed once all call sites are
 * migrated.
 */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return resolveThemeMode(mode);
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
 * responsible for merging the rest of AppearancePrefs (tickerLayout,
 * uiScale, fontWeight, highContrast) against DEFAULT_APPEARANCE.
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

/**
 * Replace the ticker layout. The only sanctioned writer for
 * `appearance.tickerLayout` — call this from any helper that needs to
 * mutate rows so the empty-row fallback stays consistent.
 *
 * Always preserves at least one row: callers cannot end up with a
 * zero-row layout via this helper.
 */
export function setTickerLayout(
  prefs: AppPreferences,
  layout: TickerLayout,
): AppPreferences {
  const rows = layout.rows.length > 0 ? layout.rows : [{ sources: [] }];
  return {
    ...prefs,
    appearance: {
      ...prefs.appearance,
      tickerLayout: { rows },
    },
  };
}

/**
 * Drop a row from the layout at `index`. Any pinned widgets that
 * target the removed row (or any row above it) are re-mapped:
 *   - Pins on the removed row → row 0
 *   - Pins on rows above `index` → row - 1 (shifted up)
 *
 * See spec §Edge Cases #3 — removed-row pins fall back to row 0, not
 * a neighbour, so users notice the widget rather than silently moving
 * it somewhere they didn't expect.
 */
export function removeTickerRow(
  prefs: AppPreferences,
  index: number,
): AppPreferences {
  const rows = prefs.appearance.tickerLayout.rows;
  if (rows.length <= 1) return prefs; // never drop the last row
  if (index < 0 || index >= rows.length) return prefs;

  const nextRows = rows.filter((_, i) => i !== index);
  const nextPinned: Record<string, WidgetPinConfig> = {};
  for (const [widgetId, pin] of Object.entries(prefs.widgets.pinnedWidgets)) {
    const currentRow = pin.row ?? 0;
    let nextRow: number;
    if (currentRow === index) {
      nextRow = 0;
    } else if (currentRow > index) {
      nextRow = currentRow - 1;
    } else {
      nextRow = currentRow;
    }
    nextPinned[widgetId] = { ...pin, row: nextRow };
  }

  const withLayout = setTickerLayout(prefs, { rows: nextRows });
  return {
    ...withLayout,
    widgets: { ...withLayout.widgets, pinnedWidgets: nextPinned },
  };
}

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
  return { side: "right", row: 0 };
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

// ── Unified ticker row selector helpers ─────────────────────────
//
// Stream 3 of Batch D collapses three duplicate ticker visibility
// surfaces (tray Channels submenu, feed page Eye/EyeOff button,
// Settings source picker) into a single mental model:
//
//     "Where should this source appear?  Off / Row 1 / Row 2 / Row 3"
//
// The new RowSelector UI calls these helpers. They keep BOTH data
// layers in sync:
//   - `tickerLayout.rows[i].sources[]` (client-side prefs) — controls
//     per-row inclusion. Source of truth for which row a source
//     appears on.
//   - `Channel.ticker_enabled` (server-side) — controls the master
//     gate via App.tsx's filter on `ch.enabled && isChannelTickerEnabled`.
//     Set to true when row != null, false when row == null. Callers
//     issue `channelsApi.update` separately; these helpers only mutate
//     the client-side AppPreferences.
//
// Widgets also keep `widgets.widgetsOnTicker` in sync because it is the
// master render gate for widget ticker data.
// See docs/superpowers/specs/2026-04-28-batch-d-…-design.md §Stream 3.

/** Minimal shape of a Channel record used by `getChannelTickerRow`. */
interface ChannelTickerInfo {
  channel_type: string;
  ticker_enabled?: boolean;
  /** @deprecated server-side legacy alias for ticker_enabled. */
  visible?: boolean;
}

/**
 * Read the row index where this source currently appears, or null if off.
 *
 * Resolution order:
 *   1. If `sourceId` appears in any `tickerLayout.rows[i].sources[]`,
 *      return that row index `i`.
 *   2. Else, if `channelInfo` is provided and its `ticker_enabled` flag
 *      is true (legacy default), return 0.
 *   3. Else return null (off).
 *
 * `channelInfo` is optional because widgets don't have a server-side
 * ticker_enabled flag — pass `null` for widget IDs.
 */
export function getSourceTickerRow(
  prefs: AppPreferences,
  channelInfo: ChannelTickerInfo | null,
  sourceId: string,
): number | null {
  // Step 1: explicit assignment in tickerLayout
  const rows = prefs.appearance.tickerLayout?.rows ?? [];
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]?.sources ?? []).includes(sourceId)) {
      return i;
    }
  }

  // Step 2: legacy fallback via Channel.ticker_enabled (channels only)
  if (!channelInfo) return null;
  const tickerEnabled =
    typeof channelInfo.ticker_enabled === "boolean"
      ? channelInfo.ticker_enabled
      : typeof channelInfo.visible === "boolean"
        ? channelInfo.visible
        : true;
  return tickerEnabled ? 0 : null;
}

/**
 * Convenience wrapper around `getSourceTickerRow` for channels — accepts
 * a Channel-like object (with `channel_type` + `ticker_enabled`).
 */
export function getChannelTickerRow(
  prefs: AppPreferences,
  channel: ChannelTickerInfo,
): number | null {
  return getSourceTickerRow(prefs, channel, channel.channel_type);
}

/**
 * Convenience wrapper around `getSourceTickerRow` for widgets — widgets
 * only check the client-side `tickerLayout.rows[i].sources[]` layer.
 */
export function getWidgetTickerRow(
  prefs: AppPreferences,
  widgetId: string,
): number | null {
  return getSourceTickerRow(prefs, null, widgetId);
}

/**
 * Move a source to the given row, removing it from any other row first.
 *
 * - `row = null` removes the source from every row (off).
 * - `row = 0..(rows.length-1)` puts the source in that row exclusively.
 * - Out-of-bounds row returns `prefs` unchanged (caller must ensure the
 *   row exists per tier limits).
 *
 * Pure: returns a new AppPreferences. Does NOT issue any API calls;
 * channel-level callers must additionally invoke `channelsApi.update`
 * to flip `ticker_enabled` server-side (true if row !== null).
 */
export function setSourceTickerRow(
  prefs: AppPreferences,
  sourceId: string,
  row: number | null,
): AppPreferences {
  const rows = prefs.appearance.tickerLayout?.rows ?? [];

  if (row !== null && (row < 0 || row >= rows.length)) {
    return prefs;
  }

  // Remove sourceId from every row's sources array
  const cleanedRows: TickerRowConfig[] = rows.map((r) => ({
    ...r,
    sources: (r.sources ?? []).filter((s) => s !== sourceId),
  }));

  if (row !== null) {
    cleanedRows[row] = {
      ...cleanedRows[row],
      sources: [...cleanedRows[row].sources, sourceId],
    };
  }

  return setTickerLayout(prefs, { rows: cleanedRows });
}

/**
 * Move a channel to the given row. See `setSourceTickerRow`. Caller is
 * responsible for the matching `channelsApi.update({ ticker_enabled })`
 * call to keep the server-side flag in sync.
 */
export function setChannelTickerRow(
  prefs: AppPreferences,
  channelType: string,
  row: number | null,
): AppPreferences {
  return setSourceTickerRow(prefs, channelType, row);
}

/**
 * Move a widget to the given row. Widgets have no server-side
 * ticker_enabled — only the client-side layer is touched.
 */
export function setWidgetTickerRow(
  prefs: AppPreferences,
  widgetId: string,
  row: number | null,
): AppPreferences {
  const withRow = setSourceTickerRow(prefs, widgetId, row);
  if (withRow === prefs) return prefs;

  const widgetsOnTicker = withRow.widgets.widgetsOnTicker;
  const nextWidgetsOnTicker = row === null
    ? widgetsOnTicker.filter((id) => id !== widgetId)
    : widgetsOnTicker.includes(widgetId)
      ? widgetsOnTicker
      : [...widgetsOnTicker, widgetId];

  return {
    ...withRow,
    widgets: {
      ...withRow.widgets,
      widgetsOnTicker: nextWidgetsOnTicker,
    },
  };
}

