import { describe, it, expect } from "vitest";
import {
  filterEnabledLeagues,
  resolvePrimaryLeague,
  rankFantasyLeagues,
  selectFantasyForTicker,
  fantasyEngagement,
} from "./view";
import type { LeagueResponse, Matchup, MatchupTeam } from "./types";
import type { FantasyDisplayPrefs } from "../../preferences";

// ── Fixtures ────────────────────────────────────────────────────

function team(teamKey: string): MatchupTeam {
  return {
    team_key: teamKey,
    name: `Team ${teamKey}`,
    team_logo: "",
    manager_name: "Mgr",
    points: 100,
    projected_points: 110,
  };
}

interface LeagueOpts {
  key: string;
  isFinished?: boolean;
  userTeamKey?: string | null;
  matchupStatus?: "preevent" | "midevent" | "postevent" | null;
}

function league(opts: LeagueOpts): LeagueResponse {
  const userKey = opts.userTeamKey === undefined ? `${opts.key}.t.1` : opts.userTeamKey;
  let matchups: Matchup[] | null = null;
  if (opts.matchupStatus && userKey) {
    const oppKey = `${opts.key}.t.2`;
    const mu: Matchup = {
      week: 1,
      status: opts.matchupStatus,
      is_playoffs: false,
      winner_team_key: null,
      teams: [team(userKey), team(oppKey)],
    };
    matchups = [mu];
  }
  return {
    league_key: opts.key,
    name: `League ${opts.key}`,
    game_code: "nfl",
    season: "2026",
    team_key: userKey,
    team_name: userKey ? `My Team ${opts.key}` : null,
    data: {
      num_teams: 12,
      is_finished: opts.isFinished ?? false,
      current_week: 1,
      scoring_type: "head",
    },
    standings: null,
    matchups,
    rosters: null,
  };
}

const DEFAULT_PREFS: FantasyDisplayPrefs = {
  matchupScore: "both",
  winProbability: "both",
  matchupStatus: "both",
  projectedPoints: "both",
  week: "both",
  record: "both",
  standingsPosition: "both",
  streak: "both",
  injuryCount: "both",
  topScorer: "both",
  // Phase 1 player-stats fields. Match production defaults so any
  // selectFantasyForTicker test using DEFAULT_PREFS exercises the
  // anyItemOnTicker check the same way as a real install.
  topThreeScorers: "both",
  worstStarter: "both",
  benchOpportunity: "both",
  injuryDetail: "both",
  followedPlayerKeys: [],
  showStandings: true,
  showMatchups: true,
  defaultSort: "name",
  defaultSubTab: "overview",
  primaryLeagueKey: null,
  enabledLeagueKeys: [],
};

// ── filterEnabledLeagues ────────────────────────────────────────

describe("filterEnabledLeagues", () => {
  it("passes everything through when enabledLeagueKeys is undefined", () => {
    const leagues = [league({ key: "a" }), league({ key: "b" })];
    expect(filterEnabledLeagues(leagues, undefined)).toHaveLength(2);
  });

  it("passes everything through when enabledLeagueKeys is empty", () => {
    const leagues = [league({ key: "a" }), league({ key: "b" })];
    expect(filterEnabledLeagues(leagues, [])).toHaveLength(2);
  });

  it("filters to the subset matching the allowed keys", () => {
    const leagues = [league({ key: "a" }), league({ key: "b" }), league({ key: "c" })];
    const result = filterEnabledLeagues(leagues, ["a", "c"]);
    expect(result.map((l) => l.league_key)).toEqual(["a", "c"]);
  });

  it("returns empty when no keys match", () => {
    const leagues = [league({ key: "a" })];
    expect(filterEnabledLeagues(leagues, ["nonexistent"])).toEqual([]);
  });
});

// ── resolvePrimaryLeague ────────────────────────────────────────

