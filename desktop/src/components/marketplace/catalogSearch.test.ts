import { describe, expect, it } from "vitest";

import {
  byNewest,
  closestGroup,
  groupByShelf,
  haystack,
  isNew,
  matchesQuery,
  missName,
  showGroupHeaders,
} from "./catalogSearch";
import { getCatalogItems } from "../../marketplace";

const items = getCatalogItems().filter((i) => !i.hidden);
const byId = (id: string) => items.find((i) => i.id === id)!;

describe("haystack", () => {
  it("is name + description + group + category label + keywords", () => {
    const h = haystack(byId("finance_crypto"));
    expect(h).toContain("crypto"); // name
    expect(h).toContain("watchlist"); // description
    expect(h).toContain("markets"); // group
    expect(h).toContain("finance"); // category label
    expect(h).toContain("btc"); // keyword
  });

  it("matches aliases people actually type", () => {
    expect(matchesQuery(byId("finance_crypto"), "Bitcoin")).toBe(true);
    expect(matchesQuery(byId("sports_premierleague"), "soccer")).toBe(true);
    expect(matchesQuery(byId("sports_nfl"), "soccer")).toBe(false);
    // Empty and whitespace-only queries match everything.
    expect(matchesQuery(byId("sports_nfl"), "   ")).toBe(true);
  });

  it("finds nothing for a league we don't carry", () => {
    expect(items.some((i) => matchesQuery(i, "Eredivisie"))).toBe(false);
  });
});

describe("grouping", () => {
  it("shelves a kind by group in first-appearance order", () => {
    const sports = items.filter((i) => i.category === "sports");
    const shelves = groupByShelf(sports);
    expect(shelves[0].key).toBe("Football"); // NFL leads the catalog
    expect(shelves.find((s) => s.key === "Soccer")!.items.length).toBeGreaterThan(1);
    expect(shelves.flatMap((s) => s.items)).toHaveLength(sports.length);
  });

  it("puts ungrouped items under an empty key", () => {
    const shelves = groupByShelf([{ group: "A" }, {}, { group: "A" }]);
    expect(shelves.map((s) => [s.key, s.items.length])).toEqual([
      ["A", 2],
      ["", 1],
    ]);
  });

  it("hides group headers under ~8 widgets or with one group", () => {
    expect(showGroupHeaders(16, 6)).toBe(true);
    expect(showGroupHeaders(5, 3)).toBe(false);
    expect(showGroupHeaders(20, 1)).toBe(false);
  });
});

describe("closest group on a miss", () => {
  it("maps league-shaped queries to Soccer", () => {
    expect(closestGroup("Eredivisie")).toBe("Soccer");
    expect(closestGroup("Serie A")).toBe("Soccer");
    expect(closestGroup("Bundesliga")).toBe("Soccer");
  });

  it("maps other fragments to their nearest group, first hit wins", () => {
    expect(closestGroup("dogecoin")).toBe("Markets");
    expect(closestGroup("Washington Post")).toBe("World");
    expect(closestGroup("gitlab ci")).toBe("Dev");
    expect(closestGroup("zzz")).toBeUndefined();
  });

  it("title-cases the miss name", () => {
    expect(missName("  serie a ")).toBe("Serie A");
  });
});

describe("new within 30 days", () => {
  const now = new Date("2026-09-06T12:00:00Z");

  it("counts a recent date and not an old or missing one", () => {
    expect(isNew("2026-09-05", now)).toBe(true);
    expect(isNew("2026-08-10", now)).toBe(true);
    expect(isNew("2026-07-21", now)).toBe(false);
    expect(isNew(undefined, now)).toBe(false);
    expect(isNew("not a date", now)).toBe(false);
    // A date in the future is not "new", it's a typo.
    expect(isNew("2027-01-01", now)).toBe(false);
  });

  it("sorts newest first with undated last", () => {
    const sorted = byNewest([
      { id: "a", addedAt: "2026-07-02" },
      { id: "b" },
      { id: "c", addedAt: "2026-09-05" },
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});
