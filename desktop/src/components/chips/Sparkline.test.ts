import { describe, expect, it } from "vitest";
import { amplitudeFor } from "./Sparkline";

describe("amplitudeFor", () => {
  it("scales with the series' real range, so chips are comparable", () => {
    // A flat line and a wild one must not draw the same size squiggle.
    const quiet = amplitudeFor([100, 100.4, 100.2, 100.79]); // ~0.79%
    const wild = amplitudeFor([100, 103, 101, 105.12]); // ~5.12%
    expect(quiet).toBeLessThan(wild);
    expect(wild).toBe(1);
  });

  it("caps at the box height so a big move cannot escape it", () => {
    expect(amplitudeFor([100, 200])).toBe(1);
  });

  it("floors so a barely-moving symbol still draws a line", () => {
    // A true-to-scale line at this range would be a dead rule, which reads
    // as missing data rather than a calm day.
    expect(amplitudeFor([100, 100.01])).toBe(0.18);
  });

  it("does not divide by zero on a non-positive series", () => {
    expect(amplitudeFor([0, 0])).toBe(1);
    expect(Number.isFinite(amplitudeFor([-5, 5]))).toBe(true);
  });
});
