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
  enumToBools,
  boolsToEnum,
  migrateFinanceDisplay,
  migrateRssDisplay,
  migrateFantasyDisplay,
  getSourceTickerRow,
  getChannelTickerRow,
  getWidgetTickerRow,
  setSourceTickerRow,
  setChannelTickerRow,
  setWidgetTickerRow,
  migrateAppearanceTheme,
  resolveThemeName,
  isThemeFamily,
  isThemeMode,
  THEME_FAMILIES,
  mergeWidgetPrefs,
  loadPrefs,
} from "./preferences";
import type { Venue, AppPreferences, WidgetPrefs } from "./preferences";

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

describe("enumToBools / boolsToEnum (DisplayLocationGrid adapter)", () => {
  // The two-checkbox grid component reads via enumToBools and writes back
  // via boolsToEnum. Drift between these two functions would silently
  // corrupt user prefs on every interaction, so the test pins down all
  // four cases explicitly AND confirms a round trip is identity.

  it("enumToBools — off maps to {feed: false, ticker: false}", () => {
    expect(enumToBools("off")).toEqual({ feed: false, ticker: false });
  });

  it("enumToBools — feed maps to {feed: true, ticker: false}", () => {
    expect(enumToBools("feed")).toEqual({ feed: true, ticker: false });
  });

  it("enumToBools — ticker maps to {feed: false, ticker: true}", () => {
    expect(enumToBools("ticker")).toEqual({ feed: false, ticker: true });
  });

  it("enumToBools — both maps to {feed: true, ticker: true}", () => {
    expect(enumToBools("both")).toEqual({ feed: true, ticker: true });
  });

  it("boolsToEnum — false/false maps to off", () => {
    expect(boolsToEnum(false, false)).toBe("off");
  });

  it("boolsToEnum — true/false maps to feed", () => {
    expect(boolsToEnum(true, false)).toBe("feed");
  });

  it("boolsToEnum — false/true maps to ticker", () => {
    expect(boolsToEnum(false, true)).toBe("ticker");
  });

  it("boolsToEnum — true/true maps to both", () => {
    expect(boolsToEnum(true, true)).toBe("both");
  });

  it("round-trip: enumToBools → boolsToEnum is the identity for every Venue", () => {
    const venues: Venue[] = ["off", "feed", "ticker", "both"];
    for (const v of venues) {
      const { feed, ticker } = enumToBools(v);
      expect(boolsToEnum(feed, ticker)).toBe(v);
    }
  });

  it("round-trip: boolsToEnum → enumToBools is the identity for every (feed, ticker) pair", () => {
    for (const feed of [false, true]) {
      for (const ticker of [false, true]) {
        const venue = boolsToEnum(feed, ticker);
        expect(enumToBools(venue)).toEqual({ feed, ticker });
      }
    }
  });
});

describe("migrateFinanceDisplay", () => {
  it("upgrades legacy boolean fields to Venue", () => {
    // Pretend the stored prefs still use booleans. We type-cast through
    // `unknown` because the interface changed shape; the whole POINT of
    // the migration function is tolerating this.
    const legacy = {
      showChange: true,
      showPrevClose: false,
      showLastUpdated: true,
      defaultSort: "change",
    } as unknown as Parameters<typeof migrateFinanceDisplay>[0];

    const migrated = migrateFinanceDisplay(legacy);

    expect(migrated.showChange).toBe("both");
    expect(migrated.showPrevClose).toBe("off");
    expect(migrated.showLastUpdated).toBe("both");
    expect(migrated.defaultSort).toBe("change"); // preserved
  });

  it("returns defaults for a completely empty input", () => {
    const migrated = migrateFinanceDisplay({});
    // Unknown → "both" per migrateVenue's fallback.
    expect(migrated.showChange).toBe("both");
    expect(migrated.showPrevClose).toBe("both");
    expect(migrated.showLastUpdated).toBe("both");
    expect(migrated.defaultSort).toBe("alpha");
  });

  it("gracefully handles undefined input", () => {
    const migrated = migrateFinanceDisplay(undefined);
    expect(migrated.defaultSort).toBe("alpha");
    expect(migrated.showChange).toBe("both");
  });

  it("keeps new-shape Venue values unchanged (idempotent re-run)", () => {
    const current = {
      showChange: "both",
      showPrevClose: "feed",
      showLastUpdated: "ticker",
      defaultSort: "change",
    } as Parameters<typeof migrateFinanceDisplay>[0];

    const migrated = migrateFinanceDisplay(current);

    expect(migrated.showChange).toBe("both");
    expect(migrated.showPrevClose).toBe("feed");
    expect(migrated.showLastUpdated).toBe("ticker");
    expect(migrated.defaultSort).toBe("change");
  });
});

