/**
 * Tests for the prefs migration helpers.
 *
 * These lock in the contract that lets us upgrade user prefs in place:
 *  - legacy booleans coerce to a well-formed `Venue` (sports still folds
 *    `showUpcoming` / `showFinal` this way)
 *  - retired fields are DROPPED, not carried: loadPrefs builds the object
 *    that gets saved back, so anything it doesn't spread falls off disk
 *  - unknown / corrupt values fall back to defaults so loadPrefs never
 *    throws or produces a bad shape
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  migrateVenue,
  migrateFinanceDisplay,
  migrateRssDisplay,
  migrateAppearanceTheme,
  resolveThemeName,
  isThemeFamily,
  isThemeMode,
  THEME_FAMILIES,
  mergeWidgetPrefs,
  reconcileSidebarOrder,
  loadPrefs,
  migrateTicker,
  resetTickerPage,
  TICKER_SPEEDS,
  resetAll,
  savePrefs,
  migrateUnits,
  togglePin,
  isPinned,
  pinCount,
  MAX_PINS,
  REMOVED_WIDGETS_TIP_ID,
  takePendingRemovalNotice,
} from "./preferences";
import type { AppPreferences, WidgetPrefs, WidgetPin } from "./preferences";

const storeValues = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./lib/store", () => ({
  getStore: vi.fn((key: string, fallback: unknown) => (
    storeValues.has(key) ? storeValues.get(key) : fallback
  )),
  setStore: vi.fn((key: string, value: unknown) => {
    storeValues.set(key, value);
  }),
  removeStore: vi.fn((key: string) => {
    storeValues.delete(key);
  }),
}));

afterEach(() => {
  storeValues.clear();
});

it("keeps the account analytics decision when resetting local preferences", () => {
  const prefs = loadPrefs();
  savePrefs({ ...prefs, privacy: { ...prefs.privacy, postHogAnalyticsDecision: "enabled", shareProductAnalytics: true } });
  expect(resetAll().privacy).toMatchObject({ postHogAnalyticsDecision: "enabled", shareProductAnalytics: true });
  savePrefs({ ...prefs, privacy: { ...prefs.privacy, postHogAnalyticsDecision: "declined", shareProductAnalytics: false } });
  expect(resetAll().privacy).toMatchObject({ postHogAnalyticsDecision: "declined", shareProductAnalytics: false });
});

it("reconciles sidebar ordering across widget types", () => {
  expect(
    reconcileSidebarOrder(
      ["clock", "finance", "removed", "clock"],
      ["finance", "sports", "clock", "github"],
    ),
  ).toEqual(["clock", "finance", "sports", "github"]);
});

// The pre-split combined clock/timer widget's stored shape, plus the
// per-widget `ticker` sub-configs that REL-208 removed from the type.
interface LegacyClockTimerWidgetPrefs extends Omit<Partial<WidgetPrefs>, "timer"> {
  clock?: {
    ticker?: Record<string, unknown> & { activeTimer?: boolean };
    pomodoro?: Partial<WidgetPrefs["timer"]["pomodoro"]>;
  };
  timer?: {
    ticker?: { activeTimer?: boolean };
    pomodoro?: Partial<WidgetPrefs["timer"]["pomodoro"]>;
  };
}

function legacyWidgetPrefs(input: LegacyClockTimerWidgetPrefs): Partial<WidgetPrefs> {
  return input as Partial<WidgetPrefs>;
}

describe("migrateVenue", () => {
  it("keeps valid venue strings as-is", () => {
    expect(migrateVenue("off")).toBe("off");
    expect(migrateVenue("feed")).toBe("feed");
    expect(migrateVenue("both")).toBe("both");
    expect(migrateVenue("ticker")).toBe("ticker");
  });

  it("coerces legacy true to 'both'", () => {
    expect(migrateVenue(true)).toBe("both");
  });

  it("coerces legacy false to 'off'", () => {
    expect(migrateVenue(false)).toBe("off");
  });

  it("falls back to 'both' for unknown values (new / never-set fields are visible)", () => {
    expect(migrateVenue("nonsense")).toBe("both");
    expect(migrateVenue(42)).toBe("both");
    expect(migrateVenue(null)).toBe("both");
    expect(migrateVenue(undefined)).toBe("both");
  });
});

describe("widgetDisplay prefs", () => {
  // The REL-40 back-compat read of the legacy `channelDisplay` key is gone.
  // It existed to carry settings written by clients ≤ v1.1.9; with no users
  // to carry, keeping it would be exactly the compat debt this rename set
  // out to avoid. An unknown key is simply ignored and defaults apply.
  it("reads display prefs from widgetDisplay", () => {
    storeValues.set("scrollr:settings", {
      appearance: {},
      widgetDisplay: { finance: { defaultSort: "price" } },
    });

    expect(loadPrefs().widgetDisplay.finance.defaultSort).toBe("price");
  });

  it("ignores the retired channelDisplay key and falls back to defaults", () => {
    // "change" specifically because it is NOT the default — asserting
    // against the default value would pass whether or not the legacy key
    // was read.
    storeValues.set("scrollr:settings", {
      appearance: {},
      channelDisplay: { finance: { defaultSort: "change" } },
    });

    expect(loadPrefs().widgetDisplay.finance.defaultSort).not.toBe("change");
  });
});

describe("migrateFinanceDisplay", () => {
  it("preserves functional prefs and ignores unknown stored keys", () => {
    const legacy = {
      showChange: true,
      showPrevClose: false,
      defaultSort: "change",
    } as unknown as Parameters<typeof migrateFinanceDisplay>[0];

    expect(migrateFinanceDisplay(legacy).defaultSort).toBe("change");
  });

  it("returns defaults for empty or undefined input", () => {
    expect(migrateFinanceDisplay({}).defaultSort).toBe("alpha");
    expect(migrateFinanceDisplay(undefined).defaultSort).toBe("alpha");
  });
});

describe("migrateRssDisplay", () => {
  it("drops the retired per-source cap and unknown stored keys (REL-208)", () => {
    const legacy = {
      showDescription: true,
      showSource: false,
      articlesPerSource: 3,
      feedSort: "oldest",
    } as unknown as Parameters<typeof migrateRssDisplay>[0];

    const migrated = migrateRssDisplay(legacy);
    expect(migrated.feedSort).toBe("oldest");
    expect("articlesPerSource" in migrated).toBe(false);
  });

  it("keeps positive total article caps and maps invalid values to All", () => {
    expect(migrateRssDisplay({ maxArticles: 5 }).maxArticles).toBe(5);
    expect(migrateRssDisplay({ maxArticles: 2.6 }).maxArticles).toBe(3);
    expect(migrateRssDisplay({ maxArticles: 0 }).maxArticles).toBe(0);
    expect(migrateRssDisplay({ maxArticles: -1 }).maxArticles).toBe(0);
  });
});

describe("SCROLLR-240: fantasy/predictions removal strip + one-time notice", () => {
  it("drops fantasy/predictions widget ids and pins on load, and fires the notice once", () => {
    storeValues.set("scrollr:settings", {
      appearance: {},
      widgets: {
        enabledWidgets: ["uptime", "fantasy", "predictions"],
        widgetsOnTicker: ["uptime", "fantasy"],
        sidebarOrder: ["fantasy", "uptime"],
        pins: [{ widget: "predictions", subject: "MARKET-1", side: "right" }],
      },
    });

    const prefs = loadPrefs();
    expect(prefs.widgets.enabledWidgets).toEqual(["uptime"]);
    expect(prefs.widgets.widgetsOnTicker).toEqual(["uptime"]);
    expect(prefs.widgets.sidebarOrder).toEqual(["uptime"]);
    expect(prefs.widgets.pins).toEqual([]);
    expect(prefs.tipsShown).toContain(REMOVED_WIDGETS_TIP_ID);
    expect(takePendingRemovalNotice()).toBe(true);
    // Reading it again returns false until the next strip.
    expect(takePendingRemovalNotice()).toBe(false);
  });

  it("does not re-fire the notice on a second load (already persisted, nothing left to strip)", () => {
    storeValues.set("scrollr:settings", {
      appearance: {},
      widgets: { enabledWidgets: ["uptime", "fantasy"] },
    });
    loadPrefs();
    expect(takePendingRemovalNotice()).toBe(true);

    // Second launch: the persisted store no longer names fantasy/predictions.
    const second = loadPrefs();
    expect(second.tipsShown).toContain(REMOVED_WIDGETS_TIP_ID);
    expect(takePendingRemovalNotice()).toBe(false);
  });

  it("never fires for a store that never had fantasy/predictions", () => {
    storeValues.set("scrollr:settings", {
      appearance: {},
      widgets: { enabledWidgets: ["clock"] },
    });
    const prefs = loadPrefs();
    expect(prefs.tipsShown).not.toContain(REMOVED_WIDGETS_TIP_ID);
    expect(takePendingRemovalNotice()).toBe(false);
  });
});

describe("isThemeFamily / isThemeMode", () => {
  it("accepts every family in THEME_FAMILIES", () => {
    for (const family of THEME_FAMILIES) {
      expect(isThemeFamily(family)).toBe(true);
    }
  });

  it("rejects unknown family strings", () => {
    expect(isThemeFamily("monokai")).toBe(false);
    expect(isThemeFamily("synthwave")).toBe(false);
    expect(isThemeFamily("")).toBe(false);
    expect(isThemeFamily(null)).toBe(false);
    expect(isThemeFamily(undefined)).toBe(false);
    expect(isThemeFamily(42)).toBe(false);
  });

  it("accepts the three valid modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
  });

  it("rejects everything else as a mode", () => {
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode("")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe("migrateAppearanceTheme", () => {
  it("returns Scrollr + system when nothing is saved", () => {
    expect(migrateAppearanceTheme(undefined)).toEqual({
      themeFamily: "scrollr",
      themeMode: "system",
    });
    expect(migrateAppearanceTheme({})).toEqual({
      themeFamily: "scrollr",
      themeMode: "system",
    });
  });

  it("folds legacy `theme: dark` into themeMode + scrollr family", () => {
    expect(migrateAppearanceTheme({ theme: "dark" })).toEqual({
      themeFamily: "scrollr",
      themeMode: "dark",
    });
  });

  it("folds legacy `theme: light` into themeMode + scrollr family", () => {
    expect(migrateAppearanceTheme({ theme: "light" })).toEqual({
      themeFamily: "scrollr",
      themeMode: "light",
    });
  });

  it("folds legacy `theme: system` into themeMode + scrollr family", () => {
    expect(migrateAppearanceTheme({ theme: "system" })).toEqual({
      themeFamily: "scrollr",
      themeMode: "system",
    });
  });

  it("keeps an explicit themeFamily + themeMode as-is", () => {
    expect(
      migrateAppearanceTheme({
        themeFamily: "catppuccin",
        themeMode: "dark",
      }),
    ).toEqual({ themeFamily: "catppuccin", themeMode: "dark" });
  });

  it("prefers the new themeMode field when both new and legacy are present", () => {
    // Legacy theme=light vs new themeMode=dark — the new field wins
    // so a partial migration (UI saved one field but not the other)
    // resolves cleanly.
    expect(
      migrateAppearanceTheme({
        theme: "light",
        themeMode: "dark",
        themeFamily: "dracula",
      }),
    ).toEqual({ themeFamily: "dracula", themeMode: "dark" });
  });

  it("falls back to scrollr for unknown themeFamily values", () => {
    expect(
      migrateAppearanceTheme({ themeFamily: "monokai", themeMode: "dark" }),
    ).toEqual({ themeFamily: "scrollr", themeMode: "dark" });
  });

  it("falls back to system for unknown themeMode values", () => {
    expect(
      migrateAppearanceTheme({
        themeFamily: "nord",
        themeMode: "midnight",
      }),
    ).toEqual({ themeFamily: "nord", themeMode: "system" });
  });

  it("survives corrupted shapes without throwing", () => {
    expect(
      migrateAppearanceTheme({ themeFamily: 42, themeMode: true }),
    ).toEqual({ themeFamily: "scrollr", themeMode: "system" });
  });
});

describe("resolveThemeName", () => {
  it("composes the data-theme attribute as `<family>-<mode>`", () => {
    expect(resolveThemeName("scrollr", "dark")).toBe("scrollr-dark");
    expect(resolveThemeName("scrollr", "light")).toBe("scrollr-light");
    expect(resolveThemeName("catppuccin", "dark")).toBe("catppuccin-dark");
    expect(resolveThemeName("tokyo-night", "light")).toBe("tokyo-night-light");
    expect(resolveThemeName("rose-pine", "dark")).toBe("rose-pine-dark");
  });
});

describe("widget timer preference migration", () => {
  it("moves legacy clock timer settings into widgets.timer", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      clock: {
        ticker: {
          localTime: false,
          showTimezones: true,
          excludedTimezones: ["America/New_York"],
          activeTimer: false,
        },
        pomodoro: {
          workMins: 50,
          shortBreakMins: 10,
          longBreakMins: 30,
          longBreakEvery: 3,
        },
      },
    }));

    // REL-208: the clock block and every per-item ticker value are
    // dropped — tracked content always reaches the ticker.
    expect("clock" in prefs).toBe(false);
    expect(prefs.timer).toEqual({
      pomodoro: {
        workMins: 50,
        shortBreakMins: 10,
        longBreakMins: 30,
        longBreakEvery: 3,
      },
    });
  });

  it("prefers saved timer settings over conflicting legacy clock timer settings", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      clock: {
        ticker: {
          activeTimer: false,
        },
        pomodoro: {
          workMins: 50,
          shortBreakMins: 10,
          longBreakMins: 30,
          longBreakEvery: 3,
        },
      },
      timer: {
        ticker: { activeTimer: true },
        pomodoro: {
          workMins: 20,
          shortBreakMins: 4,
          longBreakMins: 12,
          longBreakEvery: 5,
        },
      },
    }));

    expect(prefs.timer).toEqual({
      pomodoro: {
        workMins: 20,
        shortBreakMins: 4,
        longBreakMins: 12,
        longBreakEvery: 5,
      },
    });
  });

  it("keeps legacy active timer chips on the ticker after timer becomes its own widget", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock", "timer"],
      widgetsOnTicker: ["clock", "timer"],
      clock: {
        ticker: {
          activeTimer: true,
        },
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock", "timer"]);
    expect(prefs.widgetsOnTicker).toEqual(["clock", "timer"]);
  });

  it("adds timer for legacy clock-on-ticker active timer users", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: ["clock"],
      clock: {
        ticker: {
          activeTimer: true,
        },
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock", "timer"]);
    expect(prefs.widgetsOnTicker).toEqual(["clock", "timer"]);
  });

  it("adds timer for legacy clock-on-ticker users when activeTimer was never saved", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: ["clock"],
      clock: {
        ticker: {},
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock", "timer"]);
    expect(prefs.widgetsOnTicker).toEqual(["clock", "timer"]);
  });

  it("enables timer for legacy clock users without adding ticker visibility", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: [],
      clock: {
        ticker: {},
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock", "timer"]);
    expect(prefs.widgetsOnTicker).toEqual([]);
  });

  it("enables timer for legacy clock users who had active timer hidden", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: ["clock"],
      clock: {
        ticker: {
          activeTimer: false,
        },
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock", "timer"]);
    expect(prefs.widgetsOnTicker).toEqual(["clock"]);
  });

  it("does not auto-add timer visibility when current timer prefs exist", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: ["clock"],
      clock: {
        ticker: {},
      },
      timer: {
        ticker: { activeTimer: true },
        pomodoro: {
          workMins: 25,
          shortBreakMins: 5,
          longBreakMins: 15,
          longBreakEvery: 4,
        },
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock"]);
    expect(prefs.widgetsOnTicker).toEqual(["clock"]);
  });

  it("does not auto-enable timer for current timer prefs", () => {
    const prefs = mergeWidgetPrefs(legacyWidgetPrefs({
      enabledWidgets: ["clock"],
      widgetsOnTicker: [],
      clock: {
        ticker: {},
      },
      timer: {
        ticker: { activeTimer: true },
        pomodoro: {
          workMins: 25,
          shortBreakMins: 5,
          longBreakMins: 15,
          longBreakEvery: 4,
        },
      },
    }));

    expect(prefs.enabledWidgets).toEqual(["clock"]);
    expect(prefs.widgetsOnTicker).toEqual([]);
  });

  // The clock/timer split: users whose combined widget had the timer
  // showing should end up with the timer on the ticker too. This used to
  // be expressed per ticker row; with a single-row ticker it is one
  // membership list, so these assert against widgetsOnTicker.

  it("adds timer to the ticker when the legacy clock timer was on", () => {
    storeValues.set("scrollr:settings", {
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock"],
        widgetsOnTicker: ["clock"],
        clock: { ticker: {} },
      }),
    });

    expect(loadPrefs().widgets.widgetsOnTicker).toEqual(["clock", "timer"]);
  });

  it("leaves the ticker alone when clock is not on it", () => {
    storeValues.set("scrollr:settings", {
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock"],
        widgetsOnTicker: [],
        clock: { ticker: {} },
      }),
    });

    expect(loadPrefs().widgets.widgetsOnTicker).toEqual([]);
  });

  it("does not duplicate timer when it is already on the ticker", () => {
    storeValues.set("scrollr:settings", {
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock", "timer"],
        widgetsOnTicker: ["clock", "timer"],
        clock: { ticker: {} },
      }),
    });

    expect(loadPrefs().widgets.widgetsOnTicker).toEqual(["clock", "timer"]);
  });
});

describe("dead prefs are shed on load (REL-208)", () => {
  it("drops the taskbar block and the per-widget ticker sub-configs", () => {
    storeValues.set("scrollr:settings", {
      taskbar: { showWidgetGlyphIcons: false, taskbarHeight: "compact" },
      widgets: {
        enabledWidgets: ["clock", "weather", "uptime"],
        widgetsOnTicker: ["clock"],
        clock: { ticker: { localTime: false, excludedTimezones: ["UTC"] } },
        weather: { ticker: { excludedCities: ["Oslo"] } },
        uptime: { url: "https://status.example", pollInterval: 30, ticker: { excludedMonitors: [1] } },
        github: { repos: [], pollInterval: 90, ticker: { excludedRepos: ["a/b"] } },
      },
    });

    const prefs = loadPrefs();
    expect("taskbar" in prefs).toBe(false);
    expect("clock" in prefs.widgets).toBe(false);
    expect("weather" in prefs.widgets).toBe(false);
    // pollInterval went with REL-206 (see below).
    expect(prefs.widgets.uptime).toEqual({ url: "https://status.example" });
    expect(prefs.widgets.github).toEqual({ repos: [], quietHours: { on: false, from: "22:00", to: "08:00" }, flash: true });
    // Sysmon's stat toggles are real content selection and stay.
    expect(prefs.widgets.sysmon.ticker).toEqual({ cpu: true, memory: true, gpu: true, gpuPower: true });
  });
});

describe("startup page folds (REL-206, SCROLLR-281)", () => {
  /** The whole block is gone: a login launch is quiet, a user launch shows the window (lib.rs). */
  it("has no startup prefs, and drops a saved startInBackground", () => {
    expect(loadPrefs()).not.toHaveProperty("startup");
    storeValues.set("scrollr:settings", { startup: { startInBackground: true } });
    expect(loadPrefs()).not.toHaveProperty("startup");
    expect(resetAll()).not.toHaveProperty("startup");
    savePrefs(loadPrefs());
    expect(storeValues.get("scrollr:settings")).not.toHaveProperty("startup");
  });

  it("sheds autoCheckUpdates and the three interval prefs from what gets saved", () => {
    storeValues.set("scrollr:settings", {
      startup: { autoCheckUpdates: false, startInBackground: true },
      widgets: {
        sysmon: { refreshInterval: 5, ticker: { cpu: true, memory: false, gpu: true, gpuPower: false } },
        uptime: { url: "https://status.example", pollInterval: 30 },
        github: { repos: [{ owner: "a", repo: "b" }], pollInterval: 90 },
      },
    });

    const prefs = loadPrefs();
    savePrefs(prefs);
    const persisted = storeValues.get("scrollr:settings") as AppPreferences;
    expect(persisted).not.toHaveProperty("startup");
    expect(persisted.widgets.sysmon).toEqual({
      ticker: { cpu: true, memory: false, gpu: true, gpuPower: false },
    });
    expect(persisted.widgets.uptime).toEqual({ url: "https://status.example" });
    // SCROLLR-312 migrates the repo list to the per-repo shape.
    expect(persisted.widgets.github.repos).toEqual([{ repo: "a/b", prs: "mine", issues: "off" }]);
    expect(persisted.widgets.github).not.toHaveProperty("pollInterval");
  });
});

