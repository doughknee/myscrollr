import { test, expect } from "@playwright/test";
import { FIXTURES, measureLapMs, openShim } from "./shim";
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

const SPEED = 80;

/** Width and text of every original rotating slot, keyed by slot. */
function slots(page: Parameters<typeof openShim>[0]) {
  return page.$$eval(".ticker-item [data-rotate-slot]", (els) =>
    Object.fromEntries(
      els.map((el) => [
        el.getAttribute("data-rotate-slot")!,
        { width: el.getBoundingClientRect().width, text: el.textContent ?? "" },
      ]),
    ),
  );
}

/**
 * CHIP_SPEC §4 / §8.1: a rotating slot reserves the widest content of its
 * class, so when it advances to the next game or headline the chip does
 * not resize -- "a short name sharing a slot with a long one carries the
 * long one's width". Static pool (no perturbation: a changed pool may
 * legitimately re-reserve), one lap so every slot has taken a turn.
 */
for (const fixture of FIXTURES) {
  test(`[${fixture}] a rotating slot keeps its width across a turn`, async ({ page }) => {
    // SCROLLR-229: on the fifty-game Saturday a slot whose reserved width
    // passes 640 px latches the cap, releases its score and status
    // reservations, lands UNDER the cap (618 px) and then moves 41 px when
    // it turns to a game with no score. Expected to fail until the chip
    // pins its width at the cap; Playwright reports "unexpectedly passed"
    // when it does, and this marker comes off.
    if (fixture === "busy") test.fail();
    await openShim(page, `?fixture=${fixture}&speed=${SPEED}`);
    const lapMs = await measureLapMs(page, SPEED);
    test.setTimeout(lapMs * 1.5 + 60_000);

    const before = await slots(page);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    await page.waitForTimeout(lapMs * 1.25);
    const after = await slots(page);

    const turned = Object.keys(before).filter((k) => after[k] && after[k].text !== before[k].text);
    expect(turned, "no slot changed content in a lap — nothing was tested").not.toEqual([]);
    for (const k of Object.keys(before)) {
      if (!after[k]) continue; // a slot whose class emptied renders nothing
      expect(after[k].width, `${k}: "${before[k].text}" → "${after[k].text}"`).toBeCloseTo(before[k].width, 2);
    }
  });
}
