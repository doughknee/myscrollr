import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectSportsForTicker,
  selectSportsForFeed,
  gameEngagement,
  normalizeSportsDisplayConfig,
  SPORTS_WINDOW_DEFAULTS,
  SPORTS_WINDOW_MAX_DAYS,
  SPORTS_WINDOW_MAX_DAYS_AHEAD,
} from "./view";
import type { SportsDisplayConfig } from "./view";
import type { Game } from "../../types";

// ── Fixtures ────────────────────────────────────────────────────

// Fix "now" so time-based engagement is deterministic.
const NOW = new Date("2026-06-01T12:00:00Z");

function mk(overrides: Partial<Game> & { id: number; state?: string }): Game {
  const defaults: Game = {
    id: overrides.id,
    league: "NFL",
    sport: "american-football",
    external_game_id: `ext-${overrides.id}`,
    link: `https://example.com/${overrides.id}`,
    home_team_name: "Home",
    home_team_logo: "",
    home_team_score: 0,
    home_team_code: "HOM",
    away_team_name: "Away",
    away_team_logo: "",
    away_team_score: 0,
    away_team_code: "AWY",
    start_time: NOW.toISOString(),
    state: "pre",
  };
  return { ...defaults, ...overrides };
}

function preGame(id: number, startInMs: number): Game {
  return mk({
    id,
    state: "pre",
    start_time: new Date(NOW.getTime() + startInMs).toISOString(),
  });
}

function liveGame(id: number, closeScoreDiff = 10): Game {
  return mk({
    id,
    state: "in_progress",
    home_team_score: 20 + closeScoreDiff,
    away_team_score: 20,
    start_time: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
  });
}

function finalGame(id: number, finishedAgoMs: number): Game {
  return mk({
    id,
    state: "final",
    home_team_score: 28,
    away_team_score: 21,
    start_time: new Date(NOW.getTime() - finishedAgoMs).toISOString(),
  });
}

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── gameEngagement ──────────────────────────────────────────────

describe("gameEngagement", () => {
  it("returns 100 for live + close game", () => {
    // basketball close threshold = 6
    const g = mk({
      id: 1,
      state: "in_progress",
      sport: "basketball",
      home_team_score: 60,
      away_team_score: 58,
    });
    expect(gameEngagement(g)).toBe(100);
  });

  it("returns 80 for live but not close", () => {
    const g = mk({
      id: 1,
      state: "in_progress",
      sport: "basketball",
      home_team_score: 80,
      away_team_score: 50,
    });
    expect(gameEngagement(g)).toBe(80);
  });

  it("returns 60 for any pre-game regardless of how far out it is", () => {
    // Engagement is state-only — no time bucketing — so a pre-game's
    // sort priority doesn't flip on dashboard refetches as it drifts
    // across clock thresholds. Continuous time-of-day priority is
    // applied via the start_time tie-break in selectSportsForTicker.
    expect(gameEngagement(preGame(1, 30 * 60_000))).toBe(60);
    expect(gameEngagement(preGame(2, 6 * 3_600_000))).toBe(60);
    expect(gameEngagement(preGame(3, 48 * 3_600_000))).toBe(60);
  });

  it("returns 30 for any final game regardless of how long ago it ended", () => {
    // Same rationale as pre-games — engagement is state-only, recency
    // is handled by the start_time tie-break in the selector.
    expect(gameEngagement(finalGame(1, 30 * 60_000))).toBe(30);
    expect(gameEngagement(finalGame(2, 5 * 3_600_000))).toBe(30);
    expect(gameEngagement(finalGame(3, 48 * 3_600_000))).toBe(30);
  });

  it("returns 0 for games in unknown states", () => {
    expect(gameEngagement(mk({ id: 1, state: "postponed" }))).toBe(0);
  });

  it("is stable across simulated time drift", () => {
    // The fix's core invariant: a game's engagement must not change
    // simply because wall-clock time has advanced. This is what the
    // old time-bucketed implementation got wrong, producing the
    // 4000-9000px marquee transform jumps on every dashboard refetch.
    const upcoming = preGame(1, 90 * 60_000); // 90 minutes away
    const recent = finalGame(2, 30 * 60_000); // finished 30 minutes ago
    const before = { upcoming: gameEngagement(upcoming), recent: gameEngagement(recent) };

    // Advance system clock past every old time-bucket boundary.
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 3_600_000)); // +6 hours
    const after = { upcoming: gameEngagement(upcoming), recent: gameEngagement(recent) };

    expect(after).toEqual(before);
  });
});