describe("window.tickerMonitors (REL-200)", () => {
  it("defaults to empty (= primary monitor) when the saved prefs predate it", () => {
    storeValues.set("scrollr:settings", {
      window: { pinned: true, tickerPosition: "top", hideOnFullscreen: true },
    });
    expect(loadPrefs().window.tickerMonitors).toEqual([]);
  });

  it("keeps the saved names and drops anything that is not a string", () => {
    storeValues.set("scrollr:settings", {
      window: { tickerMonitors: ["\\.\DISPLAY2", 7, null, "\\.\DISPLAY1"] },
    });
    expect(loadPrefs().window.tickerMonitors).toEqual(["\\.\DISPLAY2", "\\.\DISPLAY1"]);

    storeValues.set("scrollr:settings", { window: { tickerMonitors: "DISPLAY1" } });
    expect(loadPrefs().window.tickerMonitors).toEqual([]);
  });
});

describe("privacy.sendCrashReports (REL-209)", () => {
  it("defaults to on — fresh install and pre-REL-209 blob alike", () => {
    expect(loadPrefs().privacy.sendCrashReports).toBe(true);
    expect(loadPrefs().privacy.shareProductAnalytics).toBe(false);
    storeValues.set("scrollr:settings", { appearance: {}, startup: {} });
    expect(loadPrefs().privacy.sendCrashReports).toBe(true);
    expect(loadPrefs().privacy.shareProductAnalytics).toBe(false);
  });

  it("only a literal false turns it off; reset turns it back on", () => {
    storeValues.set("scrollr:settings", {
      appearance: {},
      privacy: { sendCrashReports: false },
    });
    expect(loadPrefs().privacy.sendCrashReports).toBe(false);

    storeValues.set("scrollr:settings", {
      appearance: {},
      privacy: { sendCrashReports: "no" },
    });
    expect(loadPrefs().privacy.sendCrashReports).toBe(true);

    storeValues.set("scrollr:settings", {
      appearance: {},
      privacy: { sendCrashReports: false },
    });
    expect(resetAll().privacy.sendCrashReports).toBe(true);
    expect(resetAll().privacy.shareProductAnalytics).toBe(false);
    expect(loadPrefs().privacy.sendCrashReports).toBe(true);
  });
});

