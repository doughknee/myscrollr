/**
 * Page inventory for the settings surface.
 *
 * One route (`/customize?page=`) renders seven pages behind a rail. The
 * ids double as the search-param values, so they are part of the URL
 * contract — renaming one breaks saved links and the tray/cross-window
 * navigate channel. When a page is renamed anyway, keep the old id as
 * an alias in `LEGACY_SETTINGS_PAGES` so `resolveSettingsPage` maps it.
 */
import {
  Database,
  Keyboard,
  Palette,
  Power,
  RadioTower,
  RefreshCw,
  User,
  type LucideIcon,
} from "lucide-react";

export const SETTINGS_PAGES = [
  "appearance",
  "startup",
  "shortcuts",
  "ticker",
  "profile",
  "data",
  "updates",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export const DEFAULT_SETTINGS_PAGE: SettingsPage = "appearance";

/** Old ids still accepted in `?page=` so saved links keep working. */
const LEGACY_SETTINGS_PAGES: Record<string, SettingsPage> = {
  // "Window & startup" became "Startup" (REL-206).
  window: "startup",
};

/** `?page=` value → page. Legacy ids map forward; anything else → default. */
export function resolveSettingsPage(value: unknown): SettingsPage {
  if (isSettingsPage(value)) return value;
  if (typeof value === "string" && value in LEGACY_SETTINGS_PAGES) {
    return LEGACY_SETTINGS_PAGES[value];
  }
  return DEFAULT_SETTINGS_PAGE;
}

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
  startup: {
    id: "startup",
    label: "Startup",
    title: "Startup",
    subtitle: "What happens when your computer starts.",
    icon: Power,
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
    subtitle: "The bar: whether it's on, where it lives, how it looks, moves and behaves.",
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
  { label: "Customize", pages: ["appearance", "startup", "shortcuts", "ticker"] },
  { label: "Account", pages: ["profile", "data"] },
  { label: "App", pages: ["updates"] },
];
