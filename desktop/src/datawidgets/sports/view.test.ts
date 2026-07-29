import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectSportsForTicker,
  selectSportsForFeed,
  gameEngagement,
  normalizeSportsDisplayConfig,
  SPORTS_WINDOW_DEFAULTS,
  SPORTS_WINDOW_MAX_DAYS,
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

  it("explicit stored day values beat the legacy inference and clamp", () => {
    const cfg = normalizeSportsDisplayConfig({
      showFinal: "off", // would infer 0…
      daysBack: 3,      // …but explicit wins
      daysAhead: 99,    // clamped to the retention horizon
    });
    expect(cfg.daysBack).toBe(3);
    expect(cfg.daysAhead).toBe(SPORTS_WINDOW_MAX_DAYS);
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
    const games = [
      preGame(1, 90 * 60_000),  // crosses old 1h boundary as time advances
      preGame(2, 30 * 60_000),  // already inside old 1h boundary
      liveGame(3),
      finalGame(4, 90 * 60_000), // crosses old 2h boundary as time advances
      finalGame(5, 30 * 60_000), // already inside old 2h boundary
    ];
    const orderAtT0 = selectSportsForTicker(games, null).map((g) => g.id);

    // Advance past every old boundary.
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3_600_000));
    const orderAtT1 = selectSportsForTicker(games, null).map((g) => g.id);

    expect(orderAtT1).toEqual(orderAtT0);
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