describe("migrateTicker (REL-204: presets + one hover row)", () => {
  it("folds pauseOnHover + hoverSpeed into onHover", () => {
    expect(migrateTicker({ pauseOnHover: false, hoverSpeed: 0.3 }).onHover).toBe("keep");
    expect(migrateTicker({ pauseOnHover: true, hoverSpeed: 0 }).onHover).toBe("pause");
    expect(migrateTicker({ pauseOnHover: true, hoverSpeed: 0.3 }).onHover).toBe("slow");
    expect(migrateTicker({}).onHover).toBe("slow");
    expect(migrateTicker({ onHover: "pause", pauseOnHover: false }).onHover).toBe("pause");
  });

  /** SCROLLR-274: Pages is the default; only an explicit Continuous stays. */
  describe("scrollMode (SCROLLR-274)", () => {
    it("fresh install, or a mode never chosen, is Pages", () => {
      storeValues.clear();
      expect(loadPrefs().ticker.scrollMode).toBe("pages");
      expect(migrateTicker(undefined).scrollMode).toBe("pages");
      expect(migrateTicker({}).scrollMode).toBe("pages");
      expect(migrateTicker({ tickerSpeed: 40 }).scrollMode).toBe("pages");
    });

    it("an explicit Continuous stays Continuous", () => {
      expect(migrateTicker({ scrollMode: "continuous" }).scrollMode).toBe("continuous");
    });

    it("the old step Page (and Rotate) moves to Pages", () => {
      expect(migrateTicker({ scrollMode: "page" }).scrollMode).toBe("pages");
      expect(migrateTicker({ scrollMode: "step" }).scrollMode).toBe("pages");
      expect(migrateTicker({ scrollMode: "flip" }).scrollMode).toBe("pages");
      expect(migrateTicker({ scrollMode: "pages" }).scrollMode).toBe("pages");
    });

    it("anything unrecognised is the default, and stepPause is dropped", () => {
      expect(migrateTicker({ scrollMode: "sideways" }).scrollMode).toBe("pages");
      expect(migrateTicker({ scrollMode: 3 }).scrollMode).toBe("pages");
      expect(migrateTicker({ scrollMode: "page", stepPause: 8 })).not.toHaveProperty("stepPause");
    });
  });

  it("snaps old slider values to the nearest preset", () => {
    expect(migrateTicker({ tickerSpeed: 25 }).tickerSpeed).toBe(TICKER_SPEEDS.slow);
    expect(migrateTicker({ tickerSpeed: 55 }).tickerSpeed).toBe(TICKER_SPEEDS.normal);
    expect(migrateTicker({ tickerSpeed: 150 }).tickerSpeed).toBe(TICKER_SPEEDS.fast);
    expect(migrateTicker({ tickerSpeed: "fast" }).tickerSpeed).toBe(TICKER_SPEEDS.normal);
  });

  it("drops Spacing, Direction and the legacy hover pair from the saved shape", () => {
    const out = migrateTicker({
      tickerGap: "spacious",
      tickerDirection: "right",
      pauseOnHover: true,
      hoverSpeed: 0.5,
    });
    expect(out).not.toHaveProperty("tickerGap");
    expect(out).not.toHaveProperty("tickerDirection");
    expect(out).not.toHaveProperty("pauseOnHover");
    expect(out).not.toHaveProperty("hoverSpeed");
  });

  it("runs on load, and Size snaps to the App-size presets too", () => {
    storeValues.set("scrollr:settings", {
      appearance: { tickerScale: 150 },
      ticker: { scrollMode: "flip", pauseOnHover: true, hoverSpeed: 0, tickerSpeed: 5 },
    });
    const p = loadPrefs();
    expect(p.ticker).toMatchObject({ scrollMode: "pages", onHover: "pause", tickerSpeed: 20 });
    expect(p.appearance.tickerScale).toBe(130);
  });
});

