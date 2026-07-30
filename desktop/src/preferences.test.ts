/**
 * Tests for the Display-page venue-toggle migration helpers.
 *
 * These lock in the contract that lets us upgrade user prefs in place:
 *  - legacy boolean `true`  becomes `"both"` (visible everywhere — preserves
 *    the old behaviour where a true boolean meant "show this")
 *  - legacy boolean `false` becomes `"off"`  (hidden everywhere — preserves
 *    the old behaviour where a false boolean meant "hide this")
 *  - legacy `tickerShowMatchup` and `showInjuryCount` booleans on Fantasy
 *    fold into their new venue-aware replacements without losing the user's
 *    prior on/off choice
 *  - unknown / corrupt values fall back to `"both"` so loadPrefs never
 *    throws or produces a bad shape
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  migrateVenue,
  shouldShowOnFeed,
  shouldShowOnTicker,
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

interface LegacyClockTimerWidgetPrefs extends Omit<Partial<WidgetPrefs>, "clock"> {
  clock?: {
    ticker?: Partial<WidgetPrefs["clock"]["ticker"]> & {
      activeTimer?: boolean;
    };
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

describe("shouldShowOnFeed / shouldShowOnTicker", () => {
  it("routes each venue to the correct surface", () => {
    expect(shouldShowOnFeed("off")).toBe(false);
    expect(shouldShowOnFeed("feed")).toBe(true);
    expect(shouldShowOnFeed("both")).toBe(true);
    expect(shouldShowOnFeed("ticker")).toBe(false);

    expect(shouldShowOnTicker("off")).toBe(false);
    expect(shouldShowOnTicker("feed")).toBe(false);
    expect(shouldShowOnTicker("both")).toBe(true);
    expect(shouldShowOnTicker("ticker")).toBe(true);
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
  it("preserves articlesPerSource and ignores unknown stored keys", () => {
    const legacy = {
      showDescription: true,
      showSource: false,
      articlesPerSource: 3,
    } as unknown as Parameters<typeof migrateRssDisplay>[0];

    expect(migrateRssDisplay(legacy).articlesPerSource).toBe(3);
  });

  it("falls back to default for non-number articlesPerSource", () => {
    const migrated = migrateRssDisplay({
      articlesPerSource: "lots",
    } as unknown as Parameters<typeof migrateRssDisplay>[0]);
    expect(migrated.articlesPerSource).toBe(0);
  });

  it("migrates the old untouched default (4) to All (0) — v1.1.1", () => {
    // 4 was the pre-widget-era default and never appeared in the picker
    // (1/3/5/10), so a stored 4 is not a user's choice.
    const migrated = migrateRssDisplay({ articlesPerSource: 4 });
    expect(migrated.articlesPerSource).toBe(0);
  });

  it("keeps deliberately chosen per-source caps (picker values)", () => {
    for (const chosen of [1, 3, 5, 10]) {
      expect(migrateRssDisplay({ articlesPerSource: chosen }).articlesPerSource).toBe(chosen);
    }
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
  it("folds legacy tickerShowMatchup=true into matchupScore='both'", () => {
    const legacy = { tickerShowMatchup: true } as unknown as Parameters<
      typeof migrateFantasyDisplay
    >[0];
    const migrated = migrateFantasyDisplay(legacy);
    expect(migrated.matchupScore).toBe("both");
  });

  it("folds legacy tickerShowMatchup=false into matchupScore='feed'", () => {
    // Rationale: user explicitly hid the matchup from the ticker but had no
    // way to hide it from the feed under the old model. Keep it visible in
    // the feed after migration so no feed-page content disappears silently.
    const legacy = { tickerShowMatchup: false } as unknown as Parameters<
      typeof migrateFantasyDisplay
    >[0];
    const migrated = migrateFantasyDisplay(legacy);
    expect(migrated.matchupScore).toBe("feed");
  });

  it("folds legacy showInjuryCount boolean into injuryCount venue", () => {
    expect(
      migrateFantasyDisplay({ showInjuryCount: true } as unknown as Parameters<
        typeof migrateFantasyDisplay
      >[0]).injuryCount,
    ).toBe("both");
    expect(
      migrateFantasyDisplay({ showInjuryCount: false } as unknown as Parameters<
        typeof migrateFantasyDisplay
      >[0]).injuryCount,
    ).toBe("off");
  });

  it("preserves feed-layout booleans (showStandings, showMatchups)", () => {
    const migrated = migrateFantasyDisplay({
      showStandings: false,
      showMatchups: true,
    });
    expect(migrated.showStandings).toBe(false);
    expect(migrated.showMatchups).toBe(true);
  });

  it("preserves non-venue scalar fields", () => {
    const migrated = migrateFantasyDisplay({
      defaultSubTab: "matchup",
      defaultSort: "record",
      enabledLeagueKeys: ["nfl.l.12345"],
      primaryLeagueKey: "nfl.l.12345",
    });

    expect(migrated.defaultSubTab).toBe("matchup");
    expect(migrated.defaultSort).toBe("record");
    expect(migrated.enabledLeagueKeys).toEqual(["nfl.l.12345"]);
    expect(migrated.primaryLeagueKey).toBe("nfl.l.12345");
  });

  it("new-shape venue fields survive migration unchanged", () => {
    const current = {
      matchupScore: "ticker",
      winProbability: "feed",
      matchupStatus: "off",
      projectedPoints: "both",
      week: "ticker",
      record: "feed",
      standingsPosition: "both",
      streak: "off",
      injuryCount: "feed",
      topScorer: "ticker",
    } as Parameters<typeof migrateFantasyDisplay>[0];
    const migrated = migrateFantasyDisplay(current);
    expect(migrated.matchupScore).toBe("ticker");
    expect(migrated.winProbability).toBe("feed");
    expect(migrated.matchupStatus).toBe("off");
    expect(migrated.projectedPoints).toBe("both");
    expect(migrated.streak).toBe("off");
    expect(migrated.topScorer).toBe("ticker");
  });

  it("legacy tickerShowMatchup is dropped from the returned object", () => {
    const migrated = migrateFantasyDisplay({
      tickerShowMatchup: true,
    } as unknown as Parameters<typeof migrateFantasyDisplay>[0]);
    // @ts-expect-error — legacy key shouldn't exist on the migrated shape
    expect(migrated.tickerShowMatchup).toBeUndefined();
  });

  it("new-shape value wins over legacy boolean when both are present", () => {
    // A user whose prefs file was partially migrated (new key set, old key
    // still present) should not regress to the legacy value.
    const migrated = migrateFantasyDisplay({
      tickerShowMatchup: false,
      matchupScore: "ticker",
    } as unknown as Parameters<typeof migrateFantasyDisplay>[0]);
    expect(migrated.matchupScore).toBe("ticker");
  });

  it("Phase 1 player-stats fields default to 'both' for upgrading users", () => {
    // A user upgrading from a build that predates these fields will have
    // no key for them in their prefs file. migrateVenue's unknown-input
    // fallback returns "both" — fields appear visible-everywhere by
    // default, matching what users have been asking for ("when can we
    // see player stats on the ticker?").
    const migrated = migrateFantasyDisplay({});
    expect(migrated.topThreeScorers).toBe("both");
    expect(migrated.worstStarter).toBe("both");
    expect(migrated.benchOpportunity).toBe("both");
    expect(migrated.injuryDetail).toBe("both");
  });

  it("Phase 1 player-stats fields preserve user choices on subsequent loads", () => {
    const migrated = migrateFantasyDisplay({
      topThreeScorers: "ticker",
      worstStarter: "feed",
      benchOpportunity: "off",
      injuryDetail: "both",
    });
    expect(migrated.topThreeScorers).toBe("ticker");
    expect(migrated.worstStarter).toBe("feed");
    expect(migrated.benchOpportunity).toBe("off");
    expect(migrated.injuryDetail).toBe("both");
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

    // 2026-07-17 unification: stored per-item ticker values are ignored —
    // tracked content always reaches the ticker.
    expect(prefs.clock).toMatchObject({
      ticker: {
        localTime: true,
        showTimezones: true,
        excludedTimezones: [],
      },
    });
    expect("activeTimer" in prefs.clock.ticker).toBe(false);
    expect(prefs.timer).toEqual({
      ticker: { activeTimer: true },
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
      ticker: { activeTimer: true },
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
    // 2026-07-17 unification: a running timer always reaches the ticker;
    // the stored activeTimer:false is deliberately ignored.
    expect(prefs.timer.ticker.activeTimer).toBe(true);
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
    expect(prefs.timer.ticker.activeTimer).toBe(true);
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
