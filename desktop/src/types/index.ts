/**
 * Desktop-local type definitions.
 *
 * Consolidated from extension/utils/types, extension/channels/types,
 * extension/widgets/types, and myscrollr.com/src/datawidgets/types.
 * The desktop is a standalone codebase — no cross-project imports.
 */
import type { DataWidgetRow } from "../api/client";
import type { SportsMeta } from "../api/queries";
import type { GitHubPill, GitHubWorst } from "../widgets/github/types";

// ── Finance ──────────────────────────────────────────────────────

export interface Trade {
  id?: number;
  symbol: string;
  price: number | string;
  previous_close?: number;
  price_change?: number | string;
  percentage_change?: number | string;
  direction?: "up" | "down";
  day_volume?: number;
  last_updated?: string;
  link?: string;
  /**
   * Recent intraday closes, oldest first, written daily by the finance
   * ingester. Absent or empty when nothing has been fetched for the symbol
   * yet — the chip draws nothing rather than inventing a shape.
   */
  sparkline?: number[];
  /**
   * Today's low and high, bounding the chip's day-range rail. Zero or absent
   * means not fetched yet — the rail renders an empty track rather than
   * collapsing, so the chip's height never changes.
   */
  day_low?: number;
  day_high?: number;
}

// ── Sports ───────────────────────────────────────────────────────

export interface Game {
  id: number | string;
  league: string;
  sport: string;
  external_game_id: string;
  link: string;
  home_team_name: string;
  home_team_logo: string;
  home_team_score: number | string;
  home_team_code: string;
  away_team_name: string;
  away_team_logo: string;
  away_team_score: number | string;
  away_team_code: string;
  start_time: string;
  short_detail?: string;
  state?: string;
  status_short?: string;
  status_long?: string;
  timer?: string;
  venue?: string;
  season?: string;
  created_at?: string;
  updated_at?: string;
  /**
   * Current-season table row for each side, when the league has one.
   * Attached by the API on every games read so the chip's detailed row --
   * rank, record, differential or points -- costs no second request.
   * Absent for UFC and Formula 1, which have no table.
   */
  home_standing?: TeamStanding;
  away_standing?: TeamStanding;
}

/** One side's line in the current-season standings. */
export interface TeamStanding {
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  goal_diff: number;
  points_for: number;
  points_against: number;
  otl: number;
}

// ── RSS ─────────────────────────────────────────────────────────

export interface RssItem {
  id: number;
  feed_url: string;
  guid: string;
  title: string;
  link: string;
  description: string;
  source_name: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Feed category ("Markets", "Tech") for the chip's kicker.
   *
   * NOT populated yet. The category lives on `tracked_feeds`, not on
   * the item row, so surfacing it needs either a join in the Go RSS
   * query or a client-side feed_url -> category map built from the
   * catalog. The chip renders correctly without it, which is why the
   * restyle didn't wait.
   */
  category?: string;
}

// ── API Responses ────────────────────────────────────────────────

export interface DashboardResponse {
  data: {
    finance?: Trade[];
    sports?: Game[];
    sports_meta?: SportsMeta;
    rss?: RssItem[];
    [key: string]: unknown;
  };
  preferences?: {
    feed_mode: FeedMode;
    feed_position: "top" | "bottom";
    feed_behavior: "overlay" | "push";
    feed_enabled: boolean;
    enabled_sites: string[];
    disabled_sites: string[];
    subscription_tier?:
      "anonymous" | "free" | "uplink" | "uplink_pro" | "uplink_ultimate";
    // Once-only marker for the first-sign-in default widget (SCROLLR-246):
    // true once `news_npr` has been offered to this account, so App.tsx
    // never re-adds it after the user removes it.
    default_widgets_applied: boolean;
    updated_at: string;
  };
  // Generated from the Go struct — the row shape is the server's to define.
  // (The `& { logto_sub: string }` this used to carry was fiction: Go tags
  // that field `json:"-"`, so it is never on the wire.)
  widgets?: Widget[];
}

// ── Enums ────────────────────────────────────────────────────────

export type FeedMode = "comfort" | "compact";
export type DeliveryMode = "polling" | "sse";

// ── Component Contracts ──────────────────────────────────────────

