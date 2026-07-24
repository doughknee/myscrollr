import { describe, it, expect } from "vitest";
import {
  sortPredictions,
  selectLens,
  isDisplayable,
  selectPredictionsForTicker,
  groupByEvent,
  groupEventsByCategory,
  priceDelta,
  formatProbability,
  formatSpread,
  isResolved,
  selectResolvedToday,
  outcomesByPrice,
  cardOutcomes,
  timeIndicator,
  TICKER_FALLBACK_LIMIT,
} from "./view";
import type { Prediction } from "../../types";
import type { PredictionsDisplayPrefs } from "../../preferences";

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

const DEFAULT_PREFS: PredictionsDisplayPrefs = {
  defaultSort: "movers",
};

// ── priceDelta ──────────────────────────────────────────────────

describe("priceDelta", () => {
  it("computes signed delta vs prev_yes_price", () => {
    expect(priceDelta(mk({ id: "A", yes_price: 62, prev_yes_price: 55 }))).toBe(7);
    expect(priceDelta(mk({ id: "B", yes_price: 40, prev_yes_price: 55 }))).toBe(-15);
  });

  it("coerces missing prev_yes_price to 0", () => {
    expect(
      priceDelta(mk({ id: "A", yes_price: 30, prev_yes_price: undefined })),
    ).toBe(30);
  });

  it("coerces missing yes_price to 0", () => {
    expect(
      priceDelta(mk({ id: "A", yes_price: undefined as unknown as number, prev_yes_price: 20 })),
    ).toBe(-20);
  });
});

// ── outcomesByPrice / cardOutcomes (B2) ─────────────────────────