describe("resolvePrimaryLeague", () => {
  it("returns null for empty input", () => {
    expect(resolvePrimaryLeague([], null)).toBeNull();
  });

  it("prefers the configured key when present and resolvable", () => {
    const a = league({ key: "a", matchupStatus: "midevent" });
    const b = league({ key: "b" });
    expect(resolvePrimaryLeague([a, b], "b")).toBe(b);
  });

  it("falls back to live matchup when configured key is missing", () => {
    const a = league({ key: "a" });
    const liveLeague = league({ key: "b", matchupStatus: "midevent" });
    const c = league({ key: "c" });
    expect(resolvePrimaryLeague([a, liveLeague, c], "not-real")).toBe(liveLeague);
  });

  it("falls back to live matchup when no configured key is given", () => {
    const pre = league({ key: "a", matchupStatus: "preevent" });
    const live = league({ key: "b", matchupStatus: "midevent" });
    expect(resolvePrimaryLeague([pre, live], null)).toBe(live);
  });

  it("falls back to any scheduled/postevent matchup when no live games exist", () => {
    const noMatch = league({ key: "a" });
    const scheduled = league({ key: "b", matchupStatus: "preevent" });
    expect(resolvePrimaryLeague([noMatch, scheduled], null)).toBe(scheduled);
  });

  it("falls back to any non-finished league when no matchups exist at all", () => {
    const finished = league({ key: "a", isFinished: true });
    const active = league({ key: "b", isFinished: false });
    expect(resolvePrimaryLeague([finished, active], null)).toBe(active);
  });

  it("falls back to the first league when all are finished and have no matchups", () => {
    const a = league({ key: "a", isFinished: true });
    const b = league({ key: "b", isFinished: true });
    expect(resolvePrimaryLeague([a, b], null)).toBe(a);
  });
});

// ── rankFantasyLeagues ──────────────────────────────────────────

describe("rankFantasyLeagues", () => {
  it("promotes the primary league to the front", () => {
    const a = league({ key: "a", matchupStatus: "midevent" });
    const b = league({ key: "b" });
    const c = league({ key: "c", matchupStatus: "preevent" });
    const ranked = rankFantasyLeagues([a, b, c], "b");
    expect(ranked[0]!.league_key).toBe("b");
  });

  it("sorts remaining leagues by engagement score descending", () => {
    const finished = league({ key: "fin", isFinished: true });
    const pre = league({ key: "pre", matchupStatus: "preevent" });
    const live = league({ key: "live", matchupStatus: "midevent" });
    // Without a primary: live(100) > pre(40) > finished(0)
    const ranked = rankFantasyLeagues([finished, pre, live], null);
    expect(ranked.map((l) => l.league_key)).toEqual(["live", "pre", "fin"]);
  });

  it("does not mutate the input array", () => {
    const input = [league({ key: "a" }), league({ key: "b" })];
    const snapshot = input.map((l) => l.league_key);
    rankFantasyLeagues(input, "b");
    expect(input.map((l) => l.league_key)).toEqual(snapshot);
  });

  it("returns empty for empty input", () => {
    expect(rankFantasyLeagues([], "anything")).toEqual([]);
  });
});

// ── selectFantasyForTicker ──────────────────────────────────────

