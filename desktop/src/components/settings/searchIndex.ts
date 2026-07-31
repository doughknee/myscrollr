/**
 * The settings search index.
 *
 * A static, hand-maintained list of every jumpable row. It is not
 * derived from the rendered pages on purpose: rows appear and disappear
 * with preference state (Direction hides on Rotate, Hover speed only on
 * continuous scroll), and a search that could only find the settings you
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
    keywords: "palette colors catppuccin dracula nord",
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
    rowId: "displaySize",
    label: "Display size",
    description: "Resize the main app window",
    keywords: "zoom scale ui",
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
    keywords: "accessibility a11y",
  },

  // ── Window & startup ──────────────────────────────────────────
  {
    page: "window",
    rowId: "alwaysOnTop",
    label: "Always on top",
    description: "Keep the ticker above all other windows",
    keywords: "pin float",
  },
  {
    // The prototype's index still carried "— Windows only" here even
    // though the redesign moves that caveat out of the description and
    // into a badge chip. Kept as a keyword so searching "windows" still
    // finds it, without the result card contradicting the row.
    page: "window",
    rowId: "hideFullscreen",
    label: "Hide when an app goes fullscreen",
    description: "Hides the ticker during fullscreen apps",
    keywords: "youtube games movie windows only",
  },
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

  // ── Ticker ────────────────────────────────────────────────────
  {
    page: "ticker",
    rowId: "scrollMode",
    label: "Scroll mode",
    description: "Continuous scroll, page through, or rotate",
    keywords: "continuous page rotate flip step",
  },
  {
    page: "ticker",
    rowId: "direction",
    label: "Direction",
    description: "Which way the ticker moves",
    keywords: "left right",
  },
  {
    page: "ticker",
    rowId: "itemOrder",
    label: "Item order",
    description: "Group items by source or weave them together",
    keywords: "mix grouped weave",
  },
  {
    page: "ticker",
    rowId: "speed",
    label: "Speed",
    description: "How fast the ticker scrolls",
    keywords: "fast slow velocity",
  },
  {
    // Absent from the prototype (both the page and its index) but
    // required by the handoff spec, and backed by a live pref.
    page: "ticker",
    rowId: "stepPause",
    label: "Time per page",
    description: "How long each page stays put before the ticker advances",
    keywords: "dwell pause step rotate interval",
  },
  {
    page: "ticker",
    rowId: "pauseOnHover",
    label: "Slow down on hover",
    description: "Ease off while you hover so chips are easier to read",
    keywords: "pause mouse",
  },
  {
    page: "ticker",
    rowId: "hoverSpeed",
    label: "Hover speed",
    description: "How far it slows while hovered",
    keywords: "pause stop",
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
    description: "Single line vs. detail row under each chip",
    keywords: "compact detailed comfort",
  },
  {
    page: "ticker",
    rowId: "spacing",
    label: "Spacing",
    description: "Gap between chips",
    keywords: "tight wide gap density",
  },
  {
    page: "ticker",
    rowId: "chipColors",
    label: "Chip colors",
    description: "Source colors, accent theme, or subtle grayscale",
    keywords: "color widget subtle",
  },
  {
    page: "ticker",
    rowId: "tickerScale",
    label: "Scale",
    description: "Resize the ticker window",
    keywords: "size zoom",
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
    // Reachable in the prototype's DOM but missing from its index.
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
  if (reduced) return;

  el.animate(
    [
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0.18)" },
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0)" },
    ],
    { duration: 1600, easing: "ease-out" },
  );
}
