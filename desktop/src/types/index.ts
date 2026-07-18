/**
 * Desktop-local type definitions.
 *
 * Consolidated from extension/utils/types, extension/channels/types,
 * extension/widgets/types, and myscrollr.com/src/datawidgets/types.
 * The desktop is a standalone codebase — no cross-project imports.
 */
import type { DataWidgetRow } from "../api/client";
import type { SportsMeta } from "../api/queries";

// ── Finance ──────────────────────────────────────────────────────

export interface Trade {
  id?: number;
  symbol: string;
  price: number | string;
  previous_close?: number;
  price_change?: number | string;
  percentage_change?: number | string;
  direction?: "up" | "down";
  last_updated?: string;
  link?: string;
}

// ── Predictions ──────────────────────────────────────────────────

export interface Prediction {
  id: string;
  source: string;
  ticker: string;
  event_ticker?: string;
  /** The event's human question ("More tech layoffs in 2026 than in
   *  2025?") — `title` is just this market's leg ("Yes", "Atlanta").
   *  Empty until the post-migration sweep backfills it (v1.1.4). */
  event_title?: string;
  /** Leg rank within the event: 1 = most liquid (is_primary), 2 = the
   *  second outcome the server ships for event cards (v1.1.4). */
  event_rank?: number;
  category?: string;
  title: string;
  subtitle?: string;
  yes_price: number;       // cents 0-100 == implied %
  yes_bid?: number;
  yes_ask?: number;
  prev_yes_price?: number; // for ▲/▼ delta
  volume?: number;
  /** Trailing-24h volume — the "Trending" sort key (v1.1.5). Absent on
   *  old payloads; fall back to all-time `volume`. */
  volume_24h?: number;
  open_interest?: number;
  /** False once the market left the server's curated sweep selection
   *  (v1.1.5). Treat undefined (old payloads) as true. */
  in_sweep?: boolean;
  status?: string;
  result?: string;
  /** When the market resolved (once-stamped server-side, v1.1.5).
   *  Preferred over `updated_at` for "Resolved today". RFC3339. */
  settled_at?: string;
  close_time?: string;     // RFC3339
  link?: string;
  updated_at?: string;     // RFC3339
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
}

// ── API Responses ────────────────────────────────────────────────

export interface DashboardResponse {
  data: {
    finance?: Trade[];
    sports?: Game[];
    sports_meta?: SportsMeta;
    rss?: RssItem[];
    predictions?: Prediction[];
    [key: string]: unknown;
  };
  preferences?: {
    feed_mode: FeedMode;
    feed_position: "top" | "bottom";
    feed_behavior: "overlay" | "push";
    feed_enabled: boolean;
    enabled_sites: string[];
    disabled_sites: string[];
    subscription_tier?: "anonymous" | "free" | "uplink" | "uplink_pro" | "uplink_ultimate";
    updated_at: string;
  };
  channels?: Array<DataWidgetRow & { logto_sub: string }>;
}

// ── Enums ────────────────────────────────────────────────────────

export type FeedMode = "comfort" | "compact";
export type DeliveryMode = "polling" | "sse";

// ── Component Contracts ──────────────────────────────────────────

/** Props passed to every FeedTab component (channels and widgets). */
export interface FeedTabProps {
  /** Display density — 'comfort' shows more detail, 'compact' is denser. */
  mode: FeedMode;
  /**
   * Per-channel JSONB config from user_channels.config.
   * Each channel decides what goes here (e.g., selected RSS feeds).
   */
  feedContext: Record<string, unknown>;
  /**
   * The specific widget/channel id being rendered (e.g. "sports_nfl",
   * "finance_crypto"). Lets a shared source FeedTab scope itself to that one
   * widget's fixed dimension (league / asset class / feed). Undefined for a
   * legacy coarse channel, where the FeedTab shows the whole source.
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

/** Manifest describing a single channel. */
export interface DataWidgetManifest {
  /** Unique channel identifier (matches channel_type). */
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
  /** Info tab content — what this channel is and how to use it. */
  info: SourceInfo;
  /** The React component rendered for this channel's feed view. */
  FeedTab: React.ComponentType<FeedTabProps>;
}

/** Manifest describing a single widget. */
export interface WidgetManifest {
  /** Unique identifier (e.g. "clock", "weather"). Must not collide with channel IDs. */
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
}

export interface WeatherChipData {
  id: string;
  label: string;
  temp: string;
  icon: string;
  detail?: string;
}

export interface SysmonChipData {
  id: string;
  label: string;
  value: string;
  detail?: string;
  hot?: boolean;
}

export interface UptimeChipData {
  id: string;
  label: string;
  status: "up" | "down" | "pending" | "maintenance";
  uptime: string;
  detail?: string;
  /** Recent heartbeat status codes for the mini bar (0=down, 1=up, 2=pending, 3=maint). */
  heartbeats?: number[];
}

export interface GitHubChipData {
  id: string;
  label: string;
  status: "success" | "failure" | "in_progress" | "unavailable";
  workflowName: string;
  detail?: string;
}

export interface WidgetTickerData {
  clock: ClockChipData[];
  timer: ClockChipData[];
  weather: WeatherChipData[];
  sysmon: SysmonChipData[];
  uptime: UptimeChipData[];
  github: GitHubChipData[];
}