// ── selectSportsForTicker ───────────────────────────────────────

describe("selectSportsForTicker", () => {
  it("sorts by engagement score, live games first", () => {
    const games = [
      preGame(1, 12 * 3_600_000),   // score 40
      liveGame(2),                   // score 80
      finalGame(3, 30 * 60_000),     // score 30
    ];
    const result = selectSportsForTicker(games, null);
    expect(result.map((g) => g.id)).toEqual([2, 1, 3]);
  });

  it("defaults to show both upcoming and final when config is null", () => {
    const games = [preGame(1, 10 * 60_000), finalGame(2, 60 * 60_000)];
    const result = selectSportsForTicker(games, null);
    expect(result).toHaveLength(2);
  });

  it("defaults to show both upcoming and final when config is undefined", () => {
    const games = [preGame(1, 10 * 60_000), finalGame(2, 60 * 60_000)];
    const result = selectSportsForTicker(games, undefined);
    expect(result).toHaveLength(2);
  });

  // ── Day window (v1.1.3 Time Controls) ──────────────────────────

  it("hides finals older than daysBack (calendar-day anchored)", () => {
    const games = [
      finalGame(1, 30 * 60_000),          // finished 30m ago — today
      finalGame(2, 3 * 24 * 3_600_000),   // 3 days ago
      liveGame(3),
    ];
    const config: SportsDisplayConfig = { daysBack: 1, daysAhead: 7 };
    const result = selectSportsForTicker(games, config);
    expect(result.map((g) => g.id)).toEqual([3, 1]);
  });

  it("hides pre-games beyond daysAhead", () => {
    const games = [
      preGame(1, 30 * 60_000),            // in 30 minutes
      preGame(2, 5 * 24 * 3_600_000),     // in 5 days
    ];
    const config: SportsDisplayConfig = { daysBack: 1, daysAhead: 1 };
    const result = selectSportsForTicker(games, config);
    expect(result.map((g) => g.id)).toEqual([1]);
  });

  it("'Today' (0/0) keeps tonight's game AND today's earlier final", () => {
    // Calendar-day anchoring: at any time of day, the whole of today
    // is inside a 0/0 window — a rolling ±0h window would be empty.
    const games = [
      preGame(1, 2 * 3_600_000),   // tips off in 2h (still today at NOW)
      finalGame(2, 2 * 3_600_000), // ended 2h ago (still today at NOW)
      preGame(3, 2 * 24 * 3_600_000), // day after tomorrow
    ];
    const result = selectSportsForTicker(games, { daysBack: 0, daysAhead: 0 });
    expect(result.map((g) => g.id)).toEqual([1, 2]);
  });

  it("live games always show, even outside the window", () => {
    const games = [
      liveGame(1),
      finalGame(2, 4 * 24 * 3_600_000), // way outside
    ];
    const result = selectSportsForTicker(games, { daysBack: 0, daysAhead: 0 });
    expect(result.map((g) => g.id)).toEqual([1]);
  });

  it("legacy showFinal:'off' maps to daysBack 0 via normalize", () => {
    const cfg = normalizeSportsDisplayConfig({ showFinal: "off" });
    expect(cfg.daysBack).toBe(0);
    expect(cfg.daysAhead).toBe(SPORTS_WINDOW_DEFAULTS.daysAhead);
  });

  it("legacy showUpcoming:'off' maps to daysAhead 0 via normalize", () => {
    const cfg = normalizeSportsDisplayConfig({ showUpcoming: "off" });
    expect(cfg.daysAhead).toBe(0);
    expect(cfg.daysBack).toBe(SPORTS_WINDOW_DEFAULTS.daysBack);
  });

  it("explicit stored day values beat the legacy inference", () => {
    const cfg = normalizeSportsDisplayConfig({
      showFinal: "off", // would infer 0…
      daysBack: 3,      // …but explicit wins
      daysAhead: 99,
    });
    expect(cfg.daysBack).toBe(3);
    // 99 days ahead is a legitimate window: forward fixtures are never
    // pruned, so the server really does hold a season of them.
    expect(cfg.daysAhead).toBe(99);
  });

  it("clamps each direction to its own ceiling, which are not the same", () => {
    // cleanup_old_games deletes past games after 7 days but never touches
    // future ones. Clamping ahead to 7 as well was what left an F1 user
    // -- races 1-3 weeks apart -- with no window that could reach the
    // next race, from any preset including "Everything".
    const cfg = normalizeSportsDisplayConfig({ daysBack: 400, daysAhead: 400 });
    expect(cfg.daysBack).toBe(SPORTS_WINDOW_MAX_DAYS);
    expect(cfg.daysAhead).toBe(SPORTS_WINDOW_MAX_DAYS_AHEAD);
    expect(SPORTS_WINDOW_MAX_DAYS_AHEAD).toBeGreaterThan(SPORTS_WINDOW_MAX_DAYS);
  });

  it("shows a fixture three weeks out once the window is widened", () => {
    // The reported symptom, end to end: the next F1 race was 9 days away
    // and the Scores tab was empty at every setting.
    //
    // Asserted on the FEED, not the ticker. This is about the widget
    // page's day window; the ticker applies its own near-term horizon on
    // top and would answer a different question.
    const race = mk({
      id: 900,
      state: "pre",
      start_time: new Date(NOW.getTime() + 21 * 86_400_000).toISOString(),
    });
    const wide = normalizeSportsDisplayConfig({ daysBack: 7, daysAhead: 365 });
    expect(selectSportsForFeed([race], wide, new Set(), NOW.getTime())).toHaveLength(1);
    // ...and is still correctly hidden by the default week-ahead window.
    const dflt = normalizeSportsDisplayConfig({});
    expect(selectSportsForFeed([race], dflt, new Set(), NOW.getTime())).toHaveLength(0);
  });

  it("returns [] for empty input", () => {
    expect(selectSportsForTicker([], null)).toEqual([]);
  });

  it("breaks ties between pre-games by soonest start_time first", () => {
    // Two upcoming games at the same engagement bucket (60). The one
    // starting sooner should sort first — same intuitive priority the
    // old "within-1-hour > within-24h" buckets encoded discretely,
    // now expressed continuously.
    const games = [
      preGame(1, 6 * 3_600_000), // starts in 6h
      preGame(2, 30 * 60_000),   // starts in 30m
      preGame(3, 12 * 3_600_000), // starts in 12h
    ];
    const result = selectSportsForTicker(games, null);
    expect(result.map((g) => g.id)).toEqual([2, 1, 3]);
  });

  it("breaks ties between final games by most-recently-finished first", () => {
    // Two finished games at the same engagement bucket (30). The one
    // that ended more recently should sort first.
    const games = [
      finalGame(1, 5 * 3_600_000),   // finished 5h ago
      finalGame(2, 30 * 60_000),      // finished 30m ago
      finalGame(3, 12 * 3_600_000),   // finished 12h ago
    ];
    const result = selectSportsForTicker(games, null);
    expect(result.map((g) => g.id)).toEqual([2, 1, 3]);
  });

  it("produces the same order on repeated calls (stable across refetches)", () => {
    // Regression test for the marquee-snap bug: dashboard refetches
    // every ~30s would re-evaluate the time-bucketed engagement and
    // produce a different order, causing the rail to snap.
    //
    // Every game here sits far enough inside the ticker horizon to stay
    // inside it after the clock advance, so this tests ORDER stability
    // alone. Membership changing as a game ages out is the horizon doing
    // its job, and is covered separately below.
    const games = [
      preGame(1, 20 * 3_600_000),
      preGame(2, 18 * 3_600_000),
      liveGame(3),
      finalGame(4, 4 * 3_600_000),
      finalGame(5, 2 * 3_600_000),
    ];
    const orderAtT0 = selectSportsForTicker(games, null).map((g) => g.id);
    expect(orderAtT0).toHaveLength(5);

    // Advance past every old engagement boundary.
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3_600_000));
    const orderAtT1 = selectSportsForTicker(games, null).map((g) => g.id);

    expect(orderAtT1).toEqual(orderAtT0);
  });

  // ── Ticker horizon ────────────────────────────────────────────
  //
  // The bar showed every game in the widget's day window -- up to a week.
  // Three league widgets produced 38 chips, 30 from MLS alone, none live:
  // a fixture list rather than a glance.

  it("keeps only near-term games, but never drops a live one", () => {
    const games = [
      liveGame(1),
      preGame(2, 3 * 3_600_000), // tonight
      preGame(3, 5 * 86_400_000), // five days out
      finalGame(4, 4 * 3_600_000), // this afternoon
      finalGame(5, 5 * 86_400_000), // last week
    ];
    const wide = { daysBack: 7, daysAhead: 365 };
    expect(selectSportsForTicker(games, wide).map((g) => g.id)).toEqual([1, 2, 4]);
  });

  it("keeps a live game that started long before the horizon", () => {
    // A test match or a rain delay can run for hours. State wins over
    // clock: nothing live is ever cut.
    const stillOn = { ...liveGame(1), start_time: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() };
    expect(selectSportsForTicker([stillOn], { daysBack: 7, daysAhead: 365 })).toHaveLength(1);
  });

  it("still shows one fixture for a league with nothing near-term", () => {
    // Formula 1: races 1-3 weeks apart. A pure horizon would leave the
    // bar empty 13 days in 14, so a widget the user deliberately added
    // would show nothing at all. The floor is one chip, not zero.
    const races = [
      preGame(1, 3 * 86_400_000),
      preGame(2, 17 * 86_400_000),
      preGame(3, 24 * 86_400_000),
    ];
    const result = selectSportsForTicker(races, { daysBack: 7, daysAhead: 365 });
    expect(result.map((g) => g.id)).toEqual([1]); // the soonest, and only it
  });

  it("does not reach past a week for that one fixture", () => {
    // Uncapped, the floor surfaced fixtures a month out, which sat beside
    // a 19h chip reading as an arbitrary date rather than as "this is all
    // this league has". A league between seasons now stays off the bar.
    const races = [preGame(1, 10 * 86_400_000), preGame(2, 24 * 86_400_000)];
    expect(selectSportsForTicker(races, { daysBack: 7, daysAhead: 365 })).toEqual([]);
  });

  it("does not invent a chip for a league with nothing upcoming at all", () => {
    // The floor admits the next fixture; it does not resurrect old ones.
    const games = [finalGame(1, 6 * 86_400_000)];
    expect(selectSportsForTicker(games, { daysBack: 7, daysAhead: 365 })).toEqual([]);
  });

  it("leaves the widget page showing the full day window", () => {
    // The horizon is a rule about a glanceable bar. The page you open to
    // read the whole slate must not inherit it.
    const games = [preGame(1, 3 * 3_600_000), preGame(2, 5 * 86_400_000)];
    const wide = { daysBack: 7, daysAhead: 365 };
    expect(selectSportsForTicker(games, wide)).toHaveLength(1);
    expect(selectSportsForFeed(games, wide, new Set())).toHaveLength(2);
  });
});

