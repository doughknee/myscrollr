import { describe, expect, it } from "vitest";
import { winProbabilityForGame } from "./winProbability";
import type { Game } from "../types";

function game(
  away: number | string | null,
  home: number | string | null,
): Game {
  return {
    id: 1,
    league: "NFL",
    sport: "american-football",
    external_game_id: "x",
    link: "",
    home_team_name: "Home",
    home_team_logo: "",
    home_team_score: home as Game["home_team_score"],
    home_team_code: "HME",
    away_team_name: "Away",
    away_team_logo: "",
    away_team_score: away as Game["away_team_score"],
    away_team_code: "AWY",
    start_time: "2026-01-01T00:00:00Z",
  };
}

describe("winProbabilityForGame", () => {
  it("is even before anyone scores", () => {
    expect(winProbabilityForGame(game(0, 0)).away).toBe(0.5);
    expect(winProbabilityForGame(game(null, null)).away).toBe(0.5);
  });

  it("leans toward whoever is ahead", () => {
    expect(winProbabilityForGame(game(24, 21)).away).toBeGreaterThan(0.5);
    expect(winProbabilityForGame(game(21, 24)).away).toBeLessThan(0.5);
  });

  it("stays humble early — a 7-0 first quarter is not a near-certainty", () => {
    // Raw share would be 1.0 here. Damping has to pull it well back.
    const early = winProbabilityForGame(game(7, 0)).away;
    expect(early).toBeGreaterThan(0.5);
    expect(early).toBeLessThan(0.65);
  });

  it("grows more confident as points accumulate at the same ratio", () => {
    const early = winProbabilityForGame(game(7, 0)).away;
    const late = winProbabilityForGame(game(35, 0)).away;
    expect(late).toBeGreaterThan(early);
  });

  it("never claims certainty, even in a blowout", () => {
    const blowout = winProbabilityForGame(game(59, 0)).away;
    expect(blowout).toBeLessThan(1);
    expect(blowout).toBeGreaterThan(0.7);
  });

  it("is symmetric — mirroring the score mirrors the lean", () => {
    const a = winProbabilityForGame(game(31, 17)).away;
    const b = winProbabilityForGame(game(17, 31)).away;
    expect(a + b).toBeCloseTo(1, 10);
  });

  it("handles string scores, which the payload sometimes sends", () => {
    expect(winProbabilityForGame(game("24", "21")).away).toBeCloseTo(
      winProbabilityForGame(game(24, 21)).away,
      10,
    );
  });

  it("stays inside 0..1 for junk input rather than producing NaN", () => {
    const v = winProbabilityForGame(game("oops", "")).away;
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("reports that it is NOT a real probability", () => {
    // The whole point of the flag: nothing may print this as a win
    // chance until a real model is behind it.
    expect(winProbabilityForGame(game(24, 21)).isRealProbability).toBe(false);
  });
});
