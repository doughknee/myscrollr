import { describe, it, expect } from "vitest";
import {
  editDistance,
  matchToken,
  mergeRanges,
  tokenize,
  matchEvent,
  searchEvents,
  outcomeLabel,
} from "./search";
import { groupByEvent } from "./view";
import type { Prediction } from "../../types";

// ── Fixtures ────────────────────────────────────────────────────

function mk(partial: Partial<Prediction> & { id: string }): Prediction {
  return {
    source: "kalshi",
    ticker: partial.id,
    title: partial.id,
    yes_price: 50,
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

/** A small universe: binary politics event, multi-outcome sports event,
 *  economics event with a subtitle leg. */
const MARKETS: Prediction[] = [
  mk({
    id: "kalshi:GOVSHUT-26",
    event_ticker: "GOVSHUT",
    event_title: "Government shutdown before August?",
    title: "Yes",
    category: "Politics",
  }),
  mk({
    id: "kalshi:NBA-ATL",
    event_ticker: "NBACHAMP",
    event_title: "NBA Champion 2027?",
    title: "Atlanta",
    category: "Sports",
    event_rank: 1,
  }),
  mk({
    id: "kalshi:NBA-OKC",
    event_ticker: "NBACHAMP",
    event_title: "NBA Champion 2027?",
    title: "Oklahoma City",
    category: "Sports",
    event_rank: 2,
  }),
  mk({
    id: "kalshi:FED-DEC",
    event_ticker: "FEDCUT",
    event_title: "Fed rate cut in December?",
    title: "Yes",
    subtitle: "25bps or more",
    category: "Economics",
  }),
];

function events() {
  return groupByEvent(MARKETS);
}

const catOf = (ev: { category?: string }) => ev.category;

function hitTickers(query: string): string[] {
  const hits = searchEvents(query, events(), catOf);
  return hits ? [...hits.keys()] : [];
}

// ── editDistance ────────────────────────────────────────────────

describe("editDistance", () => {
  it("is 0 for identical strings", () => {
    expect(editDistance("trump", "trump", 2)).toBe(0);
  });

  it("counts substitution, insertion, deletion as 1", () => {
    expect(editDistance("goverment", "government", 2)).toBe(1); // insertion
    expect(editDistance("shutdwon", "shutdown", 2)).toBe(1); // transposition
    expect(editDistance("fedd", "fed", 2)).toBe(1); // deletion
    expect(editDistance("chanpion", "champion", 2)).toBe(1); // substitution
  });

  it("counts adjacent transposition as a single edit (OSA)", () => {
    expect(editDistance("bidne", "biden", 1)).toBe(1);
  });

  it("returns cap+1 when the distance exceeds the cap", () => {
    expect(editDistance("zebra", "politics", 1)).toBe(2);
    expect(editDistance("abc", "xyz", 2)).toBe(3);
  });
});

// ── matchToken ──────────────────────────────────────────────────

describe("matchToken", () => {
  it("finds exact substrings with the correct range", () => {
    expect(matchToken("champion", "NBA Champion 2027?")).toEqual([[4, 12]]);
  });

  it("is case-insensitive over the text (token is pre-lowercased)", () => {
    expect(matchToken("nba", "NBA Champion 2027?")).toEqual([[0, 3]]);
  });

  it("matches prefixes via substring", () => {
    expect(matchToken("champ", "NBA Champion 2027?")).toEqual([[4, 9]]);
  });

  it("tolerates one typo in medium tokens", () => {
    expect(matchToken("goverment", "Government shutdown?")).toEqual([[0, 10]]);
  });

  it("tolerates a typo'd prefix of a longer word", () => {
    // "presedent" (9, budget 2) vs "presidential": the whole word is too
    // long (length gap 3) but its 9-char prefix "president" is 1 edit away.
    expect(matchToken("presedent", "Presidential election 2028")).toEqual([
      [0, 9],
    ]);
  });

  it("requires exact match for short tokens", () => {
    expect(matchToken("fde", "Fed rate cut?")).toBeNull();
    expect(matchToken("fed", "Fed rate cut?")).toEqual([[0, 3]]);
  });

  it("returns null when nothing matches", () => {
    expect(matchToken("zebra", "Government shutdown?")).toBeNull();
  });
});

// ── mergeRanges ─────────────────────────────────────────────────

describe("mergeRanges", () => {
  it("merges overlapping and touching ranges and sorts", () => {
    expect(
      mergeRanges([
        [5, 9],
        [0, 3],
        [8, 12],
        [3, 4],
      ]),
    ).toEqual([
      [0, 4],
      [5, 12],
    ]);
  });

  it("passes disjoint ranges through sorted", () => {
    expect(
      mergeRanges([
        [10, 12],
        [0, 2],
      ]),
    ).toEqual([
      [0, 2],
      [10, 12],
    ]);
  });
});

// ── outcomeLabel ────────────────────────────────────────────────

describe("outcomeLabel", () => {
  it("uses the leg title for multi-outcome legs", () => {
    expect(outcomeLabel(mk({ id: "x", title: "Atlanta" }))).toBe("Atlanta");
  });

  it("normalizes yes-legs (any case, or empty) to 'Yes'", () => {
    expect(outcomeLabel(mk({ id: "x", title: "YES" }))).toBe("Yes");
    expect(outcomeLabel(mk({ id: "x", title: "" }))).toBe("Yes");
  });
});

// ── matchEvent / searchEvents ───────────────────────────────────

describe("searchEvents", () => {
  it("matches exact words in the event title", () => {
    expect(hitTickers("shutdown")).toEqual(["GOVSHUT"]);
  });

  it("is case-insensitive", () => {
    expect(hitTickers("SHUTDOWN")).toEqual(["GOVSHUT"]);
    expect(hitTickers("nba")).toEqual(["NBACHAMP"]);
  });

  it("matches with a typo (fuzzy)", () => {
    expect(hitTickers("shutdwon")).toEqual(["GOVSHUT"]); // transposition
    expect(hitTickers("goverment")).toEqual(["GOVSHUT"]); // missing letter
  });

  it("matches the category", () => {
    expect(hitTickers("politics")).toEqual(["GOVSHUT"]);
    expect(hitTickers("sports")).toEqual(["NBACHAMP"]);
  });

  it("matches outcome names", () => {
    expect(hitTickers("atlanta")).toEqual(["NBACHAMP"]);
    expect(hitTickers("oklahoma")).toEqual(["NBACHAMP"]);
  });

  it("matches outcome subtitles (no highlight ranges required)", () => {
    expect(hitTickers("25bps")).toEqual(["FEDCUT"]);
  });

  it("ANDs multiple tokens across fields", () => {
    // "champion" (title) + "atlanta" (outcome) both hit NBACHAMP.
    expect(hitTickers("champion atlanta")).toEqual(["NBACHAMP"]);
    // Both tokens match SOME event, but no single event has both.
    expect(hitTickers("shutdown atlanta")).toEqual([]);
  });

  it("returns no hits for garbage queries", () => {
    expect(hitTickers("zzzzqqq")).toEqual([]);
  });

  it("returns null (search inactive) for empty/whitespace queries", () => {
    expect(searchEvents("", events(), catOf)).toBeNull();
    expect(searchEvents("   ", events(), catOf)).toBeNull();
  });

  it("preserves input (browse) order — filter, never re-rank", () => {
    expect(hitTickers("yes")).toEqual(["GOVSHUT", "FEDCUT"]);
  });

  it("reports highlight ranges for title, category, and outcomes", () => {
    const hit = matchEvent(
      tokenize("champion atlanta"),
      events().find((e) => e.eventTicker === "NBACHAMP")!,
      "Sports",
    );
    expect(hit).not.toBeNull();
    expect(hit!.titleRanges).toEqual([[4, 12]]);
    expect(hit!.outcomeRanges["kalshi:NBA-ATL"]).toEqual([[0, 7]]);
  });

  it("highlights the category when it matched", () => {
    const hit = matchEvent(
      tokenize("economics"),
      events().find((e) => e.eventTicker === "FEDCUT")!,
      "Economics",
    );
    expect(hit).not.toBeNull();
    expect(hit!.categoryRanges).toEqual([[0, 9]]);
  });
});
