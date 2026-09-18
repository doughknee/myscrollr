import { test, expect } from "@playwright/test";
import { openShim, trackTransform } from "./shim";

// Timing-based: headless rAF can tick slowly, so one retry is allowed.
test.describe.configure({ retries: 1 });

// Sample the rail's transform for a few seconds. A scrolling rail changes
// every frame, so nearly every sample differs from the last. A frozen
// rail (SCROLLR-5) sits on one matrix and jumps at most once in this
// window when a slot rotates, so it is not enough to see two samples
// differ; count the changes. No minimum distance: headless rAF may move
// the rail only a few pixels between samples.
const SAMPLES = 7;
const EVERY_MS = 500;
const MIN_CHANGES = 3;

async function changes(page: Parameters<typeof openShim>[0]) {
  let last = await trackTransform(page);
  let n = 0;
  for (let i = 0; i < SAMPLES; i++) {
    await page.waitForTimeout(EVERY_MS);
    const now = await trackTransform(page);
    if (now !== last) n++;
    last = now;
  }
  return n;
}

test("the rail moves in continuous mode", async ({ page }) => {
  await openShim(page);
  expect(await changes(page)).toBeGreaterThanOrEqual(MIN_CHANGES);
});

test("the rail moves under prefers-reduced-motion", async ({ page }) => {
  // SCROLLR-5: <MotionConfig reducedMotion="user"> in src/main.tsx turns
  // the marquee's x transform off for users with reduced motion set, so
  // the bar renders and never scrolls. Expected to fail until that lands;
  // when it does, Playwright reports "unexpectedly passed" and this
  // marker comes off.
  test.fail();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openShim(page);
  expect(await changes(page)).toBeGreaterThanOrEqual(MIN_CHANGES);
});
