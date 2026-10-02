import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { parkMouse } from "./pages";

/**
 * SCROLLR-298: manual paging. The wheel over the bar, the ‹ › arrows beside the
 * label and ←/→ step one page in reading order; the pager between the arrows
 * says where the page sits in the lap (`7/23`). A step is a turn like any
 * other, so it restarts the page's dwell; a follower's step turns every window.
 *
 * Playwright's fake clock, as hover.spec.ts: the page clock only moves on runFor.
 */
const MIN_DWELL_S = 6;
const SWIPE_MS = 600;
/** pagePlan's PAGER_W. */
const PAGER_W = 88;

test.use({ viewport: { width: 1920, height: 80 } });

const lapPos = (page: Page) => page.locator("[data-lap-pos]").getAttribute("data-lap-pos");
const at = async (page: Page) => Number((await lapPos(page))!.split("/")[0]);
const of = async (page: Page) => Number((await lapPos(page))!.split("/")[1]);
const pageUp = (page: Page) => page.locator("[data-pages] [data-page]").evaluateAll((els) => els.map((e) => e.getAttribute("data-page")).join("|"));

async function open(page: Page, ctx: BrowserContext, extra = "") {
  await ctx.clock.install();
  await parkMouse(page);
  await page.goto(`/ticker-shim.html?pages=1&fixture=pages${extra}`);
  await parkMouse(page);
  await page.waitForSelector("[data-lap-pos]");
  await page.evaluate(() => document.fonts.ready);
  await ctx.clock.runFor(1000);
  expect(await at(page)).toBe(1);
}

/** One wheel notch over the middle of the bar, then the swipe. */
async function wheel(page: Page, ctx: BrowserContext, dy: number, dx = 0) {
  await page.mouse.move(900, 30);
  await page.mouse.wheel(dx, dy);
  await ctx.clock.runFor(SWIPE_MS + 100);
}

test("the pager reads the page's place in the lap, beside the label, and nothing in it moves when the count does", async ({ page, context }) => {
  await open(page, context);
  const total = await of(page);
  expect(total, "the pages fixture spans several pages").toBeGreaterThan(5);
  const box = await page.locator("[data-pager]").boundingBox();
  expect(box!.x, "right after the 112px label").toBe(112);
  expect(box!.width).toBe(PAGER_W);
  const label = page.locator("[data-lap-pos]");
  const first = await label.boundingBox();
  for (let i = 0; i < 9; i++) await wheel(page, context, 100); // 1/n .. 10/n: one digit to two
  expect(await at(page)).toBe(10);
  expect(await label.boundingBox(), "the counter's box is reserved").toEqual(first);
  expect(await page.locator("[data-pager]").boundingBox()).toEqual(box);
});

test("wheel down steps forward, wheel up back, a flick is one step, and a sideways swipe counts the same", async ({ page, context }) => {
  await open(page, context);
  await wheel(page, context, 100);
  expect(await at(page)).toBe(2);
  await wheel(page, context, 100);
  expect(await at(page)).toBe(3);
  await wheel(page, context, -100);
  expect(await at(page)).toBe(2);

  // A flick: many wheel events in quick succession, one step.
  await page.mouse.move(900, 30);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 40);
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page), "a flick is one page").toBe(3);

  await wheel(page, context, 0, 120); // trackpad swipe to the left: forward
  expect(await at(page)).toBe(4);
  await wheel(page, context, 0, -120);
  expect(await at(page)).toBe(3);

  // Back past the first page of the lap wraps to the last.
  for (let i = 0; i < 3; i++) await wheel(page, context, -100);
  expect(await at(page)).toBe(await of(page));
  expect(await page.evaluate(() => scrollX + scrollY + document.scrollingElement!.scrollTop), "the wheel scrolled nothing").toBe(0);
});

test("the arrows show only while the pointer is over the bar, are 44px targets, and step one page each", async ({ page, context }) => {
  await open(page, context);
  const next = page.locator("[data-step=next]");
  const prev = page.locator("[data-step=prev]");
  const opacity = (l: typeof next) => l.evaluate((e) => getComputedStyle(e).opacity);
  expect(await opacity(next), "hidden with the pointer away").toBe("0");
  await expect(page.locator("[data-lap-pos]"), "the count is always shown").toBeVisible();

  await page.mouse.move(900, 30);
  // The 150 ms fade is a CSS transition, on real time, not the fake clock.
  await expect.poll(() => opacity(next), { message: "shown with the pointer over the bar" }).toBe("1");
  const hit = await next.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const a = getComputedStyle(e, "::after");
    return { w: r.width - parseFloat(a.left) - parseFloat(a.right), h: r.height };
  });
  expect(hit.w).toBeGreaterThanOrEqual(44);
  expect(hit.h).toBeGreaterThanOrEqual(44);

  await next.click();
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page)).toBe(2);
  await next.click();
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page)).toBe(3);
  await prev.click();
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page)).toBe(2);
});

test("← and → step when the window has focus", async ({ page, context }) => {
  await open(page, context);
  await page.keyboard.press("ArrowRight");
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page)).toBe(2);
  await page.keyboard.press("ArrowLeft");
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await at(page)).toBe(1);
});

test("a step restarts the page's dwell, and the clock carries on from the page stepped to", async ({ page, context }) => {
  await open(page, context);
  // Most of the way through page one's dwell, step by key (no pointer, so no hold).
  await context.clock.runFor((MIN_DWELL_S - 1.5) * 1000);
  expect(await at(page)).toBe(1);
  await page.keyboard.press("ArrowRight");
  await context.clock.runFor(SWIPE_MS + 100);
  const stepped = await pageUp(page);
  expect(await at(page)).toBe(2);
  // Page one's dwell would have run out by now; page two's has only just begun.
  await context.clock.runFor((MIN_DWELL_S - 1) * 1000 - SWIPE_MS - 100);
  expect(await pageUp(page), "the stepped-to page holds a full dwell").toBe(stepped);
  // Then the clock turns on by itself, onward from it.
  for (let s = 0; s < 14 && (await pageUp(page)) === stepped; s++) await context.clock.runFor(1000);
  await context.clock.runFor(SWIPE_MS + 100);
  expect(await pageUp(page)).not.toBe(stepped);
  expect(await at(page), "after the page stepped to, not back at the start").toBeGreaterThan(2);
});

test("a step on a follower window turns the leader and every window with it", async ({ page, context }) => {
  // The relay is a BroadcastChannel (real time), so each step waits briefly for it to land.
  await open(page, context);
  const second = await context.newPage();
  await parkMouse(second);
  await second.goto("/ticker-shim.html?pages=1&fixture=pages&label=ticker-2");
  await parkMouse(second);
  await second.waitForSelector("[data-lap-pos]");
  await page.waitForTimeout(400);
  const both = async () => [await pageUp(page), await pageUp(second)];
  expect(await at(second)).toBe(1);

  await second.mouse.move(900, 30);
  await second.mouse.wheel(0, 100);
  await page.waitForTimeout(300);
  await context.clock.runFor(SWIPE_MS + 100);
  await page.waitForTimeout(100);
  expect(await at(page), "the leader took the follower's step").toBe(2);
  expect(await at(second)).toBe(2);
  const [a, b] = await both();
  expect(b).toBe(a);

  await second.locator("[data-step=prev]").click();
  await page.waitForTimeout(300);
  await context.clock.runFor(SWIPE_MS + 100);
  await page.waitForTimeout(100);
  expect(await at(page)).toBe(1);
  expect(await at(second)).toBe(1);
});