/** Props passed to every FeedTab component (widgets and widgets). */
export interface FeedTabProps {
  /** Display density — 'comfort' shows more detail, 'compact' is denser. */
  mode: FeedMode;
  /**
   * Per-widget JSONB config from user_widgets.config.
   * Each widget decides what goes here (e.g., selected RSS feeds).
   */
  feedContext: Record<string, unknown>;
  /**
   * The specific widget/widget id being rendered (e.g. "sports_nfl",
   * "finance_crypto"). Lets a shared source FeedTab scope itself to that one
   * widget's fixed dimension (league / asset class / feed). Undefined for a
   * legacy coarse widget, where the FeedTab shows the whole source.
   */
  widgetId?: string;
}

/** Structured info content for the Info tab. */
export interface SourceInfo {
  /** What this source is and what it does. */
  about: string;
  /** How to use it (rendered as bullet points). */
  usage: string[];
}

/** Manifest describing a single widget. */
export interface DataWidgetManifest {
  /** Unique widget identifier (matches widget_type). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short label for sidebar tabs. */
  tabLabel: string;
  /** Brief description. */
  description: string;
  /** DataWidgetRow accent hex color for icon badges, active states, and accents. */
  hex: string;
  /** Lucide icon component rendered at size 14 for sidebar, 20 for header. */
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Info tab content — what this widget is and how to use it. */
  info: SourceInfo;
  /** The React component rendered for this widget's feed view. */
  FeedTab: React.ComponentType<FeedTabProps>;

  // ── Home preview (see datawidgets/home.tsx) ───────────────────
  // Each source owns how it renders on Home. Required, so adding a
  // source cannot silently produce a blank card — TypeScript asks for
  // it. `routes/feed.tsx` used to switch on the source name instead.

  /** The preview rows for this source on the Home feed. */
  HomeRows: React.ComponentType<HomeRowsProps>;

  /**
   * Coerce this source's raw `/dashboard` payload to a flat array.
   * Omit when the payload is already an array, which is every current
   * source; kept for a future source whose payload isn't one.
   */
  normalizeHome?: (raw: unknown) => unknown[];

  /**
   * The one thing worth interrupting someone for, or null.
   *
   * Home's "Happening now" row asks each source this and keeps the top
   * three. OPTIONAL on purpose, unlike HomeRows: the registries are
   * runtime globs that tsc cannot see through, so a required member
   * would not actually be enforced at build time for a source that
   * forgot it — it would just be `undefined` at runtime, in a hero row,
   * on the first screen anyone sees. Optional and explicitly checked is
   * honest about what the type system can promise here.
   *
   * `data` is the SAME array HomeRows receives — normalized and scoped
   * to this widget. Anything else and the headline will contradict the
   * rows directly beneath it.
   *
   * Copy must be template-derived, never editorial: this renders as the
   * app's own voice, and a source cannot know what is actually
   * important to a given person.
   */
  highlight?: (data: unknown[]) => HomeHighlight | null;
}

/** A candidate for Home's "Happening now" row. */
export interface HomeHighlight {
  /** Tabular, scannable: "Inter Miami 2 – 1 LA Galaxy", "NVDA +3.4% today". */
  headline: string;
  /** The supporting formula line: "71' · 2nd half", "$188.52 · top mover". */
  sub: string;
  /** Drives the LIVE badge — and the badge always carries text, not just color. */
  live?: boolean;
  /** Brand hex for the card gradient. Falls back to the widget's own. */
  hex?: string;
}

/** Props every source's `HomeRows` receives. */
export interface HomeRowsProps {
  /** This widget's rows: normalized, then scoped to its own config. */
  data: unknown[];
  /**
   * The whole `dashboard.data`, for the rare source that needs a sibling
   * key — sports reads `sports_meta` to explain an empty league.
   */
  dashboard?: Record<string, unknown>;
  /** Navigates to the widget's own page. */
  onConfigure?: () => void;
}

/** Manifest describing a single widget. */
export interface WidgetManifest {
  /** Unique identifier (e.g. "clock", "weather"). Must not collide with widget IDs. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short label shown on the feed bar tab. */
  tabLabel: string;
  /** Brief description of the widget. */
  description: string;
  /** Brand hex color for the widget. */
  hex: string;
  /** Lucide icon component for sidebar and header display. */
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Info tab content — what this widget is and how to use it. */
  info: SourceInfo;
  /** When true, this widget only works in the desktop app (e.g. system monitor). */
  desktopOnly?: boolean;
  /** The React component rendered inside the feed bar for this widget. */
  FeedTab: React.ComponentType<FeedTabProps>;
}

