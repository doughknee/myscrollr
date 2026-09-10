/**
 * Every settings row's copy, keyed by page and row id.
 *
 * This is the one place a row's label and description live. The pages
 * render from it and the search index is generated from it, so what
 * search shows is what the page says — the index cannot drift from the
 * rows the way the hand-maintained list did (docs/SETTINGS_AUDIT.md §6).
 *
 * `settingsSearchIndex.test.ts` reads the page sources and fails when a
 * rendered `<Row id>` / `data-row` has no entry here, and vice versa.
 *
 * Rows that only exist with or without an account carry `when`; rows
 * that appear and disappear with preference state (Time per page,
 * Hide when fullscreen) do not — everything is findable, and following
 * a result may land you on a row that is currently hidden, which is the
 * honest outcome.
 *
 * Some pages override the description at render time (Speed and On
 * hover read differently in Page mode, the widget-slot row shows live
 * counts). The entry here is the resting copy search shows.
 */
import type { SettingsPage } from "./pages";

export interface RowCopy {
  label: string;
  description: string;
  /** Extra search terms that do not appear in the visible copy. */
  keywords?: string;
  /** Only rendered (and only searchable) in this account state. */
  when?: "signedIn" | "signedOut";
}

export const SETTINGS_ROWS = {
  appearance: {
    theme: {
      label: "Theme",
      description: "Pick a color palette",
      keywords:
        "palette colors scrollr catppuccin dracula tokyo night nord gruvbox solarized rose pine one everforest",
    },
    colorMode: {
      label: "Color mode",
      description: "Light, dark, or follow the system",
      keywords: "dark mode light auto",
    },
    appSize: {
      label: "App size",
      description: "Resize the main app window. The ticker has its own size.",
      keywords: "zoom scale ui display",
    },
    fontWeight: {
      label: "Font weight",
      description: "Increase text thickness for readability",
      keywords: "bold text",
    },
    highContrast: {
      label: "High contrast text",
      description: "Brighten muted text for easier reading",
      keywords: "accessibility a11y readability",
    },
    temperature: {
      label: "Temperature",
      description: "Used by Weather and System monitor",
      keywords: "units fahrenheit celsius degrees °F °C sysmon",
    },
    timeFormat: {
      label: "Time",
      description: "Used by Clock and the ticker",
      keywords: "units format 12h 24h 12-hour 24-hour hour clock am pm",
    },
  },

  startup: {
    autostart: {
      label: "Launch at login",
      description: "Open Scrollr when you sign in to your computer",
      keywords: "boot startup system autostart start automatically",
    },
    startInBackground: {
      label: "Start in the background",
      description:
        "Show only the ticker. Open the Scrollr window from the tray when you want it.",
      keywords: "hidden minimized tray ticker only main window launch",
    },
  },

  shortcuts: {
    shortcuts: {
      label: "Keyboard shortcuts",
      description:
        "Open Settings, show or hide the ticker, cycle the color mode, and more",
      keywords: "hotkey keys cmd ctrl toggle theme",
    },
  },

  // Page order: On · Where · Look · Motion · Behaviour (REL-204).
  ticker: {
    showTicker: {
      label: "Show the ticker",
      description:
        "The bar on your screen. Ctrl+T, the tray and the ticker's right-click menu do the same.",
      keywords: "enable disable on off hide toggle visible",
    },
    tickerMonitors: {
      label: "Monitors",
      description: "Which screens show the ticker",
      keywords: "display screen second dual multi monitor identify",
    },
    screenEdge: {
      label: "Screen edge",
      description: "Which edge of the screen the ticker sits on.",
      keywords: "top bottom position",
    },
    detailLevel: {
      label: "Detail level",
      description: "One line per chip, or a detail row under each.",
      keywords: "compact detailed density rows height",
    },
    tickerScale: {
      label: "Size",
      description: "Resize the bar. The app window has its own size.",
      keywords: "zoom scale ticker",
    },
    chipColors: {
      label: "Chip colors",
      description: "Each widget's own color, the theme accent, or subtle grays.",
      keywords: "widget theme subtle muted accent",
    },
    scrollMode: {
      label: "Scroll mode",
      description: "Scroll without stopping, or show a page at a time.",
      keywords: "continuous page step",
    },
    speed: {
      label: "Speed",
      description: "How fast the chips travel.",
      keywords: "slow normal fast",
    },
    onHover: {
      label: "On hover",
      description: "What the bar does while your mouse is over it.",
      keywords: "pause slow down keep moving mouse",
    },
    stepPause: {
      label: "Time per page",
      description: "How long each page stays before the next one.",
      keywords: "seconds dwell",
    },
    alwaysOnTop: {
      label: "Stay above other windows",
      description: "Keep the ticker visible over whatever else is open.",
      keywords: "always on top pin topmost",
    },
    hideFullscreen: {
      label: "Hide when an app goes fullscreen",
      description: "Get out of the way of games, videos and presentations.",
      keywords: "youtube games movie windows only",
    },
    itemOrder: {
      label: "Item order",
      description: "Keep each widget's items together, or mix them.",
      keywords: "mix grouped mixed by source",
    },
  },

  profile: {
    signIn: {
      label: "Sign in to Scrollr",
      description:
        "Signing in syncs your subscription, profile, and source preferences across devices and unlocks billing management.",
      keywords: "account login log in",
      when: "signedOut",
    },
    signedIn: {
      label: "Signed in as",
      description: "The account this device is signed in to",
      keywords: "account identity user who signin sign in",
      when: "signedIn",
    },
    plan: {
      label: "Plan",
      description: "Your plan and how many widgets it includes",
      keywords: "billing subscription upgrade uplink tier",
      when: "signedIn",
    },
    displayName: {
      label: "Display name",
      description: "The name shown on your profile",
      keywords: "name profile",
      when: "signedIn",
    },
    email: {
      label: "Email",
      description: "The address on your account",
      keywords: "mail address",
      when: "signedIn",
    },
    password: {
      label: "Password",
      description: "We'll email you a reset link.",
      keywords: "security reset",
      when: "signedIn",
    },
    slots: {
      label: "Widget slots",
      description: "Open the Catalog to add, remove, or swap widgets.",
      keywords: "manage widgets catalog plan",
      when: "signedIn",
    },
    signOut: {
      label: "Sign out",
      description: "Sign out of this device. Local preferences stay intact.",
      keywords: "logout log out",
      when: "signedIn",
    },
  },

  data: {
    export: {
      label: "Export your data",
      description:
        "Download your sources, preferences, and account metadata as a .zip file.",
      keywords: "download backup gdpr json",
      when: "signedIn",
    },
    crashReports: {
      label: "Send crash reports",
      description:
        "When something breaks, send the error, stack trace, app version and OS to Sentry. Never your account, IP address or file paths.",
      keywords: "sentry telemetry privacy error diagnostics",
    },
    productAnalytics: {
      label: "Share product activity",
      description:
        "Help improve Scrollr by counting days your visible ticker runs for at least 30 seconds and which broad widget categories were enabled. Signed-in accounts only; retained for 90 days.",
      keywords: "analytics activity privacy opt in usage retention",
      when: "signedIn",
    },
    resetAll: {
      label: "Reset all settings",
      description:
        "Put every setting back to its default and remove your local widgets. Your account, billing, and server data are untouched.",
      keywords: "defaults factory danger clear",
    },
  },

  updates: {
    checkNow: {
      label: "Check for updates",
      description: "Scrollr also checks each time it launches.",
      keywords: "version upgrade new",
    },
    releaseHistory: {
      label: "Release history",
      description: "What shipped in every version",
      keywords: "changelog whats new notes",
    },
  },
} as const satisfies Record<SettingsPage, Record<string, RowCopy>>;