describe("selectFantasyForTicker", () => {
  it("returns [] when every per-item venue toggle is off", () => {
    const leagues = [league({ key: "a" })];
    const allOff: FantasyDisplayPrefs = {
      ...DEFAULT_PREFS,
      matchupScore: "off",
      winProbability: "off",
      matchupStatus: "off",
      projectedPoints: "off",
      week: "off",
      record: "off",
      standingsPosition: "off",
      streak: "off",
      injuryCount: "off",
      topScorer: "off",
      // Phase 1 player-stats — must also be off, otherwise the
      // selector should still return leagues.
      topThreeScorers: "off",
      worstStarter: "off",
      benchOpportunity: "off",
      injuryDetail: "off",
    };
    expect(selectFantasyForTicker(leagues, allOff)).toEqual([]);
  });

  it("returns [] when every per-item venue toggle is feed-only (nothing routes to ticker)", () => {
    const leagues = [league({ key: "a" })];
    const allFeed: FantasyDisplayPrefs = {
      ...DEFAULT_PREFS,
      matchupScore: "feed",
      winProbability: "feed",
      matchupStatus: "feed",
      projectedPoints: "feed",
      week: "feed",
      record: "feed",
      standingsPosition: "feed",
      streak: "feed",
      injuryCount: "feed",
      topScorer: "feed",
      topThreeScorers: "feed",
      worstStarter: "feed",
      benchOpportunity: "feed",
      injuryDetail: "feed",
    };
    expect(selectFantasyForTicker(leagues, allFeed)).toEqual([]);
  });

  it("returns the leagues when at least one item is routed to the ticker", () => {
    const leagues = [league({ key: "a" })];
    const onlyScoreOnTicker: FantasyDisplayPrefs = {
      ...DEFAULT_PREFS,
      matchupScore: "ticker",
      winProbability: "off",
      matchupStatus: "off",
      projectedPoints: "off",
      week: "off",
      record: "off",
      standingsPosition: "off",
      streak: "off",
      injuryCount: "off",
      topScorer: "off",
      topThreeScorers: "off",
      worstStarter: "off",
      benchOpportunity: "off",
      injuryDetail: "off",
    };
    expect(selectFantasyForTicker(leagues, onlyScoreOnTicker)).toHaveLength(1);
  });

  it("renders leagues when ONLY a player-stats segment is on the ticker", () => {
    // Phase 1 player-stats are part of the OR-gate. If a user disabled
    // every "old" item but turned on, e.g. injuryDetail for the ticker,
    // their league chip must still render.
    const leagues = [league({ key: "a" })];
    const onlyInjuryDetailOnTicker: FantasyDisplayPrefs = {
      ...DEFAULT_PREFS,
      matchupScore: "off",
      winProbability: "off",
      matchupStatus: "off",
      projectedPoints: "off",
      week: "off",
      record: "off",
      standingsPosition: "off",
      streak: "off",
      injuryCount: "off",
      topScorer: "off",
      topThreeScorers: "off",
      worstStarter: "off",
      benchOpportunity: "off",
      injuryDetail: "ticker",
    };
    expect(
      selectFantasyForTicker(leagues, onlyInjuryDetailOnTicker),
    ).toHaveLength(1);
  });

  it("returns [] when the enabledLeagueKeys filter eliminates all leagues", () => {
    const leagues = [league({ key: "a" })];
    const result = selectFantasyForTicker(leagues, {
      ...DEFAULT_PREFS,
      enabledLeagueKeys: ["nonexistent"],
    });
    expect(result).toEqual([]);
  });

  it("applies filter + primary + ranking in a realistic scenario", () => {
    const live = league({ key: "live", matchupStatus: "midevent" });
    const pre = league({ key: "pre", matchupStatus: "preevent" });
    const finished = league({ key: "fin", isFinished: true });
    const hidden = league({ key: "hidden", matchupStatus: "midevent" });

    const result = selectFantasyForTicker([live, pre, finished, hidden], {
      ...DEFAULT_PREFS,
      enabledLeagueKeys: ["live", "pre", "fin"],
      primaryLeagueKey: "pre",
    });

    expect(result.map((l) => l.league_key)).toEqual(["pre", "live", "fin"]);
  });

  it("sorts by engagement when no primary key is configured", () => {
    const finished = league({ key: "fin", isFinished: true });
    const live = league({ key: "live", matchupStatus: "midevent" });
    const pre = league({ key: "pre", matchupStatus: "preevent" });

    const result = selectFantasyForTicker([finished, pre, live], DEFAULT_PREFS);
    // resolvePrimaryLeague selects `live` (first with live matchup), becoming the primary,
    // so live goes first. Remaining: pre (40) > fin (0).
    expect(result.map((l) => l.league_key)).toEqual(["live", "pre", "fin"]);
  });
});

// ── fantasyEngagement ──────────────────────────────────────────
// (implementation detail, but locking it down since selector depends on it)

describe("fantasyEngagement", () => {
  it("returns 100 for live matchups", () => {
    expect(fantasyEngagement(league({ key: "a", matchupStatus: "midevent" }))).toBe(100);
  });

  it("returns 40 for preevent matchups", () => {
    expect(fantasyEngagement(league({ key: "a", matchupStatus: "preevent" }))).toBe(40);
  });

  it("returns 20 for postevent matchups", () => {
    expect(fantasyEngagement(league({ key: "a", matchupStatus: "postevent" }))).toBe(20);
  });

  it("returns 5 when no matchup context and league is active", () => {
    expect(fantasyEngagement(league({ key: "a" }))).toBe(5);
  });

  it("returns 0 when league is finished and has no matchup context", () => {
    expect(fantasyEngagement(league({ key: "a", isFinished: true }))).toBe(0);
  });
});