describe("selectSportsForFeed", () => {
  it("promotes favorites, then keeps live, upcoming, and recent finals ordered", () => {
    const games = [
      finalGame(1, 30 * 60_000),
      preGame(2, 2 * 3_600_000),
      liveGame(3),
      { ...finalGame(4, 60 * 60_000), home_team_name: "Favorite" },
    ];
    const result = selectSportsForFeed(
      games,
      null,
      new Set(["Favorite"]),
      NOW.getTime(),
    );
    expect(result.map((g) => g.id)).toEqual([4, 3, 2, 1]);
  });
});

// ── arrangeTickerSlots ──────────────────────────────────────────

import { arrangeTickerSlots } from "./view";

describe("arrangeTickerSlots", () => {
  const g = (id: number, away: string, home: string, state = "pre") =>
    mk({ id, state, away_team_name: away, home_team_name: home, league: "MLB" });
  const pool = [
    g(1, "Tampa Bay Rays", "Texas Rangers"),
    g(2, "Arizona Diamondbacks", "Houston Astros"),
    g(3, "Toronto Blue Jays", "Kansas City Royals"),
    g(4, "New York Yankees", "San Diego Padres"),
    g(5, "Chicago Cubs", "Miami Marlins"),
  ];
  const NONE = new Set<string>();

  it("keys every game by id when the pool fits the slots", () => {
    const out = arrangeTickerSlots(pool.slice(0, 3), NONE, 4, {}, "p");
    expect(out.map((s) => s.key)).toEqual(["p-1", "p-2", "p-3"]);
    expect(out.every((s) => !s.rotateSlot && !s.reserveNames)).toBe(true);
  });

  it("gives a bigger pool exactly `slots` rotating positions", () => {
    const out = arrangeTickerSlots(pool, NONE, 2, {}, "p");
    expect(out.map((s) => s.key)).toEqual(["p-slot-0", "p-slot-1"]);
    expect(out.map((s) => s.game.id)).toEqual([1, 2]);
  });

  it("walks each slot through its own residue class as its laps advance", () => {
    // slot 0 owns games 1,3,5; slot 1 owns 2,4. Independent counters.
    const at = (c: Record<string, number>) =>
      arrangeTickerSlots(pool, NONE, 2, c, "p").map((s) => s.game.id);
    expect(at({ "p-slot-0": 1 })).toEqual([3, 2]);
    expect(at({ "p-slot-0": 2, "p-slot-1": 1 })).toEqual([5, 4]);
    expect(at({ "p-slot-0": 3, "p-slot-1": 2 })).toEqual([1, 2]); // wrapped
  });

  it("reserves the widest names a slot will actually show, not the league's", () => {
    const [s0, s1] = arrangeTickerSlots(pool, NONE, 2, {}, "p");
    // The reserve is what the chip RENDERS, and teamShortName leaves any
    // name within its 20-character budget untouched -- so these are the
    // widest full names in each slot's class, not abbreviations.
    // slot 0: games 1, 3, 5
    expect(s0.reserveNames).toEqual({ away: "Toronto Blue Jays", home: "Kansas City Royals" });
    // slot 1: games 2, 4
    expect(s1.reserveNames).toEqual({ away: "Arizona Diamondbacks", home: "San Diego Padres" });
  });

  it("pins a favourite's game outside the slot count", () => {
    const favs = new Set(["Chicago Cubs"]);
    const out = arrangeTickerSlots(pool, favs, 2, {}, "p");
    expect(out.map((s) => s.key)).toEqual(["p-5", "p-slot-0", "p-slot-1"]);
    // and the favourite never appears in a rotating slot's class
    const rotating = arrangeTickerSlots(pool, favs, 2, { "p-slot-0": 9, "p-slot-1": 9 }, "p")
      .filter((s) => s.rotateSlot)
      .map((s) => s.game.id);
    expect(rotating).not.toContain(5);
  });

  it("does not rotate when the favourites alone exceed the slots", () => {
    const favs = new Set(["Tampa Bay Rays", "Arizona Diamondbacks", "Toronto Blue Jays"]);
    const out = arrangeTickerSlots(pool.slice(0, 4), favs, 1, {}, "p");
    // three pinned, one non-favourite fits in the single slot: no rotation
    expect(out.map((s) => s.key)).toEqual(["p-1", "p-2", "p-3", "p-4"]);
  });
});

describe("normalizeSportsDisplayConfig tickerSlots", () => {
  it("defaults, rounds and clamps", async () => {
    const { normalizeSportsDisplayConfig, TICKER_SLOTS_DEFAULT, TICKER_SLOTS_MAX } =
      await import("./view");
    expect(normalizeSportsDisplayConfig({}).tickerSlots).toBe(TICKER_SLOTS_DEFAULT);
    expect(normalizeSportsDisplayConfig({ tickerSlots: 2.6 }).tickerSlots).toBe(3);
    expect(normalizeSportsDisplayConfig({ tickerSlots: 0 }).tickerSlots).toBe(1);
    expect(normalizeSportsDisplayConfig({ tickerSlots: 99 }).tickerSlots).toBe(TICKER_SLOTS_MAX);
    expect(normalizeSportsDisplayConfig({ tickerSlots: "4" }).tickerSlots).toBe(TICKER_SLOTS_DEFAULT);
  });
});
