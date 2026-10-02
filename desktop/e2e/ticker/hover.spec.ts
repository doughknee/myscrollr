import { test, expect, type Page } from "@playwright/test";
import { parkMouse } from "./pages";

/**
 * SCROLLR-281 and SCROLLR-291: Pages have no hover setting, and the page holds
 * while the pointer is ACTIVE over the bar (entering, or moving within the last
 * 5 s), not merely present. A pointer that rests 5 s releases the hold, so a
 * cursor left at the screen edge cannot freeze the bar for good.
 *
 * Playwright's fake clock, like pages.spec.ts: `runFor` fires the page clock's
 * 100 ms tick and the hover's idle timer in order, so the check is the same run
 * every time and costs seconds, not minutes. A page dwells 6-12 s, the swipe is
 * 0.6 s, the idle release is 5 s.
 */
const IDLE_S = 5;
const MAX_DWELL_S = 12;
const SWIPE_S = 0.6;

test.use({ viewport: { width: 1920, height: 80 } });

const pageUp = (page: Page) => page.locator("[data-pages] [data-page]").evaluateAll((els) => els.map((e) => e.getAttribute("data-page")).join("|"));
/** The lit pill's fill (SCROLLR-303: the dwell line became the band's lit pill). */
const dwellLine = (page: Page) => page.locator("[data-band] [data-lit] > span").first().evaluate((e) => getComputedStyle(e).transform);

async function open(page: Page, ctx: import("@playwright/test").BrowserContext, hover = "keep") {
  await ctx.clock.install();
  await parkMouse(page);
  await page.goto(`/ticker-shim.html?pages=1&fixture=pages&hover=${hover}`);
  await parkMouse(page);
  // Boot on real time (fonts, /dashboard); the fake clock only moves on runFor.
  await page.waitForSelector("[data-page]");
  await ctx.clock.runFor(2000);
  const first = await pageUp(page);
  expect(first).not.toContain("|");
  return first;
}

/** Run the fake clock in 1 s steps until the page changes; returns the virtual seconds it took, or null at the cap. */
async function secondsToTurn(page: Page, ctx: import("@playwright/test").BrowserContext, before: string, capS: number) {
  for (let s = 1; s <= capS; s++) {
    await ctx.clock.runFor(1000);
    if ((await pageUp(page)) !== before) return s;
  }
  return null;
}

test("a still pointer over the bar holds the page for 5 s, then the bar turns", async ({ page, context }) => {
  test.setTimeout(120_000);
  const before = await open(page, context);
  await page.mouse.move(400, 30);
  await context.clock.runFor(IDLE_S * 1000 - 1000);
  expect(await pageUp(page), "held while the pointer was active").toBe(before);

  const took = await secondsToTurn(page, context, before, MAX_DWELL_S + SWIPE_S + 3);
  expect(took, "the bar turned after the pointer rested").not.toBeNull();
});

test("a moving pointer holds the page and the dwell line, however long", async ({ page, context }) => {
  test.setTimeout(120_000);
  const before = await open(page, context);
  await page.mouse.move(400, 30);
  await context.clock.runFor(500); // the pause lands a frame after the hold; sample once it has
  const line = await dwellLine(page);
  // 40 s is over three of the longest dwell: a held page would have turned by then.
  for (let s = 0; s < 40; s++) {
    await page.mouse.move(400 + (s % 2) * 10, 30);
    await context.clock.runFor(1000);
    expect(await pageUp(page), `held at ${s + 1} s of movement`).toBe(before);
  }
  expect(await dwellLine(page), "the dwell line stood still").toBe(line);

  // Stop moving: the hold releases after 5 s and the page's remaining dwell (<= 12 s) runs out.
  const took = await secondsToTurn(page, context, before, IDLE_S + MAX_DWELL_S + SWIPE_S + 3);
  expect(took, "the bar turned once the pointer stopped").not.toBeNull();
  expect(took!, "not before the 5 s idle release").toBeGreaterThanOrEqual(IDLE_S);
});

test("moving the pointer again grabs the page back after a release", async ({ page, context }) => {
  test.setTimeout(120_000);
  const before = await open(page, context);
  await page.mouse.move(400, 30);
  await context.clock.runFor((IDLE_S + 1) * 1000); // released; the page's own dwell (>= 6 s) has only just started to run again
  expect(await pageUp(page), "still the same page: 3 s of its dwell have run").toBe(before);
  // Grab it again and keep moving: 20 s is past the longest remaining dwell, so a page that was not held would have turned.
  for (let s = 0; s < 20; s++) {
    await page.mouse.move(420 + (s % 2) * 10, 30);
    await context.clock.runFor(1000);
  }
  expect(await pageUp(page), "held again").toBe(before);
});

test("a pointer active on a follower window holds the leader's clock, and its rest releases it", async ({ page, context }) => {
  // The relay is a BroadcastChannel (real time) and the fake clock is shared by both pages,
  // so each virtual second is followed by a short real pause for the message to land.
  test.setTimeout(120_000);
  const before = await open(page, context);
  const second = await context.newPage();
  await parkMouse(second);
  await second.goto("/ticker-shim.html?pages=1&fixture=pages&label=ticker-2");
  await parkMouse(second);
  await second.waitForSelector("[data-page]");
  const step = async () => {
    await context.clock.runFor(1000);
    await page.waitForTimeout(60);
  };
  await second.mouse.move(400, 30);
  await page.waitForTimeout(300);
  for (let s = 0; s < 30; s++) {
    await step();
    expect(await pageUp(page), `the leader held at ${s + 1} s while the follower's pointer moved on`).toBe(before);
    await second.mouse.move(400 + (s % 2) * 10, 30);
  }
  let took: number | null = null;
  for (let s = 1; s <= IDLE_S + MAX_DWELL_S + SWIPE_S + 3 && took === null; s++) {
    await step();
    if ((await pageUp(page)) !== before) took = s;
  }
  expect(took, "the leader turned once the follower's pointer rested").not.toBeNull();
  expect(took!, "not before the 5 s idle release").toBeGreaterThanOrEqual(IDLE_S - 1);
});
