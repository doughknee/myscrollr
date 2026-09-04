/**
 * The whole catalog, not samples. `__fixtures__/team-names.json` is every
 * distinct (league, name) the chip can render -- the union of the teams
 * table and both sides of every game -- exported from a production capture.
 * 2,022 names. If a rule produces a collision or a name over budget for any
 * of them, this fails naming the offender, which is what "no manual review"
 * has to mean.
 */
import { describe, it, expect } from "vitest";
import { teamShortName, institutionKey, SHORT_NAME_BUDGET } from "./teamShortName";
import catalog from "./__fixtures__/team-names.json";

type Row = { league: string; name: string };
const ROWS = catalog as Row[];

describe("teamShortName", () => {
  it("has the whole catalog to test against", () => {
    expect(ROWS.length).toBeGreaterThan(1500);
  });

  it("leaves every name that already fits untouched", () => {
    for (const { league, name } of ROWS) {
      if (name.trim().length <= SHORT_NAME_BUDGET) {
        expect(teamShortName(league, name)).toBe(name.trim());
      }
    }
  });

  it("brings every name in the catalog within budget", () => {
    const over = ROWS.map((r) => ({ ...r, short: teamShortName(r.league, r.name) })).filter(
      (r) => r.short.length > SHORT_NAME_BUDGET || r.short.length === 0,
    );
    expect(over, JSON.stringify(over, null, 1)).toEqual([]);
  });

  it("never gives two different teams in one league the same short name", () => {
    // The catalog holds a few schools under two spellings -- "West
    // Virginia" and "West Virginia University" are one team -- and those
    // SHOULD render alike. A clash is two different institutions.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { league, name } of ROWS) {
      const key = `${league}::${teamShortName(league, name).toLowerCase()}`;
      const prior = seen.get(key);
      if (prior && prior !== name && institutionKey(prior) !== institutionKey(name)) {
        clashes.push(`${league}: "${prior}" and "${name}" both -> ${key.split("::")[1]}`);
      }
      seen.set(key, name);
    }
    expect(clashes, clashes.join(" | ")).toEqual([]);
  });

  it("reads the way a fan would say it", () => {
    expect(teamShortName("MLB", "Philadelphia Phillies")).toBe("Phillies");
    expect(teamShortName("MLS", "New England Revolution")).toBe("Revolution");
    expect(teamShortName("NBA", "Portland Trail Blazers")).toBe("Trail Blazers");
    expect(teamShortName("NBA", "Oklahoma City Thunder")).toBe("Thunder");
    expect(teamShortName("AFL", "Greater Western Sydney Giants")).toBe("GWS Giants");
    expect(teamShortName("UFC", "Matthieu Letho Duclos")).toBe("Letho Duclos");
    expect(teamShortName("Formula 1", "Azerbaijan Grand Prix")).toBe("Azerbaijan GP");
    expect(teamShortName("Formula 1", "Autódromo José Carlos Pace")).toBe("Interlagos");
  });

  it("abbreviates NCAA institutions AP-style rather than cutting them", () => {
    expect(teamShortName("NCAA Football", "Southern Connecticut State")).toBe("S. Connecticut State");
    expect(teamShortName("NCAA Football", "Mississippi Valley State")).toBe("Miss. Valley State");
    expect(teamShortName("NCAA Football", "University of the Cumberlands (KY)")).toBe("Cumberlands (KY)");
    expect(teamShortName("NCAA Basketball", "Northern State University Wolves")).toBe("N. State Wolves");
    expect(teamShortName("NCAA Football", "Washington & Jefferson")).toBe("Wash. & Jefferson");
    expect(teamShortName("NCAA Football", "Washington University-St. Louis")).toBe("Washington-St. Louis");
    // The three Connecticut States stay three different strings.
    const conn = ["Southern", "Central", "Western"].map((d) =>
      teamShortName("NCAA Football", `${d} Connecticut State`),
    );
    expect(new Set(conn).size).toBe(3);
  });

  it("keeps a state qualifier as the disambiguator it is", () => {
    expect(teamShortName("NCAA Football", "University Of Charleston (WV)")).toBe("Charleston (WV)");
    expect(teamShortName("NCAA Football", "Wilmington (DE) Wildcats")).toBe("Wilmington (DE)");
  });
});