describe("migrateRssDisplay", () => {
  it("upgrades legacy boolean fields to Venue", () => {
    const legacy = {
      showDescription: true,
      showSource: false,
      showTimestamps: true,
      articlesPerSource: 3,
    } as unknown as Parameters<typeof migrateRssDisplay>[0];

    const migrated = migrateRssDisplay(legacy);

    expect(migrated.showDescription).toBe("both");
    expect(migrated.showSource).toBe("off");
    expect(migrated.showTimestamps).toBe("both");
    expect(migrated.articlesPerSource).toBe(3);
  });

  it("preserves articlesPerSource and uses 'both' for missing venue fields", () => {
    const migrated = migrateRssDisplay({ articlesPerSource: 7 });
    expect(migrated.articlesPerSource).toBe(7);
    expect(migrated.showSource).toBe("both");
  });

  it("falls back to default for non-number articlesPerSource", () => {
    const migrated = migrateRssDisplay({
      articlesPerSource: "lots",
    } as unknown as Parameters<typeof migrateRssDisplay>[0]);
    expect(migrated.articlesPerSource).toBe(4);
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

// ── Unified ticker row selector helpers (Stream 3 of Batch D) ────
//
// These tests lock in the contract for the new row-selector mental model:
//   "Where should this source appear? Off / Row 1 / Row 2 / Row 3"
//
// The helpers must:
//  - return the correct row for a source explicitly listed in tickerLayout
//  - fall back to legacy `Channel.ticker_enabled` (or `visible`) when the
//    source isn't in any row, so users upgrading from pre-multi-deck
//    builds don't see all their channels suddenly go dark
//  - move a source between rows atomically (remove from old row, add to new)
//  - silently ignore out-of-bounds row indices (caller's job to clamp to tier)

/**
 * Build a minimal AppPreferences fixture with the given ticker rows. Other
 * fields are set to whatever shape the helpers don't touch — the tests
 * cast to AppPreferences because they only exercise the appearance.tickerLayout
 * branch.
 */
function makePrefs(rows: { sources: string[] }[]): AppPreferences {
  return {
    appearance: {
      tickerLayout: { rows },
    },
    widgets: {
      widgetsOnTicker: [],
    },
  } as unknown as AppPreferences;
}

describe("getSourceTickerRow / getChannelTickerRow / getWidgetTickerRow", () => {
  it("returns the row index when the source is in tickerLayout sources", () => {
    const prefs = makePrefs([
      { sources: ["finance"] },
      { sources: ["sports", "rss"] },
    ]);
    expect(getSourceTickerRow(prefs, null, "rss")).toBe(1);
    expect(getSourceTickerRow(prefs, null, "finance")).toBe(0);
    expect(getSourceTickerRow(prefs, null, "sports")).toBe(1);
  });

  it("falls back to ticker_enabled=true for channels missing from rows", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const ch = { channel_type: "finance", ticker_enabled: true };
    expect(getSourceTickerRow(prefs, ch, "finance")).toBe(0);
    expect(getChannelTickerRow(prefs, ch)).toBe(0);
  });

  it("returns null when ticker_enabled is false and the channel isn't in any row", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const ch = { channel_type: "finance", ticker_enabled: false };
    expect(getSourceTickerRow(prefs, ch, "finance")).toBeNull();
    expect(getChannelTickerRow(prefs, ch)).toBeNull();
  });

  it("honours the legacy `visible` alias when ticker_enabled is missing", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const ch = { channel_type: "finance", visible: false };
    expect(getSourceTickerRow(prefs, ch, "finance")).toBeNull();
    expect(getChannelTickerRow(prefs, ch)).toBeNull();
  });

  it("returns null for widgets that aren't in any row", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    expect(getWidgetTickerRow(prefs, "clock")).toBeNull();
  });

  it("returns the row index for widgets that are in a row", () => {
    const prefs = makePrefs([{ sources: ["finance"] }, { sources: ["clock"] }]);
    expect(getWidgetTickerRow(prefs, "clock")).toBe(1);
  });

  it("explicit row assignment beats the legacy ticker_enabled fallback", () => {
    // Channel has ticker_enabled=true, but it's pinned to row 1 explicitly.
    const prefs = makePrefs([{ sources: [] }, { sources: ["finance"] }]);
    const ch = { channel_type: "finance", ticker_enabled: true };
    expect(getChannelTickerRow(prefs, ch)).toBe(1);
  });
});

