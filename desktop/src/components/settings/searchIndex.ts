/**
 * The settings search index.
 *
 * A static, hand-maintained list of every jumpable row. It is not
 * derived from the rendered pages on purpose: rows appear and disappear
 * with preference state (Time per page only in Page mode, Hide when
 * fullscreen only on Windows), and a search that could only find the settings you
 * had already configured your way into would be worse than useless.
 * Everything is findable; following a result may land you on a row that
 * is currently conditional-hidden, which is the honest outcome — the
 * page still tells you why it is not there.
 *
 * Keep in sync by hand when rows are added. `settingsSearchIndex.test.ts`
 * guards the parts that can be checked mechanically.
 */
import type { SettingsPage } from "./pages";

export interface SettingsSearchEntry {
  page: SettingsPage;
  /** Matches the row's `data-row` attribute, for the jump-flash. */
  rowId: string;
  label: string;
  description: string;
  /** Extra search terms that do not appear in the visible copy. */
  keywords: string;
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // ── Appearance ────────────────────────────────────────────────
  {
    page: "appearance",
    rowId: "theme",
    label: "Theme",
    description: "Pick a color palette",
    keywords:
      "palette colors scrollr catppuccin dracula tokyo night nord gruvbox solarized rose pine one everforest",
  },
  {
    page: "appearance",
    rowId: "colorMode",
    label: "Color mode",
    description: "Light, dark, or follow the system",
    keywords: "dark mode light auto",
  },
  {
    page: "appearance",
    rowId: "appSize",
    label: "App size",
    description: "Resize the main app window. The ticker has its own scale.",
    keywords: "zoom scale ui display size",
  },
  {
    page: "appearance",
    rowId: "fontWeight",
    label: "Font weight",
    description: "Increase text thickness for readability",
    keywords: "bold text",
  },
  {
    page: "appearance",
    rowId: "highContrast",
    label: "High contrast text",
    description: "Brighten muted text for easier reading",
    keywords: "accessibility a11y readability",
  },
  {
    page: "appearance",
    rowId: "temperature",
    label: "Temperature",
    description: "Used by Weather and System monitor",
    keywords: "units fahrenheit celsius degrees °F °C sysmon",
  },
  {
    page: "appearance",
    rowId: "timeFormat",
    label: "Time",
    description: "Used by Clock and the ticker",
    keywords: "units format 12h 24h 12-hour 24-hour hour clock am pm",
  },

  // ── Window & startup ──────────────────────────────────────────
  {
    page: "window",
    rowId: "autostart",
    label: "Launch on system startup",
    description: "Open Scrollr when you start your computer",
    keywords: "boot login autostart",
  },
  {
    page: "window",
    rowId: "autoCheck",
    label: "Check for updates on startup",
    description: "Notify me when a new version is available",
    keywords: "update auto",
  },

  // ── Shortcuts ─────────────────────────────────────────────────
  {
    page: "shortcuts",
    rowId: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Open Settings, toggle ticker, cycle theme, and more",
    keywords: "hotkey keys cmd ctrl",
  },

  // ── Ticker (page order: On · Where · Look · Motion · Behaviour) ──
  {
    page: "ticker",
    rowId: "showTicker",
    label: "Show the ticker",
    description: "The bar on your screen",
    keywords: "enable disable on off hide toggle visible",
  },
  {
    page: "ticker",
    rowId: "tickerMonitors",
    label: "Monitors",
    description: "Which screens show the ticker",
    keywords: "display screen second dual multi monitor identify",
  },
  {
    page: "ticker",
    rowId: "screenEdge",
    label: "Screen edge",
    description: "Which edge of the screen the ticker sits on",
    keywords: "top bottom position",
  },
  {
    page: "ticker",
    rowId: "detailLevel",
    label: "Detail level",
    description: "One line per chip, or a detail row under each",
    keywords: "compact detailed comfort",
  },
  {
    page: "ticker",
    rowId: "tickerScale",
    label: "Size",
    description: "Resize the bar",
    keywords: "scale zoom bigger smaller",
  },
  {
    page: "ticker",
    rowId: "chipColors",
    label: "Chip colors",
    description: "Each widget's own color, the theme accent, or subtle grays",
    keywords: "color widget subtle theme",
  },
  {
    page: "ticker",
    rowId: "scrollMode",
    label: "Scroll mode",
    description: "Scroll without stopping, or show a page at a time",
    keywords: "continuous page step rotate",
  },
  {
    page: "ticker",
    rowId: "speed",
    label: "Speed",
    description: "How fast the chips travel",
    keywords: "fast slow normal velocity",
  },
  {
    page: "ticker",
    rowId: "onHover",
    label: "On hover",
    description: "What the bar does while your mouse is over it",
    keywords: "pause stop slow down keep moving mouse hover",
  },
  {
    // Only rendered in Page mode; following the result in Continuous
    // mode lands on the Motion group, which is the honest outcome.
    page: "ticker",
    rowId: "stepPause",
    label: "Time per page",
    description: "How long each page stays before the next one",
    keywords: "dwell pause step interval seconds",
  },
  {
    page: "ticker",
    rowId: "alwaysOnTop",
    label: "Stay above other windows",
    description: "Keep the ticker visible over whatever else is open",
    keywords: "pin float always on top",
  },
  {
    // Windows-only row; "windows" stays a keyword so the platform name
    // finds it.
    page: "ticker",
    rowId: "hideFullscreen",
    label: "Hide when an app goes fullscreen",
    description: "Get out of the way of games, videos and presentations",
    keywords: "youtube games movie windows only",
  },
  {
    page: "ticker",
    rowId: "itemOrder",
    label: "Item order",
    description: "Keep each widget's items together, or mix them",
    keywords: "mix grouped weave by source",
  },