describe("resetTickerPage (REL-204)", () => {
  it("resets everything the Ticker page shows and nothing else", () => {
    const before = loadPrefs();
    const changed: AppPreferences = {
      ...before,
      ticker: { ...before.ticker, scrollMode: "continuous", onHover: "pause", tickerSpeed: 80 },
      window: { ...before.window, pinned: false, tickerPosition: "bottom", tickerMonitors: ["X"] },
      appearance: { ...before.appearance, tickerScale: 130, uiScale: 115, themeFamily: "nord" },
    };
    const after = resetTickerPage(changed);
    expect(after.ticker).toEqual(before.ticker);
    expect(after.window).toEqual(before.window);
    expect(after.appearance).toEqual({ ...changed.appearance, tickerScale: 100 });
  });
});

describe("uiScale snaps to the App size presets on load (REL-205)", () => {
  it("keeps the four presets, folds retired values, and defaults garbage", () => {
    for (const [saved, want] of [
      [85, 85], [100, 100], [115, 115], [130, 130],
      [75, 85], [90, 85], [110, 115], [150, 130],
      ["115", 100], [NaN, 100], [undefined, 100],
    ] as [unknown, number][]) {
      storeValues.set("scrollr:settings", { appearance: { uiScale: saved } });
      expect(loadPrefs().appearance.uiScale, String(saved)).toBe(want);
    }
  });
});

