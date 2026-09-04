import { describe, expect, it } from "vitest";
import { rangePosition } from "./DayRangeRail";

describe("rangePosition", () => {
  it("places the price proportionally inside the range", () => {
    expect(rangePosition(325.03, 323.54, 328.36)).toBeCloseTo(30.9, 1);
    expect(rangePosition(150, 100, 200)).toBe(50);
  });

  it("pins the ends exactly", () => {
    expect(rangePosition(100, 100, 200)).toBe(0);
    expect(rangePosition(200, 100, 200)).toBe(100);
  });

  it("clamps a print that lands outside the stored range", () => {
    // The range is seeded from a daily quote and widened by live ticks, so a
    // price can briefly sit outside it. A marker off the end of the track
    // reads as a rendering bug.
    expect(rangePosition(250, 100, 200)).toBe(100);
    expect(rangePosition(50, 100, 200)).toBe(0);
  });

  it("returns null when there is no usable range", () => {
    // Rendering must fall back to an empty track, never divide by zero and
    // never collapse the row — these chips sit in a marquee where a height
    // change reflows the whole rail.
    expect(rangePosition(150)).toBeNull();
    expect(rangePosition(150, 0, 0)).toBeNull();
    expect(rangePosition(150, 200, 100)).toBeNull(); // inverted
    expect(rangePosition(150, 100, 100)).toBeNull(); // zero width
    expect(rangePosition(150, -5, 200)).toBeNull();
  });

  it("returns null for an unusable price rather than NaN", () => {
    expect(rangePosition(Number.NaN, 100, 200)).toBeNull();
  });
});
