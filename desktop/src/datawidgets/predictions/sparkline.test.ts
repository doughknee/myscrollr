import { describe, it, expect } from "vitest";
import {
  pushCapped,
  sparklinePoints,
  trend,
  recordPrice,
  getHistory,
  resetHistory,
} from "./sparkline";

describe("pushCapped", () => {
  it("appends without exceeding the cap, dropping oldest", () => {
    let arr: number[] = [];
    for (let i = 1; i <= 5; i++) arr = pushCapped(arr, i, 3);
    expect(arr).toEqual([3, 4, 5]);
  });

  it("does not mutate the input", () => {
    const arr = [1, 2];
    const out = pushCapped(arr, 3, 5);
    expect(arr).toEqual([1, 2]);
    expect(out).toEqual([1, 2, 3]);
  });
});

describe("trend", () => {
  it("classifies direction first→last", () => {
    expect(trend([1, 2, 3])).toBe("up");
    expect(trend([3, 1])).toBe("down");
    expect(trend([5, 9, 5])).toBe("flat");
    expect(trend([7])).toBe("flat");
    expect(trend([])).toBe("flat");
  });
});

describe("sparklinePoints", () => {
  it("returns empty for no data", () => {
    expect(sparklinePoints([], { width: 100, height: 20 })).toBe("");
  });

  it("centers a single point as a horizontal line", () => {
    expect(sparklinePoints([42], { width: 100, height: 20, pad: 0 })).toBe("0,10.00 100,10.00");
  });

  it("maps endpoints to corners for a rising series (y inverted)", () => {
    const pts = sparklinePoints([0, 100], { width: 10, height: 10, pad: 0 }).split(" ");
    // first point: x=0, value 0 → bottom (y=10); last: x=10, value 100 → top (y=0)
    expect(pts[0]).toBe("0.00,10.00");
    expect(pts[1]).toBe("10.00,0.00");
  });

  it("draws a flat line when all values are equal", () => {
    const pts = sparklinePoints([50, 50, 50], { width: 8, height: 10, pad: 0 }).split(" ");
    expect(pts.every((p) => p.endsWith(",5.00"))).toBe(true);
  });

  it("respects an explicit min/max range", () => {
    // value 50 within 0..100 → middle
    const pts = sparklinePoints([50, 50], { width: 4, height: 10, pad: 0, min: 0, max: 100 }).split(" ");
    expect(pts[0]).toBe("0.00,5.00");
  });
});

describe("rolling history", () => {
  it("records changes and dedups consecutive equal samples", () => {
    resetHistory();
    recordPrice("T", 50);
    recordPrice("T", 50); // dedup
    recordPrice("T", 52);
    recordPrice("T", undefined);
    recordPrice("T", 51);
    expect(getHistory("T")).toEqual([50, 52, 51]);
    expect(getHistory("OTHER")).toEqual([]);
  });
});