describe("appearance.units migration (REL-205)", () => {
  it("defaults to °F and 12h with nothing saved anywhere", () => {
    expect(migrateUnits(undefined, {})).toEqual({
      temperature: "fahrenheit",
      timeFormat: "12h",
    });
  });

  it("seeds from the legacy Weather and Clock store keys", () => {
    expect(
      migrateUnits(undefined, { weather: "celsius", clock: "24h" }),
    ).toEqual({ temperature: "celsius", timeFormat: "24h" });
  });

  it("prefers a saved units block over the legacy keys", () => {
    expect(
      migrateUnits(
        { temperature: "fahrenheit", timeFormat: "12h" },
        { weather: "celsius", clock: "24h" },
      ),
    ).toEqual({ temperature: "fahrenheit", timeFormat: "12h" });
  });

  it("ignores garbage in either place", () => {
    expect(
      migrateUnits({ temperature: "kelvin" }, { weather: 7, clock: "13h" }),
    ).toEqual({ temperature: "fahrenheit", timeFormat: "12h" });
  });

  it("runs once: folds the keys into prefs, persists, and deletes them", () => {
    storeValues.set("scrollr:widget:weather:unit", "celsius");
    storeValues.set("scrollr:widget:clock:format", "24h");
    storeValues.set("scrollr:settings", {
      appearance: { uiScale: 100 },
      widgets: { sysmon: { refreshInterval: 2, tempUnit: "fahrenheit" } },
    });

    const prefs = loadPrefs();
    expect(prefs.appearance.units).toEqual({
      temperature: "celsius",
      timeFormat: "24h",
    });
    expect(storeValues.has("scrollr:widget:weather:unit")).toBe(false);
    expect(storeValues.has("scrollr:widget:clock:format")).toBe(false);
    const persisted = storeValues.get("scrollr:settings") as AppPreferences;
    expect(persisted.appearance.units).toEqual(prefs.appearance.units);
    expect("tempUnit" in persisted.widgets.sysmon).toBe(false);

    // Second load: nothing legacy left, the saved block is what counts.
    expect(loadPrefs().appearance.units).toEqual(prefs.appearance.units);
  });

  it("does not persist on load when there is nothing to migrate", () => {
    storeValues.set("scrollr:settings", {
      appearance: { units: { temperature: "celsius", timeFormat: "12h" } },
    });
    const before = storeValues.get("scrollr:settings");
    expect(loadPrefs().appearance.units.temperature).toBe("celsius");
    expect(storeValues.get("scrollr:settings")).toBe(before);
  });
});

