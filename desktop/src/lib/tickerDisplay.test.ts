import { describe, expect, it } from "vitest";
import { displayGeometry, sanitizeDisplays } from "./tickerDisplay";
import { displayGrid } from "../components/pages/pagePlan";

describe("dedicated display geometry", () => {
  for (const [width, height] of [
    [1920, 360],
    [1920, 1080],
    [1080, 1920],
    [3840, 2160],
    [1366, 768],
    [800, 480],
    [320, 180],
  ]) {
    for (const reading of [100, 125, 150]) {
      it(`${width}x${height} at ${reading}% keeps the shared cell reservations inside the canvas`, () => {
        const g = displayGeometry(width, height, "grid", reading);
        const shape = displayGrid(g.width, g.height, 264);
        expect(g.grid).toBe(true);
        expect(g.width * g.scale).toBeCloseTo(width);
        expect(g.height * g.scale).toBeCloseTo(height);
        expect(g.width / shape.columns).toBeGreaterThanOrEqual(264);
        for (const footer of [0, 64]) {
          const withPins = displayGrid(g.width, g.height, 264, footer);
          expect(
            (g.height - 48 - footer) / withPins.rows,
          ).toBeGreaterThanOrEqual(160 - 0.001);
        }
        const strip = displayGeometry(width, height, "strip", reading);
        expect(strip.grid).toBe(false);
        expect(strip.width).toBeGreaterThanOrEqual(780 - 0.001);
        expect(64 * strip.scale).toBeLessThanOrEqual(height);
      });
    }
  }
  it("uses a full row on a strip, several columns on landscape, and fewer columns on portrait", () => {
    const shape = (w: number, h: number) => {
      const g = displayGeometry(w, h, "grid");
      return displayGrid(g.width, g.height, 264);
    };
    expect(shape(1920, 360)).toMatchObject({ rows: 1 });
    expect(shape(1920, 1080).columns).toBeGreaterThan(
      shape(1080, 1920).columns,
    );
    expect(shape(1920, 1080).rows).toBeGreaterThan(1);
    expect(shape(1080, 1920).rows).toBeGreaterThan(1);
  });
});

it("old or corrupt preferences cannot enable fullscreen accidentally", () => {
  expect(sanitizeDisplays(undefined)).toEqual({});
  expect(sanitizeDisplays([])).toEqual({});
  expect(
    sanitizeDisplays({
      bad: { mode: "auto" },
      null: null,
      screen: { mode: "grid", readingSize: 999 },
    }),
  ).toEqual({ screen: { mode: "grid", readingSize: 100 } });
  expect(
    sanitizeDisplays({ screen: { mode: "strip", readingSize: 125 } }),
  ).toEqual({ screen: { mode: "strip", readingSize: 125 } });
});
