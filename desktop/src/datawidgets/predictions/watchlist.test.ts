import { describe, it, expect } from "vitest";
import {
  withToggled,
  withAlertAdded,
  withAlertRemoved,
  withAlertPatched,
  crossed,
  evaluateAlerts,
  describeAlert,
  type PredictionAlert,
} from "./watchlist";

function alert(overrides: Partial<PredictionAlert> = {}): PredictionAlert {
  return {
    id: "1",
    ticker: "MKT",
    label: "Market",
    comparator: "above",
    threshold: 50,
    enabled: true,
    ...overrides,
  };
}

describe("watchlist (pure)", () => {
  it("toggles membership", () => {
    expect(withToggled([], "A")).toEqual(["A"]);
    expect(withToggled(["A", "B"], "A")).toEqual(["B"]);
  });
});

describe("alert list ops (pure)", () => {
  it("adds, removes, and patches by id", () => {
    const a = alert({ id: "1" });
    const b = alert({ id: "2", ticker: "X" });
    let list = withAlertAdded([], a);
    list = withAlertAdded(list, b);
    expect(list.map((x) => x.id)).toEqual(["1", "2"]);

    list = withAlertPatched(list, "1", { enabled: false });
    expect(list.find((x) => x.id === "1")!.enabled).toBe(false);
    expect(list.find((x) => x.id === "2")!.enabled).toBe(true);

    list = withAlertRemoved(list, "1");
    expect(list.map((x) => x.id)).toEqual(["2"]);
  });
});

describe("crossed (edge-triggered)", () => {
  it("fires only on the crossing tick — above", () => {
    expect(crossed("above", 50, 48, 51)).toBe(true); // crossed up
    expect(crossed("above", 50, 51, 52)).toBe(false); // already above
    expect(crossed("above", 50, 49, 49)).toBe(false); // still below
    expect(crossed("above", 50, undefined, 80)).toBe(false); // first observation
    expect(crossed("above", 50, 50, 51)).toBe(false); // prev already at/above the line — no new crossing
    expect(crossed("above", 50, 49, 50)).toBe(true); // 49→50 crosses up to the line
  });

  it("fires only on the crossing tick — below", () => {
    expect(crossed("below", 50, 52, 49)).toBe(true);
    expect(crossed("below", 50, 48, 47)).toBe(false);
    expect(crossed("below", 50, 60, 61)).toBe(false);
  });
});

describe("evaluateAlerts", () => {
  const prices = new Map([
    ["A", 51],
    ["B", 30],
  ]);
  const prev = new Map([
    ["A", 48],
    ["B", 33],
  ]);

  it("returns only alerts that crossed this tick", () => {
    const alerts = [
      alert({ id: "a", ticker: "A", comparator: "above", threshold: 50 }), // 48→51 fires
      alert({ id: "b", ticker: "B", comparator: "below", threshold: 50 }), // 33→30 already below, no fire
      alert({ id: "c", ticker: "A", comparator: "above", threshold: 50, enabled: false }), // disabled
    ];
    const triggers = evaluateAlerts(alerts, prices, prev);
    expect(triggers.map((t) => t.alert.id)).toEqual(["a"]);
    expect(triggers[0]!.price).toBe(51);
  });

  it("skips markets with no current price", () => {
    const alerts = [alert({ id: "z", ticker: "MISSING" })];
    expect(evaluateAlerts(alerts, prices, prev)).toHaveLength(0);
  });
});

describe("describeAlert", () => {
  it("renders a human label", () => {
    expect(describeAlert(alert({ comparator: "above", threshold: 50 }))).toBe("Above 50%");
    expect(describeAlert(alert({ comparator: "below", threshold: 25 }))).toBe("Below 25%");
  });
});