// ── Widget Chip Data Types ──────────────────────────────────────
// Shared between the ticker data hook and the chip components.

export interface ClockChipData {
  id: string;
  kind: "clock" | "timer";
  label: string;
  value: string;
  detail?: string;
  /** Zone is in its night hours — the cell dims and shows a moon. */
  night?: boolean;
  /** Short UTC offset for the detail row, e.g. "UTC-4". */
  offset?: string;

  // ── Timer only ──
  /** Seconds left; drives the depleting spine. */
  remainingSec?: number;
  /** Total duration the spine measures against. */
  totalSec?: number;
  paused?: boolean;
  /** Wall-clock time the timer ends, for the detail row. */
  endsAt?: string;
}

export interface WeatherChipData {
  id: string;
  label: string;
  temp: string;
  icon: string;
  detail?: string;
  /** The user's unit. `temp` is already formatted in it; the numbers below
   *  stay Celsius (the arithmetic is unit-free) and `formatTempRange` is
   *  the one place that turns low/high into text in this unit. */
  unit: "celsius" | "fahrenheit";
  /** Numeric current/high/low driving the range bar. Degrees Celsius. */
  tempValue?: number;
  high?: number;
  low?: number;
  /** Local night — dims the chip the same way a clock's night zone does. */
  night?: boolean;
  /** Active weather alert headline, e.g. "Storm watch". Replaces the
   *  range bar in the detail row: a warning outranks a temperature. */
  alert?: string;
}

export interface SysmonChipData {
  id: string;
  label: string;
  value: string;
  detail?: string;
  hot?: boolean;
  /**
   * 0-100 for the micro gauge. Separate from `value` because that's a
   * display string that may carry a unit ("450W", "72°C") — the gauge
   * needs a number, and not every metric is a percentage.
   */
  percent?: number;
}

export interface UptimeChipData {
  id: string;
  label: string;
  status: "up" | "down" | "pending" | "maintenance";
  uptime: string;
  detail?: string;
  /** Recent heartbeat status codes for the mini bar (0=down, 1=up, 2=pending, 3=maint). */
  heartbeats?: number[];
  /**
   * How long the monitor has been down ("4m", "2h11m").
   *
   * A down monitor's uptime percentage is the least useful number on
   * the chip — "99.98%" beside a red cap reads as reassurance when the
   * thing is on fire. The design swaps the value slot for this instead.
   * Derived from the heartbeat history, so it's absent when we have no
   * history to measure against.
   */
  outageFor?: string;
  /** Median response time over the heartbeat window ("187ms avg"). */
  responseAvg?: string;
}

/** One tracked repo on the bar (SCROLLR-312): a page cell, an edge slot item, a rail chip. */
export interface GitHubChipData {
  /** `github-owner/name`. */
  id: string;
  /** "owner/name". */
  repo: string;
  /** The repo's name. */
  label: string;
  /** Worst first (`pillsFor`); none in quiet hours. */
  pills: GitHubPill[];
  /** The dot: the first pill's kind (`worstOf`); `none` in quiet hours. */
  worst: GitHubWorst;
  /** Age of the newest event the cell knows of ("12m"). */
  age: string;
  /** The most urgent pill's link, else the repo. */
  url: string;
  /** Quiet hours: the slot greys, nothing flashes, the page goes. */
  quiet: boolean;
  /** GitHub would not say (no access, gone, never ran). */
  available: boolean;
  /** Counts worthy changes (`nextFlash`); 0 until the first. Absent with the flash off. */
  flash?: number;
  flashTone?: "up" | "down";
}

export interface WidgetTickerData {
  clock: ClockChipData[];
  timer: ClockChipData[];
  weather: WeatherChipData[];
  sysmon: SysmonChipData[];
  uptime: UptimeChipData[];
  github: GitHubChipData[];
}

import type { Widget, WidgetDef, CatalogResponse } from "./api.generated";

// ── Widget catalog (wire types for GET /catalog) ─────────────────
// These are aliases onto the generated contract (VISION §4.6) — the names
// the client code already uses, pointed at the Go structs that actually
// serialize the response. Change the Go struct, run `go -C api run
// ./cmd/gents`, and every consumer here follows.

/** One entry of GET /catalog. */
export type CatalogWidget = WidgetDef;

/** The GET /catalog response. */
export type CatalogPayload = CatalogResponse;