describe("ticker values renamed to match their labels (REL-207)", () => {
  it("maps the old scroll spellings forward", () => {
    expect(migrateTicker({ scrollMode: "step" })).toMatchObject({ scrollMode: "pages" });
    expect(migrateTicker({ scrollMode: "continuous" })).toMatchObject({ scrollMode: "continuous" });
  });

  /** SCROLLR-281: Item order and Colors are gone; every stored value is dropped, whatever it was. */
  it("drops a stored mixMode and chipColors, old spellings and junk alike", () => {
    for (const mixMode of ["grouped", "mixed", "weave", 3]) {
      expect(migrateTicker({ mixMode })).not.toHaveProperty("mixMode");
    }
    for (const chipColors of ["widget", "theme", "subtle", "accent", "muted", 3]) {
      expect(migrateTicker({ chipColors })).not.toHaveProperty("chipColors");
    }
    storeValues.set("scrollr:settings", { ticker: { mixMode: "grouped", chipColors: "subtle" } });
    savePrefs(loadPrefs());
    const saved = (storeValues.get("scrollr:settings") as AppPreferences).ticker;
    expect(saved).not.toHaveProperty("mixMode");
    expect(saved).not.toHaveProperty("chipColors");
  });

  /** SCROLLR-281: the Font weight setting is gone; everyone gets normal. */
  it("drops a stored appearance.fontWeight", () => {
    for (const fontWeight of ["normal", "medium", "bold", 3]) {
      storeValues.set("scrollr:settings", { appearance: { fontWeight, highContrast: true } });
      const prefs = loadPrefs();
      expect(prefs.appearance).not.toHaveProperty("fontWeight");
      expect(prefs.appearance.highContrast).toBe(true);
    }
  });

  /**
   * SCROLLR-278: the density choice is gone and the bar has one height
   * (detailed). A stored value, whatever it was, is dropped on load, so
   * a user who had picked Compact gets the detailed bar.
   */
  it("drops a stored tickerMode: compact, comfort, detailed or junk", () => {
    for (const tickerMode of ["compact", "comfort", "detailed", "huge", 3]) {
      expect(migrateTicker({ tickerMode, scrollMode: "continuous" })).not.toHaveProperty("tickerMode");
    }
    expect(migrateTicker({ tickerMode: "compact", scrollMode: "continuous" }).scrollMode).toBe("continuous");
    storeValues.set("scrollr:settings", { ticker: { tickerMode: "compact" } });
    expect(loadPrefs().ticker).not.toHaveProperty("tickerMode");
  });

  it("sheds the ticker window's mirror keys on load", () => {
    storeValues.set("scrollr:feedPinned", false);
    storeValues.set("scrollr:tickerPosition", "bottom");
    storeValues.set("scrollr:settings", {
      appearance: {},
      window: { pinned: false, tickerPosition: "bottom" },
    });
    const prefs = loadPrefs();
    expect(prefs.window).toMatchObject({ pinned: false, tickerPosition: "bottom" });
    expect(storeValues.has("scrollr:feedPinned")).toBe(false);
    expect(storeValues.has("scrollr:tickerPosition")).toBe(false);
  });

  it("no longer reads or writes the widget-bar unit keys REL-205 folded", () => {
    storeValues.set("scrollr:settings", {
      appearance: { units: { temperature: "celsius", timeFormat: "24h" } },
    });
    loadPrefs();
    expect(storeValues.has("scrollr:widget:weather:unit")).toBe(false);
    expect(storeValues.has("scrollr:widget:clock:format")).toBe(false);
  });
});