describe("setSourceTickerRow / setChannelTickerRow / setWidgetTickerRow", () => {
  it("removes the source from any other row when moving it", () => {
    const prefs = makePrefs([
      { sources: ["finance", "sports"] },
      { sources: ["rss"] },
    ]);
    const next = setSourceTickerRow(prefs, "finance", 1);
    expect(next.appearance.tickerLayout.rows[0].sources).toEqual(["sports"]);
    expect(next.appearance.tickerLayout.rows[1].sources).toEqual([
      "rss",
      "finance",
    ]);
  });

  it("removes the source from every row when row is null", () => {
    const prefs = makePrefs([{ sources: ["finance"] }, { sources: ["rss"] }]);
    const next = setSourceTickerRow(prefs, "finance", null);
    expect(next.appearance.tickerLayout.rows[0].sources).toEqual([]);
    expect(next.appearance.tickerLayout.rows[1].sources).toEqual(["rss"]);
  });

  it("returns prefs unchanged when row is out of bounds", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const next = setSourceTickerRow(prefs, "finance", 5);
    expect(next).toBe(prefs);
  });

  it("returns prefs unchanged for negative rows", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const next = setSourceTickerRow(prefs, "finance", -1);
    expect(next).toBe(prefs);
  });

  it("setChannelTickerRow forwards to setSourceTickerRow", () => {
    const prefs = makePrefs([{ sources: [] }, { sources: [] }]);
    const next = setChannelTickerRow(prefs, "sports", 1);
    expect(next.appearance.tickerLayout.rows[1].sources).toEqual(["sports"]);
  });

  it("setWidgetTickerRow places a widget id alongside channels in the same sources array", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const next = setWidgetTickerRow(prefs, "clock", 0);
    expect(next.appearance.tickerLayout.rows[0].sources).toEqual([
      "finance",
      "clock",
    ]);
  });

  it("setWidgetTickerRow adds assigned widgets to widgetsOnTicker", () => {
    const prefs = makePrefs([{ sources: [] }]);
    const next = setWidgetTickerRow(prefs, "timer", 0);
    expect(next.widgets.widgetsOnTicker).toEqual(["timer"]);
  });

  it("setWidgetTickerRow removes unassigned widgets from widgetsOnTicker", () => {
    const prefs = makePrefs([{ sources: ["timer"] }]);
    prefs.widgets.widgetsOnTicker = ["clock", "timer"];
    const next = setWidgetTickerRow(prefs, "timer", null);
    expect(next.widgets.widgetsOnTicker).toEqual(["clock"]);
  });

  it("does not mutate the original prefs object", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const before = JSON.stringify(prefs);
    setSourceTickerRow(prefs, "finance", null);
    expect(JSON.stringify(prefs)).toBe(before);
  });

  it("never produces a zero-row layout (preserves the trailing fallback)", () => {
    // The layout is the single source of truth for row count. Edge cases
    // that would otherwise empty `rows` (no-op edits, defensive callers)
    // must always leave at least one row so the ticker has somewhere to
    // render and the height math doesn't blow up.
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const next = setSourceTickerRow(prefs, "finance", null);
    expect(next.appearance.tickerLayout.rows.length).toBe(1);
  });
});