  // ── Profile & plan ────────────────────────────────────────────
  {
    page: "profile",
    rowId: "displayName",
    label: "Display name",
    description: "The name shown on your profile",
    keywords: "name profile",
  },
  {
    page: "profile",
    rowId: "email",
    label: "Email",
    description: "The address on your account",
    keywords: "mail address",
  },
  {
    page: "profile",
    rowId: "password",
    label: "Password",
    description: "We'll email you a reset link",
    keywords: "security reset",
  },
  {
    page: "profile",
    rowId: "slots",
    label: "Manage widgets",
    description: "Add, remove, and swap widgets in the Catalog",
    keywords: "slots catalog plan",
  },
  {
    // Both of these have data-row targets in the prototype's DOM but no
    // index entries, so they could never actually be jumped to.
    page: "profile",
    rowId: "signedIn",
    label: "Signed in as",
    description: "The account this device is signed in to",
    keywords: "account identity user who signin sign in",
  },
  {
    page: "profile",
    rowId: "plan",
    label: "Plan",
    description: "Your subscription and what it includes",
    keywords: "billing subscription upgrade uplink tier",
  },
  {
    page: "profile",
    rowId: "signOut",
    label: "Sign out",
    description: "Sign out of this device",
    keywords: "logout log out",
  },

  // ── Data & privacy ────────────────────────────────────────────
  {
    page: "data",
    rowId: "export",
    label: "Export your data",
    description: "Download sources, preferences, and metadata as JSON",
    keywords: "download backup gdpr",
  },
  {
    page: "data",
    rowId: "crashReports",
    label: "Send crash reports",
    description: "Send errors and stack traces to Sentry",
    keywords: "sentry telemetry privacy error diagnostics",
  },
  {
    page: "data",
    rowId: "resetAll",
    label: "Reset all settings",
    description: "Clear every local preference",
    keywords: "defaults factory danger",
  },

  // ── Updates ───────────────────────────────────────────────────
  {
    page: "updates",
    rowId: "checkNow",
    label: "Check for updates",
    description: "See if a new version is available",
    keywords: "version upgrade",
  },
  {
    page: "updates",
    rowId: "releaseHistory",
    label: "Release history",
    description: "What shipped in every version",
    keywords: "changelog whats new notes",
  },
];

/** Case-insensitive substring match over label + description + keywords. */
export function searchSettings(query: string): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_SEARCH_INDEX.filter((e) =>
    `${e.label} ${e.description} ${e.keywords}`.toLowerCase().includes(q),
  );
}

/**
 * Briefly tint a row so the eye lands on it after a search jump.
 *
 * Uses the Web Animations API rather than an inline `style.animation`:
 * the animation cleans itself up, repeat jumps to the same row restart
 * rather than no-op, and honouring prefers-reduced-motion is a single
 * early return. Scrolls the row into view either way — the scroll is
 * the functional half, the flash is only decoration.
 */
export function flashRow(rowId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-row="${rowId}"]`);
  if (!el) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    block: "center",
    behavior: reduced ? "auto" : "smooth",
  });

  // Move focus to the row as well as the eye. Following a result used to
  // leave focus on the results list that had just been replaced, which
  // drops a keyboard user back at the top of the document — the flash
  // told sighted users where they landed and nobody else. Prefer the
  // row's own control so the next Tab continues from the right place.
  const target =
    el.querySelector<HTMLElement>(
      'button, input, [role="switch"], [role="radiogroup"]',
    ) ?? el;
  if (target === el && !el.hasAttribute("tabindex")) el.tabIndex = -1;
  target.focus({ preventScroll: true });

  if (reduced) return;

  el.animate(
    [
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0.18)" },
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0)" },
    ],
    { duration: 1600, easing: "ease-out" },
  );
}
