/**
 * Page inventory for the settings surface.
 *
 * One route (`/customize?page=`) renders seven pages behind a rail. The
 * ids double as the search-param values, so they are part of the URL
 * contract — renaming one breaks saved links and the tray/cross-window
 * navigate channel.
 */
import {
  AppWindow,
  Database,
  Keyboard,
  Palette,
  RadioTower,
  RefreshCw,
  User,
  type LucideIcon,
} from "lucide-react";

export const SETTINGS_PAGES = [
  "appearance",
  "window",
  "shortcuts",
  "ticker",
  "profile",
  "data",
  "updates",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export const DEFAULT_SETTINGS_PAGE: SettingsPage = "appearance";

export function isSettingsPage(value: unknown): value is SettingsPage {
  return (
    typeof value === "string" &&
    (SETTINGS_PAGES as readonly string[]).includes(value)
  );
}

export interface SettingsPageMeta {
  id: SettingsPage;
  /** Rail label and TopBar breadcrumb. */
  label: string;
  /** Page heading. Differs from `label` only where the rail needs to be terser. */
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const SETTINGS_PAGE_META: Record<SettingsPage, SettingsPageMeta> = {
  appearance: {
    id: "appearance",
    label: "Appearance",
    title: "Appearance",
    subtitle: "How the app looks. The ticker follows the same theme.",
    icon: Palette,
  },
  window: {
    id: "window",
    label: "Window & startup",
    title: "Window & startup",
    subtitle: "How Scrollr behaves on your desktop.",
    icon: AppWindow,
  },
  shortcuts: {
    id: "shortcuts",
    label: "Shortcuts",
    title: "Shortcuts",
    subtitle: "Available while Scrollr is the focused app.",
    icon: Keyboard,
  },
  ticker: {
    id: "ticker",
    label: "Ticker",
    title: "Ticker",
    subtitle: "How the pinned ticker strip moves and looks.",
    icon: RadioTower,
  },
  profile: {
    id: "profile",
    label: "Profile & plan",
    title: "Profile & plan",
    subtitle: "Who you're signed in as, and what your plan includes.",
    icon: User,
  },
  data: {
    id: "data",
    label: "Data & privacy",
    title: "Data & privacy",
    subtitle: "Your data belongs to you. Export it, or start fresh.",
    icon: Database,
  },
  updates: {
    id: "updates",
    label: "Updates",
    title: "Updates",
    // Real subtitle is derived from update state at render time; this is
    // the fallback before the version resolves.
    subtitle: "Keep Scrollr up to date.",
    icon: RefreshCw,
  },
};

/** Rail grouping, in display order. */
export const SETTINGS_RAIL_GROUPS: { label: string; pages: SettingsPage[] }[] = [
  { label: "Customize", pages: ["appearance", "window", "shortcuts", "ticker"] },
  { label: "Account", pages: ["profile", "data"] },
  { label: "App", pages: ["updates"] },
];
