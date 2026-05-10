/**
 * Tests for the CDC merge engine behaviour that protects against the
 * 2026-04-24 finance-jitter bug class.
 *
 * The bug itself was server-side (a 30s dashboard cache that went stale
 * under CDC) — fixed by `dispatchToUser` now invalidating the cache on
 * every dispatch. These tests lock in the client-side contract that the
 * server fix depends on: an optimistic CDC merge leaves the cache in a
 * deterministic state so that a subsequent fresh refetch produces the
 * same-or-newer prices, never older.
 */
import { describe, it, expect } from "vitest";
import { mergeTableRecords } from "./useDashboardCDC";
import { CDC_TABLES } from "../cdc";
import type { Game, Trade } from "../types";

const tradesConfig = CDC_TABLES.find((c) => c.table === "trades")!;
const gamesConfig = CDC_TABLES.find((c) => c.table === "games")!;

// Minimal CDC record shape matching what the server publishes.
type CDCRecord = Parameters<typeof mergeTableRecords>[1][number];

function updateRecord(trade: Partial<Trade> & { symbol: string }): CDCRecord {
  return {
    action: "update",
    record: { price: 0, previous_close: 0, ...trade } as Record<string, unknown>,
    changes: {},
    metadata: { table_name: "trades" },
  };
}

function gameRecord(game: Partial<Game> & { id: number | string }): CDCRecord {
  return {
    action: "update",
    record: {
      league: "MLB",
      sport: "baseball",
      external_game_id: String(game.id),
      link: "",
      home_team_name: "Home",
      home_team_logo: "",
      home_team_score: 0,
      home_team_code: "HOM",
      away_team_name: "Away",
      away_team_logo: "",
      away_team_score: 0,
      away_team_code: "AWY",
      start_time: "2026-05-10T18:00:00Z",
      state: "in",
      ...game,
    } as Record<string, unknown>,
    changes: {},
    metadata: { table_name: "games" },
  };
}

describe("mergeTableRecords (trades)", () => {
  it("replaces an existing record by symbol", () => {
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.2, previous_close: 149.0 } as Trade,
    ];
    const cdc = [updateRecord({ symbol: "AAPL", price: 150.6, previous_close: 149.0 } as Partial<Trade> & { symbol: string })];

    const merged = mergeTableRecords(initial, cdc, tradesConfig) as Trade[];

    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(150.6);
  });

  it("inserts a new record when no existing entry matches", () => {
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.2 } as Trade,
    ];
    const cdc = [updateRecord({ symbol: "TSLA", price: 250.0 } as Partial<Trade> & { symbol: string })];

    const merged = mergeTableRecords(initial, cdc, tradesConfig) as Trade[];

    expect(merged).toHaveLength(2);
    expect(merged.map((t) => t.symbol).sort()).toEqual(["AAPL", "TSLA"]);
  });

  it("is idempotent when the same event is applied twice", () => {
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.2 } as Trade,
    ];
    const cdc = [updateRecord({ symbol: "AAPL", price: 150.6 } as Partial<Trade> & { symbol: string })];

    const once = mergeTableRecords(initial, cdc, tradesConfig) as Trade[];
    const twice = mergeTableRecords(once, cdc, tradesConfig) as Trade[];

    expect(twice).toHaveLength(1);
    expect(twice[0].price).toBe(150.6);
  });

  it("skips malformed records that fail validation", () => {
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.2 } as Trade,
    ];
    const malformed: CDCRecord = {
      action: "update",
      record: { price: 9999 } as Record<string, unknown>, // no `symbol` — fails config.validate
      changes: {},
      metadata: { table_name: "trades" },
    };

    const merged = mergeTableRecords(initial, [malformed], tradesConfig) as Trade[];

    expect(merged).toEqual(initial); // unchanged; the 9999 did NOT leak in
  });

  it("removes a record on delete", () => {
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.2 } as Trade,
      { symbol: "TSLA", price: 250.0 } as Trade,
    ];
    const cdc: CDCRecord[] = [{
      action: "delete",
      record: { symbol: "AAPL" } as Record<string, unknown>,
      changes: {},
      metadata: { table_name: "trades" },
    }];

    const merged = mergeTableRecords(initial, cdc, tradesConfig) as Trade[];

    expect(merged.map((t) => t.symbol)).toEqual(["TSLA"]);
  });

  it("processes a burst of events in arrival order (last write for a symbol wins)", () => {
    // This mirrors what happens during a TwelveData batch: multiple price
    // updates for the same symbol collapse to the final one. The CDC
    // pipeline delivers them in WAL order (= commit order from the
    // writer) so the merge result = the last entry in the records array.
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150.0 } as Trade,
    ];
    const burst = [
      updateRecord({ symbol: "AAPL", price: 150.2 } as Partial<Trade> & { symbol: string }),
      updateRecord({ symbol: "AAPL", price: 150.5 } as Partial<Trade> & { symbol: string }),
      updateRecord({ symbol: "AAPL", price: 150.4 } as Partial<Trade> & { symbol: string }),
      updateRecord({ symbol: "AAPL", price: 150.6 } as Partial<Trade> & { symbol: string }),
    ];

    const merged = mergeTableRecords(initial, burst, tradesConfig) as Trade[];

    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(150.6);
  });

  it("respects maxItems cap", () => {
    const cfg = { ...tradesConfig, maxItems: 2 };
    const initial: Trade[] = [
      { symbol: "AAPL", price: 150 } as Trade,
      { symbol: "TSLA", price: 250 } as Trade,
    ];
    const cdc = [updateRecord({ symbol: "MSFT", price: 420 } as Partial<Trade> & { symbol: string })];

    const merged = mergeTableRecords(initial, cdc, cfg) as Trade[];

    expect(merged).toHaveLength(2);
    expect(merged.map((t) => t.symbol)).not.toContain("AAPL"); // oldest shifted out
  });

  it("applies config.sort after mutation", () => {
    const initial: Trade[] = [
      { symbol: "TSLA", price: 250 } as Trade,
      { symbol: "AAPL", price: 150 } as Trade,
    ];
    const cdc = [updateRecord({ symbol: "MSFT", price: 420 } as Partial<Trade> & { symbol: string })];

    const merged = mergeTableRecords(initial, cdc, tradesConfig) as Trade[];

    // trades config sorts alphabetically by symbol
    expect(merged.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "TSLA"]);
  });
});

describe("mergeTableRecords (games)", () => {
  it("does not insert untracked games from global CDC updates", () => {
    const initial: Game[] = [
      { id: 3633724, league: "MLB", home_team_name: "Texas Rangers", away_team_name: "Chicago Cubs" } as Game,
    ];
    const cdc = [gameRecord({ id: 3781843, home_team_name: "Texas Rangers", away_team_name: "Chicago Cubs", state: "final" })];

    const merged = mergeTableRecords(initial, cdc, gamesConfig) as Game[];

    expect(merged.map((g) => g.id)).toEqual([3633724]);
  });
});