// ── REL-239: a pin follows a subject, not a widget ────────────────

describe("pin migration (pinnedWidgets → pins)", () => {
  it("carries a pinned single-chip utility over unchanged", () => {
    const prefs = mergeWidgetPrefs({
      pinnedWidgets: { clock: { side: "left" }, weather: { side: "right" } },
    } as unknown as Partial<WidgetPrefs>);

    // A utility renders one chip, so its old widget pin already WAS a pin
    // on a subject. The user must not be able to tell the model changed.
    expect(prefs.pins).toEqual([
      { widget: "clock", subject: "clock", side: "left" },
      { widget: "weather", subject: "weather", side: "right" },
    ]);
  });

  it("drops a pin on a multi-item widget", () => {
    const prefs = mergeWidgetPrefs({
      pinnedWidgets: {
        clock: { side: "right" },
        sports_mlb: { side: "right" },
        finance_stocks: { side: "left" },
        uptime: { side: "right" },
        github: { side: "right" },
      },
    } as unknown as Partial<WidgetPrefs>);

    // Those pins meant "park this widget's first N chips", which froze
    // its rotation. There is no subject in them to translate to.
    expect(prefs.pins).toEqual([
      { widget: "clock", subject: "clock", side: "right" },
    ]);
  });

  it("keeps an already-migrated pins array", () => {
    const prefs = mergeWidgetPrefs({
      pins: [
        { widget: "sports_mlb", subject: "New York Yankees", side: "left" },
        { widget: "finance_stocks", subject: "AAPL", side: "right", row: 1 },
      ],
    } as unknown as Partial<WidgetPrefs>);

    expect(prefs.pins).toEqual([
      { widget: "sports_mlb", subject: "New York Yankees", side: "left" },
      { widget: "finance_stocks", subject: "AAPL", side: "right", row: 1 },
    ]);
  });

  it("discards malformed entries and defaults a bad side", () => {
    const prefs = mergeWidgetPrefs({
      pins: [
        null,
        "clock",
        { widget: "clock" },
        { subject: "AAPL" },
        // An empty subject names nothing — shed it on load, so a pin
        // already written by an earlier build stops holding a slot.
        { widget: "sports_mlb", subject: "", side: "right" },
        { widget: "", subject: "AAPL", side: "right" },
        { widget: "finance_stocks", subject: "AAPL", side: "sideways" },
      ],
    } as unknown as Partial<WidgetPrefs>);

    expect(prefs.pins).toEqual([
      { widget: "finance_stocks", subject: "AAPL", side: "right" },
    ]);
  });

  it("returns no pins when nothing was stored", () => {
    expect(mergeWidgetPrefs({}).pins).toEqual([]);
    expect(
      mergeWidgetPrefs({ pinnedWidgets: [] } as unknown as Partial<WidgetPrefs>).pins,
    ).toEqual([]);
  });
});

