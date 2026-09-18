import { test, expect } from "@playwright/test";
import { openShim } from "./shim";
import pre from "../../src/dev/__fixtures__/dashboard.width-pre.json" with { type: "json" };

// Deterministic: layout, not timing.
test.describe.configure({ retries: 0 });

/**
 * CHIP_SPEC §1.2: a chip's width settles on first render and never moves.
 * The three width-* fixtures hold the same game before first pitch, in
 * the 7th with single-digit scores, and final with two-digit scores; the
 * chip must measure the same in all three.
 */
test("a game chip is the same width before, during and after the game", async ({ page }) => {
  const game = pre.data.sports[0];
  const widths: Record<string, number> = {};
  for (const state of ["pre", "live", "final"]) {
    await openShim(page, `?fixture=width-${state}`);
    // The original, not motion-plus's clone: same node either way, but
    // pin it so a future clone-first DOM order cannot change what is read.
    const chip = page.locator(".ticker-item [data-chip]").filter({ hasText: /Reds/ }).first();
    await expect(chip).toContainText(/Cubs/);
    widths[state] = (await chip.boundingBox())!.width;
  }
  // boundingBox carries sub-pixel noise from the moving transform (~1e-4 px);
  // a real resize from a score digit is several px. Compare to 0.01 px.
  expect(widths.pre, `game ${game.id}: ${JSON.stringify(widths)}`).toBeGreaterThan(0);
  expect(widths.live, JSON.stringify(widths)).toBeCloseTo(widths.pre, 2);
  expect(widths.final, JSON.stringify(widths)).toBeCloseTo(widths.pre, 2);
});
