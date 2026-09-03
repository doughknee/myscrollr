/**
 * The chip's league label rendered game.league raw, so "FORMULA 1" -- nine
 * characters, ~55px at 8px uppercase with 0.08em tracking -- was clipped in
 * a column 34px wide. The column cannot grow: it is paid for out of the
 * 164px the team names need.
 */
import { describe, it, expect } from "vitest";
import { leagueCode, LEAGUE_CODE_MAX } from "./gameHelpers";

// Every league in tracked_leagues as of 2026-09.
const CATALOG = [
  "AFL",
  "Champions League",
  "FIFA World Cup",
  "Formula 1",
  "Handball Bundesliga",
  "Handball Champions League",
  "La Liga",
  "MLB",
  "MLS",
  "NBA",
  "NCAA Basketball",
  "NCAA Football",
  "NFL",
  "NHL",
  "Premier League",
  "Premiership Rugby",
  "Six Nations",
  "Starligue",
  "Super Rugby",
  "UFC",
  "Volleyball Champions League",
  "Volleyball Nations League",
];

describe("leagueCode", () => {
  it("fits every league in the catalog into the column", () => {
    for (const name of CATALOG) {
      const code = leagueCode(name);
      expect(code.length, `${name} -> ${code}`).toBeLessThanOrEqual(LEAGUE_CODE_MAX);
      expect(code.length, `${name} produced an empty code`).toBeGreaterThan(0);
    }
  });

  it("gives every league a distinct code", () => {
    // Two leagues sharing a code is worse than a long one: the chip would
    // claim a La Liga fixture is a Premier League fixture. Premiership
    // Rugby and the Premier League are the near-miss this guards.
    const codes = CATALOG.map(leagueCode);
    expect(new Set(codes).size).toBe(CATALOG.length);
  });

  it("uses the code a viewer of that sport would recognise", () => {
    expect(leagueCode("Formula 1")).toBe("F1");
    expect(leagueCode("Champions League")).toBe("UCL");
    expect(leagueCode("Premier League")).toBe("EPL");
    // Already a code — passed through, not re-derived into "M".
    expect(leagueCode("MLS")).toBe("MLS");
  });

  it("falls back to initials for a league added after this map", () => {
    expect(leagueCode("Super Duper League")).toBe("SDL");
    // Single long word has no initials to take; clipping is all that is left.
    expect(leagueCode("Bundesliga")).toBe("BUNDE");
  });
});