describe("togglePin", () => {
  const base = (pins: WidgetPin[]): AppPreferences =>
    ({ widgets: { ...mergeWidgetPrefs({}), pins } }) as AppPreferences;

  it("adds and removes one subject", () => {
    const pin = { widget: "finance_stocks", subject: "AAPL", side: "right" } as const;
    const added = togglePin(base([]), pin);
    expect(added.widgets.pins).toEqual([pin]);
    expect(togglePin(added, pin).widgets.pins).toEqual([]);
  });

  it("refuses a pin past the cap instead of evicting one", () => {
    const full = base(
      Array.from({ length: MAX_PINS }, (_, i) => ({
        widget: "finance_stocks",
        subject: `SYM${i}`,
        side: "right" as const,
      })),
    );
    const after = togglePin(full, {
      widget: "finance_stocks",
      subject: "ONE-MORE",
      side: "right",
    });

    // Same reference back: nothing was written, and nothing the user
    // parked there was quietly dropped to make room.
    expect(after).toBe(full);
    expect(after.widgets.pins).toHaveLength(MAX_PINS);
  });

  it("counts the cap across both sides, not per side", () => {
    // The two zones sit at opposite ends of ONE bar and take their width
    // out of the same tape, so a left-side pin is not free.
    const full = base(
      Array.from({ length: MAX_PINS }, (_, i) => ({
        widget: "finance_stocks",
        subject: `SYM${i}`,
        side: "right" as const,
      })),
    );
    expect(pinCount(full)).toBe(MAX_PINS);
    const after = togglePin(full, {
      widget: "finance_stocks",
      subject: "LEFTY",
      side: "left",
    });
    expect(after).toBe(full);
  });

  it("unpins even when the side is full", () => {
    const pins = Array.from({ length: MAX_PINS }, (_, i) => ({
      widget: "finance_stocks",
      subject: `SYM${i}`,
      side: "right" as const,
    }));
    const after = togglePin(base(pins), pins[0]);
    expect(after.widgets.pins).toHaveLength(MAX_PINS - 1);
  });

  it("refuses a pin with no subject", () => {
    // Found on the running app: an MLB standings row with an empty
    // `team_name` produced {subject: ""}, a pin holding a slot in a
    // capped zone that could never resolve to a chip. Guarded in
    // togglePin because every write routes through it.
    const prefs = base([]);
    expect(togglePin(prefs, { widget: "sports_mlb", subject: "", side: "right" })).toBe(prefs);
    expect(togglePin(prefs, { widget: "", subject: "AAPL", side: "right" })).toBe(prefs);
  });

  it("reports whether a subject is pinned", () => {
    const prefs = base([
      { widget: "sports_mlb", subject: "New York Yankees", side: "right" },
    ]);
    expect(isPinned(prefs, "sports_mlb", "New York Yankees")).toBe(true);
    expect(isPinned(prefs, "sports_mlb", "Boston Red Sox")).toBe(false);
    // Same subject name under a different widget is a different pin.
    expect(isPinned(prefs, "sports_nfl", "New York Yankees")).toBe(false);
  });
});
