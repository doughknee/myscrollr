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
  migratePredictionsDisplay,
  migrateFantasyDisplay,
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
} from "./preferences";
import type { AppPreferences, WidgetPrefs } from "./preferences";

const storeValues = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./lib/store", () => ({
  getStore: vi.fn((key: string, fallback: unknown) => (
    storeValues.has(key) ? storeValues.get(key) : fallback
  )),
  setStore: vi.fn((key: string, value: unknown) => {
    storeValues.set(key, value);
  }),
}));

afterEach(() => {
  storeValues.clear();
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

describe("migratePredictionsDisplay", () => {
  it("maps the retired 'volume' sort to 'trending' (v1.1.5)", () => {
    const migrated = migratePredictionsDisplay({
      defaultSort: "volume",
    } as unknown as Parameters<typeof migratePredictionsDisplay>[0]);
    expect(migrated.defaultSort).toBe("trending");
  });

  it("keeps valid sorts and defaults unknown ones to 'trending'", () => {
    expect(migratePredictionsDisplay({ defaultSort: "movers" }).defaultSort).toBe("movers");
    expect(migratePredictionsDisplay({ defaultSort: "closing" }).defaultSort).toBe("closing");
    expect(migratePredictionsDisplay({ defaultSort: "alpha" }).defaultSort).toBe("alpha");
    expect(migratePredictionsDisplay({ defaultSort: "trending" }).defaultSort).toBe("trending");
    expect(
      migratePredictionsDisplay({
        defaultSort: "banana",
      } as unknown as Parameters<typeof migratePredictionsDisplay>[0]).defaultSort,
    ).toBe("trending");
    expect(migratePredictionsDisplay(undefined).defaultSort).toBe("trending");
  });
});

describe("migrateFantasyDisplay", () => {
  it("preserves the user's inputs", () => {
    const migrated = migrateFantasyDisplay({
      tickerMode: "essential",
      defaultSubTab: "matchup",
      enabledLeagueKeys: ["nfl.l.12345"],
      primaryLeagueKey: "nfl.l.12345",
      followedPlayerKeys: ["449.p.1", 7, null] as unknown as string[],
    });

    expect(migrated.tickerMode).toBe("essential");
    expect(migrated.defaultSubTab).toBe("matchup");
    expect(migrated.enabledLeagueKeys).toEqual(["nfl.l.12345"]);
    expect(migrated.primaryLeagueKey).toBe("nfl.l.12345");
    expect(migrated.followedPlayerKeys).toEqual(["449.p.1"]);
  });

  it("resolves a pre-dial prefs file to 'everything' (the ticker it already had)", () => {
    expect(migrateFantasyDisplay({}).tickerMode).toBe("everything");
    expect(
      migrateFantasyDisplay({ tickerMode: "loud" } as unknown as Parameters<
        typeof migrateFantasyDisplay
      >[0]).tickerMode,
    ).toBe("everything");
  });

  it("drops the retired venue prefs, legacy booleans and feed-layout fields (REL-208)", () => {
    const migrated = migrateFantasyDisplay({
      tickerShowMatchup: false,
      showInjuryCount: true,
      matchupScore: "ticker",
      injuryDetail: "off",
      showStandings: false,
      showMatchups: true,
      defaultSort: "record",
    } as unknown as Parameters<typeof migrateFantasyDisplay>[0]);

    expect(Object.keys(migrated).sort()).toEqual([
      "defaultSubTab",
      "enabledLeagueKeys",
      "followedPlayerKeys",
      "primaryLeagueKey",
      "tickerMode",
    ]);
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
    expect(prefs.widgets.uptime).toEqual({ url: "https://status.example", pollInterval: 30 });
    expect(prefs.widgets.github).toEqual({ repos: [], pollInterval: 90 });
    // Sysmon's stat toggles are real content selection and stay.
    expect(prefs.widgets.sysmon.ticker).toEqual({ cpu: true, memory: true, gpu: true, gpuPower: true });
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
    storeValues.set("scrollr:settings", { appearance: {}, startup: {} });
    expect(loadPrefs().privacy.sendCrashReports).toBe(true);
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

  it("folds Rotate into Page and keeps the other modes", () => {
    expect(migrateTicker({ scrollMode: "flip" }).scrollMode).toBe("step");
    expect(migrateTicker({ scrollMode: "step" }).scrollMode).toBe("step");
    expect(migrateTicker({ scrollMode: "continuous" }).scrollMode).toBe("continuous");
    expect(migrateTicker({ scrollMode: "sideways" }).scrollMode).toBe("continuous");
  });

  it("snaps old slider values to the nearest preset", () => {
    expect(migrateTicker({ tickerSpeed: 25 }).tickerSpeed).toBe(TICKER_SPEEDS.slow);
    expect(migrateTicker({ tickerSpeed: 55 }).tickerSpeed).toBe(TICKER_SPEEDS.normal);
    expect(migrateTicker({ tickerSpeed: 150 }).tickerSpeed).toBe(TICKER_SPEEDS.fast);
    expect(migrateTicker({ tickerSpeed: "fast" }).tickerSpeed).toBe(TICKER_SPEEDS.normal);
    expect(migrateTicker({ stepPause: 1 }).stepPause).toBe(3);
    expect(migrateTicker({ stepPause: 10 }).stepPause).toBe(8);
    expect(migrateTicker({ stepPause: 6 }).stepPause).toBe(5);
  });

  it("drops Spacing, Direction and the legacy hover pair from the saved shape", () => {
    const out = migrateTicker({
      tickerGap: "spacious",
      tickerDirection: "right",
      pauseOnHover: true,
      hoverSpeed: 0.5,
      tickerMode: "compact",
    });
    expect(out).not.toHaveProperty("tickerGap");
    expect(out).not.toHaveProperty("tickerDirection");
    expect(out).not.toHaveProperty("pauseOnHover");
    expect(out).not.toHaveProperty("hoverSpeed");
    expect(out.tickerMode).toBe("compact");
  });

  it("runs on load, and Size snaps to the App-size presets too", () => {
    storeValues.set("scrollr:settings", {
      appearance: { tickerScale: 150 },
      ticker: { scrollMode: "flip", pauseOnHover: true, hoverSpeed: 0, tickerSpeed: 5 },
    });
    const p = loadPrefs();
    expect(p.ticker).toMatchObject({ scrollMode: "step", onHover: "pause", tickerSpeed: 20 });
    expect(p.appearance.tickerScale).toBe(130);
  });
});

describe("resetTickerPage (REL-204)", () => {
  it("resets everything the Ticker page shows and nothing else", () => {
    const before = loadPrefs();
    const changed: AppPreferences = {
      ...before,
      ticker: { ...before.ticker, scrollMode: "step", onHover: "pause", tickerSpeed: 80 },
      window: { ...before.window, pinned: false, tickerPosition: "bottom", tickerMonitors: ["X"] },
      appearance: { ...before.appearance, tickerScale: 130, uiScale: 115, themeFamily: "nord" },
    };
    const after = resetTickerPage(changed);
    expect(after.ticker).toEqual(before.ticker);
    expect(after.window).toEqual(before.window);
    expect(after.appearance).toEqual({ ...changed.appearance, tickerScale: 100 });
  });
});