// ── Theme family + mode ─────────────────────────────────────────
//
// The multi-theme rollout split the single `appearance.theme` field
// into `themeFamily` (palette identity) + `themeMode` (light/dark/system).
// These tests pin down:
//
//   - The 10 supported families exist and the type guard accepts them.
//   - The legacy `theme` field migrates into `themeMode` without losing
//     the user's prior color-mode choice (`scrollr` family is assumed).
//   - The new explicit fields take precedence over the legacy one when
//     both are present (an unusual but plausible state during rollout).
//   - Unknown families fall back to "scrollr" and unknown modes to
//     "system" so a corrupted prefs file never breaks the UI.
//   - resolveThemeName composes data-theme strings in the expected form.

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

    expect(prefs.clock).toMatchObject({
      ticker: {
        localTime: false,
        showTimezones: true,
        excludedTimezones: ["America/New_York"],
      },
    });
    expect("activeTimer" in prefs.clock.ticker).toBe(false);
    expect(prefs.timer).toEqual({
      ticker: { activeTimer: false },
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
    expect(prefs.timer.ticker.activeTimer).toBe(false);
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

  it("adds timer to explicit ticker layout rows when legacy clock timer was enabled by default", () => {
    storeValues.set("scrollr:settings", {
      appearance: {
        tickerLayout: {
          rows: [{ sources: ["clock"] }],
        },
      },
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock"],
        widgetsOnTicker: ["clock"],
        clock: {
          ticker: {},
        },
      }),
    });

    const prefs = loadPrefs();

    expect(prefs.appearance.tickerLayout.rows[0].sources).toEqual(["clock", "timer"]);
  });

  it("adds timer to explicit ticker layout rows when legacy widgetsOnTicker is absent", () => {
    storeValues.set("scrollr:settings", {
      appearance: {
        tickerLayout: {
          rows: [{ sources: ["clock"] }],
        },
      },
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock"],
        clock: {
          ticker: {},
        },
      }),
    });

    const prefs = loadPrefs();

    expect(prefs.appearance.tickerLayout.rows[0].sources).toEqual(["clock", "timer"]);
  });

  it("preserves current explicit clock and timer rows when timer was already on ticker", () => {
    storeValues.set("scrollr:auth", {
      accessToken: "x.eyJyb2xlcyI6WyJ1cGxpbmsiXX0.x",
      refreshToken: null,
      expiresAt: Date.now() + 60_000,
      userSub: "test-user",
    });
    storeValues.set("scrollr:settings", {
      appearance: {
        tickerLayout: {
          rows: [{ sources: ["clock"] }, { sources: ["timer"] }],
        },
      },
      widgets: legacyWidgetPrefs({
        enabledWidgets: ["clock", "timer"],
        widgetsOnTicker: ["clock", "timer"],
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
      }),
    });

    const prefs = loadPrefs();

    expect(prefs.appearance.tickerLayout.rows).toEqual([
      { sources: ["clock"] },
      { sources: ["timer"] },
    ]);
  });

  it("preserves current explicit clock-only rows when timer prefs exist", () => {
    storeValues.set("scrollr:settings", {
      appearance: {
        tickerLayout: {
          rows: [{ sources: ["clock"] }],
        },
      },
      widgets: legacyWidgetPrefs({
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
      }),
    });

    const prefs = loadPrefs();

    expect(prefs.appearance.tickerLayout.rows[0].sources).toEqual(["clock"]);
  });
});
