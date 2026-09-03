import { describe, expect, it, vi, afterEach } from "vitest";
import { gameStatusCompact, formatCountdownCompact } from "./gameHelpers";
import type { Game } from "../types";

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
  // overflow the chip's 34px status column.
  it("uses the period for a live game", () => {
    expect(gameStatusCompact(game({ state: "in", status_short: "IN4" }))).toBe("IN4");
  });

  it("prefers a running timer when one exists", () => {
    expect(gameStatusCompact(game({ state: "in", timer: "88'", status_short: "2H" }))).toBe("88'");
  });

  it("shortens a finished game to two glyphs", () => {
    // status_long is "Finished" — eight characters do not fit.
    expect(gameStatusCompact(game({ state: "final", status_long: "Finished" }))).toBe("FT");
  });

  it("marks a postponed game", () => {
    expect(gameStatusCompact(game({ state: "postponed" }))).toBe("PPD");
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
