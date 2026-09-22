import { test, expect } from "@playwright/test";

import { openShim } from "./shim";

/**
 * The fixed zone, end to end (SCROLLR-9).
 *
 * `dashboard.pinned-far.json` is the shape a pinned subject has once the
 * server guarantees its row: the Brewers are in the payload, but their
 * only fixture is nine days out, so every horizon the tape applies
 * excludes them. What the pin is for is rendering it anyway.
 *
 * The bug this replaces was the pair: the row was missing AND nothing
 * said so, which read as "pinning did nothing". Both halves are checked
 * here — the chip appears, and a subject with genuinely nothing still
 * renders nothing rather than a placeholder (CHIP_SPEC §8.5 rule 3).
 */

const FIXTURE = "?fixture=pinned-far";

/** Chips outside the marquee — i.e. the fixed zone. */
const FIXED = ".ticker-container [data-chip]:not(.ticker-scroll-wrapper [data-chip])";

test("a pinned subject past the horizon renders in the fixed zone", async ({ page }) => {
  await openShim(page, `${FIXTURE}&pin=sports_mlb:Milwaukee Brewers`);

  const fixed = page.locator(FIXED);
  await expect(fixed).toHaveCount(1);
  await expect(fixed.first()).toContainText("Milwaukee Brewers");
});

test("a pinned subject is not also on the tape", async ({ page }) => {
  await openShim(page, `${FIXTURE}&pin=sports_mlb:Milwaukee Brewers`);

  // dropPinned (§8.5 rule 5): on the bar exactly once.
  const tape = page.locator(".ticker-scroll-wrapper [data-chip]");
  const texts = await tape.allInnerTexts();
  expect(texts.filter((t) => t.includes("Milwaukee Brewers"))).toHaveLength(0);
});

test("a subject with nothing to show renders nothing, not a placeholder", async ({ page }) => {
  await openShim(page, `${FIXTURE}&pin=sports_mlb:Seattle Mariners`);

  await expect(page.locator(FIXED)).toHaveCount(0);
});

test("the tape is unchanged by a pin that resolves to nothing", async ({ page }) => {
  await openShim(page, FIXTURE);
  const before = await page.locator(".ticker-scroll-wrapper [data-chip]").count();

  await openShim(page, `${FIXTURE}&pin=sports_mlb:Seattle Mariners`);
  await expect(page.locator(".ticker-scroll-wrapper [data-chip]")).toHaveCount(before);
});
