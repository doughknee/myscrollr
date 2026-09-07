import { describe, expect, it, vi, afterEach } from "vitest";
import { gameStatusCompact, formatCountdownCompact } from "./gameHelpers";
import type { Game } from "../types";
import mlb from "./__fixtures__/mlb-game.production.json";

// Only the fields the status helpers read.
const game = (over: Partial<Game>): Game =>
  ({
    id: 1,
    league: "MLB",
    sport: "baseball",
    external_game_id: "1",
    link: "",
    home_team_name: "Home",
    home_team_logo: "",
    home_team_score: 0,
    home_team_code: "",
    away_team_name: "Away",
    away_team_logo: "",
    away_team_score: 0,
    away_team_code: "",
    start_time: new Date().toISOString(),
    ...over,
  }) as Game;

afterEach(() => vi.useRealTimers());

describe("gameStatusCompact", () => {
  // The roomy gameStatusLabel returns "Finished" and "in 3h 20m", which
  // overflow the chip's 34px status column. The codes below are what the
  // ingester actually writes (channels/sports/service/src/lib.rs), per
  // family; the dev clock (scripts/dev/live.sh) emits the same ones.
  it("names a baseball inning by its ordinal, extras included", () => {
    expect(gameStatusCompact(game({ state: "in", status_short: "IN1", status_long: "Inning 1" }))).toBe("1st");
    expect(gameStatusCompact(game({ state: "in", status_short: "IN2" }))).toBe("2nd");
    expect(gameStatusCompact(game({ state: "in", status_short: "IN3" }))).toBe("3rd");
    expect(gameStatusCompact(game({ state: "in", status_short: "IN8", status_long: "Inning 8" }))).toBe("8th");
    expect(gameStatusCompact(game({ state: "in", status_short: "IN10" }))).toBe("10th");
    expect(gameStatusCompact(game({ state: "in", status_short: "IN12" }))).toBe("12th");
  });

  it("ignores the statsapi fallback's timer and still reads the inning", () => {
    // REL-233's sweep writes status_short IN{n}, status_long "In Progress",
    // timer "Inn n" — same word on the bar either way.
    expect(
      gameStatusCompact(game({ state: "in", status_short: "IN7", status_long: "In Progress", timer: "Inn 7" })),
    ).toBe("7th");
  });

  it("does not print an inning it does not have", () => {
    // The fallback writes IN0 before the linescore exists.
    expect(gameStatusCompact(game({ state: "in", status_short: "IN0" }))).toBe("LIVE");
  });

  it("keeps the period code for sports that carry one", () => {
    expect(gameStatusCompact(game({ sport: "american-football", state: "in", status_short: "Q3" }))).toBe("Q3");
    expect(gameStatusCompact(game({ sport: "football", state: "in", status_short: "HT" }))).toBe("HT");
  });

  it("prefers a running timer when one exists", () => {
    expect(gameStatusCompact(game({ sport: "football", state: "in", timer: "67′", status_short: "2H" }))).toBe("67′");
    expect(
      gameStatusCompact(game({ sport: "american-football", state: "in", timer: "04:32", status_short: "Q4" })),
    ).toBe("04:32");
  });

  it("counts down to a game not started, in every sport", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T14:00:00Z"));
    expect(gameStatusCompact(game({ state: "pre", status_short: "NS", start_time: "2026-09-07T17:05:00Z" }))).toBe("3h05");
  });

  it("says Final, not the code", () => {
    // status_long is "Finished" — eight characters do not fit; "FT" is
    // soccer's word for it and means nothing at a ballpark.
    expect(gameStatusCompact(game({ state: "final", status_short: "FT", status_long: "Finished" }))).toBe("Final");
    expect(gameStatusCompact(game({ sport: "football", state: "final", status_short: "FT", timer: "90′" }))).toBe("Final");
  });

  it("marks postponed, delayed, cancelled and abandoned games by their code, whatever the state", () => {
    expect(gameStatusCompact(game({ state: "postponed", status_short: "PST" }))).toBe("PPD");
    // The ingester's state map does not know baseball's POST/INTR, so they
    // arrive as "in"; the code is still the truth.
    expect(gameStatusCompact(game({ state: "in", status_short: "POST", status_long: "Postponed" }))).toBe("PPD");
    expect(gameStatusCompact(game({ state: "in", status_short: "INTR", status_long: "Interrupted" }))).toBe("Delay");
    expect(gameStatusCompact(game({ state: "pre", status_short: "CANC", status_long: "Cancelled" }))).toBe("CANC");
    expect(gameStatusCompact(game({ state: "final", status_short: "ABD", status_long: "Abandoned" }))).toBe("ABD");
  });

  it("renders production-shaped MLB rows as the bar shows them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T14:00:00Z"));
    const rows = mlb as unknown as Record<"pre" | "live" | "final", Game>;
    expect({
      pre: gameStatusCompact(rows.pre),
      live: gameStatusCompact(rows.live),
      final: gameStatusCompact(rows.final),
    }).toMatchInlineSnapshot(`
      {
        "final": "Final",
        "live": "8th",
        "pre": "3h05",
      }
    `);
  });
});

describe("formatCountdownCompact", () => {
  const at = (iso: string, now: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    return formatCountdownCompact(iso);
  };

  it("packs hours and minutes into four characters", () => {
    expect(at("2026-09-03T15:20:00Z", "2026-09-03T12:00:00Z")).toBe("3h20");
  });

  it("pads the minutes so the width never jumps", () => {
    // "3h5" and "3h05" render at different widths in a fixed column.
    expect(at("2026-09-03T15:05:00Z", "2026-09-03T12:00:00Z")).toBe("3h05");
  });

  it("drops the minutes past ten hours, where they are noise and do not fit", () => {
    // "22h28" is 5 chars / 30px at 10px mono — the whole usable width of the
    // 34px status column.
    expect(at("2026-09-04T10:28:00Z", "2026-09-03T12:00:00Z")).toBe("22h");
  });

  it("drops to minutes under the hour", () => {
    expect(at("2026-09-03T12:45:00Z", "2026-09-03T12:00:00Z")).toBe("45m");
  });

  it("switches to days, then to a date past two days", () => {
    expect(at("2026-09-04T18:00:00Z", "2026-09-03T12:00:00Z")).toBe("1d");
    expect(at("2026-09-09T18:00:00Z", "2026-09-03T12:00:00Z")).toMatch(/Sep/);
  });

  it("says NOW rather than a negative countdown", () => {
    expect(at("2026-09-03T11:00:00Z", "2026-09-03T12:00:00Z")).toBe("NOW");
  });
});
