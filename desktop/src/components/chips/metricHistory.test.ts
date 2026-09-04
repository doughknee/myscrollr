/**
 * The sysmon buffer's one job: turn a stream of instants into a series
 * that is honest about time. Repeats are kept (a flat CPU is real), so
 * the guard against re-renders is the clock rather than deduplication —
 * which is the part with the arithmetic and the part worth testing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordMetric, __resetMetricHistory } from "./metricHistory";

beforeEach(() => __resetMetricHistory());

describe("recordMetric", () => {
  it("keeps a flat run rather than collapsing it", () => {
    let t = 0;
    for (let i = 0; i < 4; i++) recordMetric("cpu", 47, (t += 1000));
    // Four seconds at 47% is four seconds of history, not one point.
    expect(recordMetric("cpu", 47, (t += 1000))).toEqual([47, 47, 47, 47, 47]);
  });

  it("ignores a second reading inside the same tick", () => {
    recordMetric("cpu", 47, 1000);
    // A re-render, a StrictMode double-invoke, the rail re-bucketing.
    recordMetric("cpu", 47, 1100);
    expect(recordMetric("cpu", 47, 1400)).toEqual([47]);
    expect(recordMetric("cpu", 48, 2000)).toEqual([47, 48]);
  });

  it("keeps the most recent readings once full", () => {
    let t = 0;
    let series: number[] = [];
    for (let i = 0; i < 40; i++) series = recordMetric("cpu", i, (t += 1000));
    expect(series).toHaveLength(32);
    expect(series[series.length - 1]).toBe(39);
    expect(series[0]).toBe(8);
  });

  it("tracks metrics separately", () => {
    recordMetric("cpu", 10, 1000);
    recordMetric("gpu", 90, 1000);
    expect(recordMetric("cpu", 11, 2000)).toEqual([10, 11]);
    expect(recordMetric("gpu", 91, 2000)).toEqual([90, 91]);
  });

  it("refuses a reading that is not a number", () => {
    recordMetric("cpu", 10, 1000);
    expect(recordMetric("cpu", NaN, 2000)).toEqual([10]);
    expect(recordMetric("cpu", Infinity, 3000)).toEqual([10]);
  });

  it("evicts the least recently touched metric past the cap", () => {
    let t = 0;
    for (let i = 0; i < 40; i++) recordMetric(`m${i}`, 1, (t += 1000));
    recordMetric("m1", 2, (t += 1000)); // touch m1 so m0 is now oldest
    recordMetric("new", 1, (t += 1000)); // 41st key, evicts m0
    expect(recordMetric("m0", 9, (t += 1000))).toEqual([9]); // started over
    expect(recordMetric("m1", 3, (t += 1000))).toEqual([1, 2, 3]); // survived
  });
});