describe("outcomesByPrice", () => {
  it("orders legs by implied probability, highest first", () => {
    const legs = [
      mk({ id: "low", yes_price: 10, event_rank: 1 }),
      mk({ id: "high", yes_price: 80, event_rank: 3 }),
      mk({ id: "mid", yes_price: 40, event_rank: 2 }),
    ];
    expect(outcomesByPrice(legs).map((m) => m.id)).toEqual(["high", "mid", "low"]);
  });

  it("breaks price ties by rank then ticker so order never jitters", () => {
    const legs = [
      mk({ id: "b-tick", yes_price: 50, event_rank: 2 }),
      mk({ id: "a-tick", yes_price: 50, event_rank: 2 }),
      mk({ id: "ranked", yes_price: 50, event_rank: 1 }),
    ];
    expect(outcomesByPrice(legs).map((m) => m.id)).toEqual([
      "ranked",
      "a-tick",
      "b-tick",
    ]);
    // Stable under re-sort (same input, same output).
    expect(outcomesByPrice(legs)).toEqual(outcomesByPrice(legs));
  });

  it("does not mutate its input", () => {
    const legs = [mk({ id: "a", yes_price: 1 }), mk({ id: "b", yes_price: 9 })];
    outcomesByPrice(legs);
    expect(legs.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("cardOutcomes", () => {
  it("shows the top two by price and counts the rest as extra", () => {
    const legs = [
      mk({ id: "third", yes_price: 20 }),
      mk({ id: "first", yes_price: 70 }),
      mk({ id: "fourth", yes_price: 5 }),
      mk({ id: "second", yes_price: 60 }),
    ];
    const { visible, extra } = cardOutcomes(legs);
    expect(visible.map((m) => m.id)).toEqual(["first", "second"]);
    expect(extra).toBe(2);
  });

  it("two-leg events show both with zero extra (no layout change)", () => {
    const legs = [mk({ id: "a", yes_price: 30 }), mk({ id: "b", yes_price: 70 })];
    const { visible, extra } = cardOutcomes(legs);
    expect(visible).toHaveLength(2);
    expect(extra).toBe(0);
  });

  it("single-leg events keep one visible row and zero extra", () => {
    const { visible, extra } = cardOutcomes([mk({ id: "solo", yes_price: 50 })]);
    expect(visible).toHaveLength(1);
    expect(extra).toBe(0);
  });
});

// ── timeIndicator (B3) ──────────────────────────────────────────

describe("timeIndicator", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const hours = (n: number) =>
    new Date(now + n * 3600 * 1000).toISOString();

  it("counts down to close", () => {
    const m = mk({ id: "m", close_time: hours(3) });
    expect(timeIndicator(m, now)).toEqual({ kind: "closes", label: "Closes 3h" });
  });

  it("Closed once the market's close has passed", () => {
    const m = mk({ id: "m", close_time: hours(-1) });
    expect(timeIndicator(m, now)).toEqual({ kind: "closed" });
  });

  it("resolved markets get no indicator (settlement is its own row)", () => {
    const m = mk({ id: "m", result: "yes", close_time: hours(2) });
    expect(timeIndicator(m, now)).toEqual({ kind: "none" });
  });

  it("no close_time → none", () => {
    expect(timeIndicator(mk({ id: "m", close_time: undefined }), now)).toEqual({
      kind: "none",
    });
  });
});

// ── sortPredictions ─────────────────────────────────────────────

describe("sortPredictions", () => {
  it("sorts by movers (largest absolute delta first)", () => {
    const items = [
      mk({ id: "A", yes_price: 52, prev_yes_price: 50 }), // |2|
      mk({ id: "B", yes_price: 30, prev_yes_price: 50 }), // |20|
      mk({ id: "C", yes_price: 55, prev_yes_price: 50 }), // |5|
    ];
    const result = sortPredictions(items, "movers");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sorts by trending (24h volume) descending", () => {
    const items = [
      mk({ id: "A", volume_24h: 100 }),
      mk({ id: "B", volume_24h: 900 }),
      mk({ id: "C", volume_24h: 400 }),
    ];
    const result = sortPredictions(items, "trending");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("trending falls back to all-time volume on old payloads", () => {
    const items = [
      mk({ id: "A", volume: 100 }), // no volume_24h at all
      mk({ id: "B", volume: 900 }),
      mk({ id: "C", volume_24h: 400, volume: 50 }),
    ];
    const result = sortPredictions(items, "trending");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sorts by closing (soonest close_time first)", () => {
    const items = [
      mk({ id: "A", close_time: "2026-03-01T00:00:00Z" }),
      mk({ id: "B", close_time: "2026-01-15T00:00:00Z" }),
      mk({ id: "C", close_time: "2026-02-01T00:00:00Z" }),
    ];
    const result = sortPredictions(items, "closing");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sinks markets with no close_time last under closing sort", () => {
    const items = [
      mk({ id: "A", close_time: undefined }),
      mk({ id: "B", close_time: "2026-02-01T00:00:00Z" }),
    ];
    const result = sortPredictions(items, "closing");
    expect(result.map((p) => p.id)).toEqual(["B", "A"]);
  });

  it("sorts alphabetically by title", () => {
    const items = [
      mk({ id: "1", title: "Zebra wins" }),
      mk({ id: "2", title: "Alpha wins" }),
      mk({ id: "3", title: "Mango wins" }),
    ];
    const result = sortPredictions(items, "alpha");
    expect(result.map((p) => p.title)).toEqual([
      "Alpha wins",
      "Mango wins",
      "Zebra wins",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [mk({ id: "B" }), mk({ id: "A" })];
    const snapshot = items.map((p) => p.id);
    sortPredictions(items, "alpha");
    expect(items.map((p) => p.id)).toEqual(snapshot);
  });

  it("handles null/undefined volume as 0", () => {
    const items = [
      mk({ id: "A", volume: undefined }),
      mk({ id: "B", volume: 5 }),
      mk({ id: "C", volume: undefined }),
    ];
    const result = sortPredictions(items, "trending");
    expect(result[0]!.id).toBe("B");
  });
});

// ── isDisplayable (v1.1.5 liveness guard) ───────────────────────

describe("isDisplayable", () => {
  it("passes live in-sweep markets and old payloads without the flag", () => {
    expect(isDisplayable(mk({ id: "A", in_sweep: true }))).toBe(true);
    expect(isDisplayable(mk({ id: "B" }))).toBe(true); // pre-v1.1.5 payload
  });

  it("rejects markets dropped from the sweep", () => {
    expect(isDisplayable(mk({ id: "A", in_sweep: false }))).toBe(false);
  });

  it("rejects resolved markets (they belong to Resolved today)", () => {
    expect(isDisplayable(mk({ id: "A", status: "settled" }))).toBe(false);
    expect(isDisplayable(mk({ id: "B", result: "yes" }))).toBe(false);
  });
});

// ── selectLens (v1.1.5 feed lenses) ─────────────────────────────

describe("selectLens", () => {
  function makeItems(): Prediction[] {
    return [
      mk({ id: "hot", volume_24h: 900, yes_price: 50, prev_yes_price: 50 }),
      mk({ id: "mover", volume_24h: 100, yes_price: 70, prev_yes_price: 50, close_time: "2026-03-01T00:00:00Z" }),
      mk({ id: "closing", volume_24h: 200, yes_price: 50, prev_yes_price: 50, close_time: "2026-01-15T00:00:00Z" }),
      mk({ id: "dead", volume_24h: 9999, in_sweep: false }),
      mk({ id: "settled", volume_24h: 8888, status: "settled", result: "yes" }),
    ];
  }

  it("trending: live markets only, hottest first", () => {
    const out = selectLens(makeItems(), "trending", new Set());
    expect(out.map((p) => p.id)).toEqual(["hot", "closing", "mover"]);
  });

  it("movers: only markets that moved, biggest move first", () => {
    const out = selectLens(makeItems(), "movers", new Set());
    expect(out.map((p) => p.id)).toEqual(["mover"]);
  });

  it("closing: only future-closing markets, soonest first", () => {
    const out = selectLens(makeItems(), "closing", new Set());
    expect(out.map((p) => p.id)).toEqual(["closing", "mover"]);
  });

  it("watchlist: starred only; resolved stars stay, dropped stars leave", () => {
    const out = selectLens(
      makeItems(),
      "watchlist",
      new Set(["hot", "dead", "settled"]),
    );
    // "dead" (dropped, unresolved) is excluded; "settled" star kept for closure.
    expect(out.map((p) => p.id).sort()).toEqual(["hot", "settled"]);
  });

  it("resolved: trailing-24h settlements only, anchored to `now`", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      mk({ id: "live" }),
      mk({ id: "fresh", status: "settled", settled_at: "2026-06-26T09:00:00Z" }),
      mk({ id: "stale", status: "settled", settled_at: "2026-06-20T00:00:00Z" }),
    ];
    const out = selectLens(items, "resolved", new Set(), now);
    expect(out.map((p) => p.id)).toEqual(["fresh"]);
  });
});

// ── groupEventsByCategory (v1.1.5 browse sections) ──────────────

describe("groupEventsByCategory", () => {
  it("stable-groups events into sections ordered by summed 24h volume", () => {
    const events = groupByEvent([
      mk({ id: "s1", event_ticker: "S1", category: "Sports", volume_24h: 100 }),
      mk({ id: "p1", event_ticker: "P1", category: "Politics", volume_24h: 900 }),
      mk({ id: "s2", event_ticker: "S2", category: "Sports", volume_24h: 300 }),
      mk({ id: "x1", event_ticker: "X1", volume_24h: 50 }), // no category
    ]);
    const sections = groupEventsByCategory(events);
    expect(sections.map((s) => s.category)).toEqual([
      "Politics", // 900
      "Sports",   // 400
      "Other",    // 50
    ]);
    // Events preserve input (lens-sorted) order within their section.
    expect(sections[1].events.map((e) => e.eventTicker)).toEqual(["S1", "S2"]);
    expect(sections[0].volume24h).toBe(900);
    expect(sections[1].volume24h).toBe(400);
  });
});

// ── selectPredictionsForTicker ──────────────────────────────────

describe("selectPredictionsForTicker", () => {
  it("applies defaultSort=movers from prefs", () => {
    const items = [
      mk({ id: "A", yes_price: 52, prev_yes_price: 50 }),
      mk({ id: "B", yes_price: 30, prev_yes_price: 50 }),
      mk({ id: "C", yes_price: 55, prev_yes_price: 50 }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "movers",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("applies defaultSort=trending from prefs", () => {
    const items = [
      mk({ id: "A", volume_24h: 10 }),
      mk({ id: "B", volume_24h: 30 }),
      mk({ id: "C", volume_24h: 20 }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "trending",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("excludes dropped and resolved markets from the fallback rail", () => {
    const items = [
      mk({ id: "live", volume_24h: 10 }),
      mk({ id: "dead", volume_24h: 999, in_sweep: false }),
      mk({ id: "settled", volume_24h: 500, status: "finalized" }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "trending",
    });
    expect(result.map((p) => p.id)).toEqual(["live"]);
  });

  it("applies defaultSort=alpha from prefs", () => {
    const items = [
      mk({ id: "3", title: "C" }),
      mk({ id: "1", title: "A" }),
      mk({ id: "2", title: "B" }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "alpha",
    });
    expect(result.map((p) => p.title)).toEqual(["A", "B", "C"]);
  });

  it("applies defaultSort=closing from prefs", () => {
    const items = [
      mk({ id: "A", close_time: "2026-06-01T00:00:00Z" }),
      mk({ id: "B", close_time: "2026-01-01T00:00:00Z" }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "closing",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "A"]);
  });
});

// ── Display formatting ──────────────────────────────────────────

describe("formatProbability", () => {
  it("rounds and clamps to 0–100", () => {
    expect(formatProbability(62)).toBe("62%");
    expect(formatProbability(61.6)).toBe("62%");
    expect(formatProbability(-5)).toBe("0%");
    expect(formatProbability(140)).toBe("100%");
    expect(formatProbability(undefined)).toBe("0%");
  });
});

describe("formatSpread", () => {
  it("renders both sides, one side, or nothing", () => {
    expect(formatSpread(61, 63)).toBe("61–63¢");
    expect(formatSpread(61, undefined)).toBe("61¢");
    expect(formatSpread(undefined, 63)).toBe("63¢");
    expect(formatSpread(undefined, undefined)).toBe("");
    expect(formatSpread(null, null)).toBe("");
  });
});

// ── Resolved Today ──────────────────────────────────────────────

describe("isResolved / selectResolvedToday", () => {
  it("treats settlement statuses and yes/no results as resolved", () => {
    expect(isResolved(mk({ id: "A", status: "settled" }))).toBe(true);
    expect(isResolved(mk({ id: "B", status: "determined" }))).toBe(true);
    expect(isResolved(mk({ id: "C", status: "active", result: "yes" }))).toBe(true);
    expect(isResolved(mk({ id: "D", status: "active", result: "" }))).toBe(false);
    expect(isResolved(mk({ id: "E", status: "active" }))).toBe(false);
  });

  it("returns resolved markets within the window, most-recent first", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      mk({ id: "old", status: "settled", updated_at: "2026-06-20T00:00:00Z" }), // >24h
      mk({ id: "recent", status: "settled", result: "yes", updated_at: "2026-06-26T06:00:00Z" }),
      mk({ id: "newest", status: "determined", updated_at: "2026-06-26T11:00:00Z" }),
      mk({ id: "active", status: "active", updated_at: "2026-06-26T10:00:00Z" }), // not resolved
    ];
    const result = selectResolvedToday(items, now);
    expect(result.map((p) => p.id)).toEqual(["newest", "recent"]);
  });

  it("ignores future-dated timestamps (clock skew)", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      mk({ id: "future", status: "settled", updated_at: "2026-06-26T18:00:00Z" }),
    ];
    expect(selectResolvedToday(items, now)).toHaveLength(0);
  });

  it("prefers settled_at over updated_at (v1.1.5)", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      // Settled long ago but its row was touched recently (sweep write /
      // demotion) — settled_at keeps it OUT of "today".
      mk({
        id: "old-touch",
        status: "settled",
        settled_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-26T11:00:00Z",
      }),
      // Settled recently; updated_at stale — settled_at keeps it IN.
      mk({
        id: "fresh",
        status: "settled",
        settled_at: "2026-06-26T09:00:00Z",
        updated_at: "2026-06-20T00:00:00Z",
      }),
    ];
    expect(selectResolvedToday(items, now).map((p) => p.id)).toEqual(["fresh"]);
  });
});

// ── Ticker scoping (v1.1.4: watchlist-first, top-N fallback) ────

describe("selectPredictionsForTicker scoping", () => {
  it("shows only watched markets when the watchlist has any — any rank", () => {
    const items = [
      mk({ id: "A", event_rank: 1, volume: 100 }),
      mk({ id: "B", event_rank: 2, volume: 90 }),
      mk({ id: "C", event_rank: 1, volume: 80 }),
    ];
    const out = selectPredictionsForTicker(
      items,
      { ...DEFAULT_PREFS, defaultSort: "trending" },
      new Set(["B"]),
    );
    expect(out.map((p) => p.id)).toEqual(["B"]);
  });

  it("drops a dropped-unresolved star but keeps a resolved one (v1.1.5)", () => {
    const items = [
      mk({ id: "gone", in_sweep: false }),
      mk({ id: "done", in_sweep: false, status: "settled", result: "no" }),
      mk({ id: "live" }),
    ];
    const out = selectPredictionsForTicker(
      items,
      { ...DEFAULT_PREFS, defaultSort: "trending" },
      new Set(["gone", "done", "live"]),
    );
    expect(out.map((p) => p.id).sort()).toEqual(["done", "live"]);
  });

  it("falls back to the top rank-1 legs, capped, when nothing is starred", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      mk({
        id: `T${String(i).padStart(2, "0")}`,
        event_rank: i % 2 === 0 ? 1 : 2,
        volume: 1000 - i,
      }),
    );
    const out = selectPredictionsForTicker(
      items,
      { ...DEFAULT_PREFS, defaultSort: "trending" },
      new Set(),
    );
    expect(out.length).toBe(TICKER_FALLBACK_LIMIT);
    expect(out.every((p) => (p.event_rank ?? 1) === 1)).toBe(true);
    expect(out[0].id).toBe("T00"); // highest volume first
  });

  it("treats missing event_rank as rank 1 (pre-backfill rows)", () => {
    const items = [mk({ id: "LEGACY", volume: 5 })];
    const out = selectPredictionsForTicker(
      items,
      { ...DEFAULT_PREFS, defaultSort: "trending" },
      new Set(),
    );
    expect(out.map((p) => p.id)).toEqual(["LEGACY"]);
  });
});

// ── Event grouping (v1.1.4 Kalshi-style cards) ──────────────────

describe("groupByEvent", () => {
  it("folds legs into their event, rank-ordered, volume summed", () => {
    const items = [
      mk({
        id: "WC-FR",
        event_ticker: "WC",
        event_title: "FIFA World Cup Winner",
        event_rank: 1,
        title: "France",
        volume: 300,
      }),
      mk({ id: "SOLO", title: "Yes", volume: 50 }),
      mk({
        id: "WC-AR",
        event_ticker: "WC",
        event_title: "FIFA World Cup Winner",
        event_rank: 2,
        title: "Argentina",
        volume: 200,
      }),
    ];
    const events = groupByEvent(items);
    expect(events).toHaveLength(2);

    const wc = events.find((e) => e.eventTicker === "WC")!;
    expect(wc.title).toBe("FIFA World Cup Winner");
    expect(wc.outcomes.map((o) => o.title)).toEqual(["France", "Argentina"]);
    expect(wc.volume).toBe(500);
    // volume24h falls back to all-time volume per leg (no volume_24h set).
    expect(wc.volume24h).toBe(500);
  });

  it("preserves the input ordering by each event's lead leg", () => {
    const items = [
      mk({ id: "B1", event_ticker: "B", event_rank: 1, volume: 900 }),
      mk({ id: "A1", event_ticker: "A", event_rank: 1, volume: 800 }),
      mk({ id: "B2", event_ticker: "B", event_rank: 2, volume: 700 }),
    ];
    expect(groupByEvent(items).map((e) => e.eventTicker)).toEqual(["B", "A"]);
  });

  it("falls back to the leg title for pre-backfill rows without event_title", () => {
    const items = [mk({ id: "OLD", event_ticker: "EV-OLD", title: "Atlanta" })];
    expect(groupByEvent(items)[0].title).toBe("Atlanta");
  });

  it("keys markets without an event_ticker by their own ticker", () => {
    const items = [mk({ id: "LONE", title: "Yes" })];
    expect(groupByEvent(items)[0].eventTicker).toBe("LONE");
  });
});
