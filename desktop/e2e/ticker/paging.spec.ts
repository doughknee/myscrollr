import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { parkMouse } from "./pages";

/**
 * Manual paging and the band (SCROLLR-298, SCROLLR-301, SCROLLR-303). The band
 * at the bar's left end is the edge bar (a segment per widget), the name, the
 * chip and a pill per page of this widget; the keypad ‹ ˄ ˅ › shows on hover
 * only. ‹ ›, ←/→ and the wheel turn this widget's page; ˄ ˅, ↑/↓ and
 * Shift+wheel change the widget; a pill shows its page, a segment its widget.
 * A move is a turn like any other, so it restarts the page's dwell; a
 * follower's move turns every window.
 *
 * Playwright's fake clock, as hover.spec.ts: the page clock only moves on runFor.
 */
const MIN_DWELL_S = 6;
const SWIPE_MS = 600;
/** pagePlan's BAND_W. */
const BAND_W = 192;

test.use({ viewport: { width: 1920, height: 80 } });

const pageUp = (page: Page) => page.locator("[data-pages] [data-page]").evaluateAll((els) => els.map((e) => e.getAttribute("data-page")).join("|"));
/** `sports_nfl:2/3` of the newest page → tab, 1-based page, count. */
async function where(page: Page) {
  const p = await page.locator("[data-pages] [data-page]").last().getAttribute("data-page");
  const [tab, pos] = p!.split(":");
  const [at, of] = pos.split("/").map(Number);
  return { tab, at, of };
}
const tabUp = async (page: Page) => (await where(page)).tab;
const at = async (page: Page) => (await where(page)).at;
const visit = (page: Page) => page.locator("[data-pages] [data-page]").last().getAttribute("data-visit").then(Number);

async function open(page: Page, ctx: BrowserContext, extra = "", fixture = "pages") {
  await ctx.clock.install();
  await parkMouse(page);
  await page.goto(`/ticker-shim.html?pages=1&fixture=${fixture}${extra}`);
  await parkMouse(page);
  await page.waitForSelector("[data-band] [data-name]");
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

async function settle(ctx: BrowserContext) {
  await ctx.clock.runFor(SWIPE_MS + 100);
}

test("the band: 192 px at x 0, the page after it, a segment per widget, a pill per page with this page's lit, and nothing to read at rest but the name and the chip", async ({ page, context }) => {
  await open(page, context);
  const band = (await page.locator("[data-band]").boundingBox())!;
  expect([band.x, band.width], "the band at the bar's left end").toEqual([0, BAND_W]);
  expect((await page.locator("[data-pages] [data-page]").boundingBox())!.x, "the page right after it").toBe(BAND_W);
  const segs = await page.locator("[data-seg]").evaluateAll((els) => els.map((e) => ({ tab: e.getAttribute("data-seg"), on: e.hasAttribute("data-active"), x: e.getBoundingClientRect().x, w: e.getBoundingClientRect().width })));
  expect(segs.length, "a segment per widget").toBeGreaterThan(3);
  expect(segs.filter((s) => s.on).map((s) => s.tab), "the widget up is the active segment").toEqual([await tabUp(page)]);
  expect(segs.every((s) => s.x === 0 && s.w === 4), "the edge bar: 4px at the left edge").toBe(true);
  const { of } = await where(page);
  expect(of, "the pages fixture's first widget has several pages").toBeGreaterThan(1);
  expect(await page.locator("[data-band] [data-pill]").count()).toBe(of);
  expect(await page.locator("[data-band] [data-pill][data-lit]").getAttribute("data-pill")).toBe("0");
  const text = await page.locator("[data-band] [data-label]").last().evaluate((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim());
  expect(text, "at rest: the name and the chip's count, no x/y").toMatch(/^NFL \d+$/);
  expect(await page.locator("[data-band] [data-chip]").getAttribute("data-kind"), "live games: the live chip").toBe("live");
});

test("the keypad takes no width at rest, shows on hover with ‹ ˄ ˅ › as 18x22 keys, and the chip steps aside", async ({ page, context }) => {
  await open(page, context);
  const kp = page.locator("[data-keypad]");
  expect((await kp.boundingBox())?.width ?? 0, "no width at rest").toBe(0);
  expect(await kp.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  await expect(page.locator("[data-band] [data-chip]")).toBeVisible();
  await page.mouse.move(900, 30);
  // The 150 ms fade is a CSS transition, on real time, not the fake clock.
  await expect.poll(() => kp.evaluate((e) => getComputedStyle(e).opacity), { message: "shown with the pointer over the bar" }).toBe("1");
  expect(await kp.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Previous page", "Previous widget", "Next widget", "Next page"]);
  for (const b of await kp.locator("button").all()) {
    const box = (await b.boundingBox())!;
    expect([box.width, box.height]).toEqual([18, 22]);
  }
  expect((await kp.boundingBox())!.height).toBe(26);
  await expect(page.locator("[data-band] [data-chip]"), "the chip steps aside").toBeHidden();
  const name = page.locator("[data-band] [data-name]").last();
  expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth), "the name is whole beside the keypad").toBe(true);

  // Keyboard focus shows it too, with the pointer away.
  await parkMouse(page);
  await expect.poll(() => kp.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-keypad]")), "Tab lands on the keypad first").toBe(true);
  await expect.poll(() => kp.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  expect((await kp.boundingBox())!.width).toBeGreaterThan(70);
});

test("the name is 20 px, 15 px beside the keypad when longer than five characters, and never cut", async ({ page, context }) => {
  await open(page, context);
  const name = page.locator("[data-band] [data-name]").last();
  const read = () => name.evaluate((e) => ({ code: e.textContent!, px: getComputedStyle(e).fontSize, cut: e.scrollWidth > e.clientWidth }));
  const n = await page.locator("[data-seg]").count();
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await parkMouse(page);
    const rest = await read();
    expect(rest, `${rest.code} at rest`).toEqual({ code: rest.code, px: "20px", cut: false });
    await page.mouse.move(900, 30);
    await expect.poll(() => page.locator("[data-keypad]").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    const hov = await read();
    expect(hov, `${rest.code} on hover`).toEqual({ code: rest.code, px: rest.code.length > 5 ? "15px" : "20px", cut: false });
    seen.push(`${hov.code} ${hov.px}`);
    await page.keyboard.press("ArrowDown");
    await context.clock.runFor(1500); // the swipe and the wipe
  }
  expect(seen.some((s) => s.endsWith("15px")), `a long code was measured: ${seen.join(", ")}`).toBe(true);
});

test("‹ › read on: through this widget's pages, then into the next widget; ˄ ˅ skip a widget", async ({ page, context }) => {
  await open(page, context);
  const { tab, of } = await where(page);
  await page.mouse.move(900, 30);
  const key = (label: string) => page.locator(`[data-keypad] button[aria-label="${label}"]`);
  await expect.poll(() => key("Next page").evaluate((e) => getComputedStyle(e.parentElement!).opacity)).toBe("1");
  await key("Next page").click();
  await settle(context);
  expect(await where(page)).toEqual({ tab, at: 2, of });
  expect(await page.locator("[data-band] [data-pill][data-lit]").getAttribute("data-pill"), "the lit pill moved").toBe("1");
  await key("Previous page").click();
  await settle(context);
  await key("Previous page").click();
  await settle(context);
  const prevTab = await tabUp(page);
  expect(prevTab, "back from page 1 reads on into the previous widget").not.toBe(tab);
  const there = await where(page);
  expect(there, "at its last page").toEqual({ tab: prevTab, at: there.of, of: there.of });
  expect(await page.locator("[data-page][data-back]").count(), "swiped back").toBe(1);
  await key("Next page").click();
  await settle(context);
  expect(await where(page), "and forward past its last page comes back to page 1 here").toEqual({ tab, at: 1, of });
  await key("Next widget").click();
  await settle(context);
  const next = await tabUp(page);
  expect(next).not.toBe(tab);
  await key("Previous widget").click();
  await settle(context);
  expect(await where(page), "and back to the page you were reading").toEqual({ tab, at: 1, of });
});

test("hovering ˄ or ˅ brightens the segment it would go to", async ({ page, context }) => {
  await open(page, context);
  const bg = () => page.locator("[data-seg]").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  await page.mouse.move(900, 30);
  const down = page.locator('[data-keypad] button[aria-label="Next widget"]');
  await expect.poll(() => down.evaluate((e) => getComputedStyle(e.parentElement!).opacity)).toBe("1");
  await page.waitForTimeout(500); // the segments' .35 s fade, real time
  const rest = await bg();
  await down.hover();
  await page.waitForTimeout(500);
  const peeked = await bg();
  const changed = rest.map((c, i) => (c === peeked[i] ? -1 : i)).filter((i) => i >= 0);
  expect(changed, "one segment, the next widget's").toEqual([1]);
  await page.locator('[data-keypad] button[aria-label="Previous widget"]').hover();
  await page.waitForTimeout(500);
  const up = await bg();
  expect(rest.map((c, i) => (c === up[i] ? -1 : i)).filter((i) => i >= 0), "the previous widget's, wrapping to the last").toEqual([rest.length - 1]);
});

test("the keypad never changes shape: four keys always, the ones that cannot act dimmed", async ({ page, context }) => {
  await open(page, context, "", "npr"); // one widget, many pages
  await page.mouse.move(900, 30);
  const keys = (p: Page) => p.locator("[data-keypad] button").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}${e.getAttribute("aria-disabled") ? " (off)" : ""}`));
  expect(await keys(page)).toEqual(["Previous page", "Previous widget (off)", "Next widget (off)", "Next page"]);
  const one = await context.newPage();
  await parkMouse(one);
  await one.goto("/ticker-shim.html?pages=1&fixture=onegame");
  await one.waitForSelector("[data-band] [data-name]");
  await one.mouse.move(900, 30);
  expect(await keys(one), "one widget, one page: all four, all dimmed").toEqual(["Previous page (off)", "Previous widget (off)", "Next widget (off)", "Next page (off)"]);
});

test("a pill shows its page; a segment jumps to its widget the shortest way round", async ({ page, context }) => {
  await open(page, context);
  const { tab, of } = await where(page);
  await page.locator(`[data-band] [data-pill="${of - 1}"]`).click();
  await settle(context);
  expect(await where(page)).toEqual({ tab, at: of, of });
  await page.locator("[data-band] [data-pill='0']").click();
  await settle(context);
  expect(await where(page)).toEqual({ tab, at: 1, of });
  expect(await page.locator("[data-page][data-back]").count(), "an earlier pill swipes back").toBe(1);
  const segs = await page.locator("[data-seg]").evaluateAll((els) => els.map((e) => e.getAttribute("data-seg")!));
  await page.locator(`[data-seg="${segs[2]}"]`).click({ force: true });
  await settle(context);
  expect(await tabUp(page)).toBe(segs[2]);
  expect(await page.locator("[data-page][data-back]").count(), "two ahead: forward").toBe(0);
  await page.locator(`[data-seg="${segs[0]}"]`).click({ force: true });
  await settle(context);
  expect(await tabUp(page)).toBe(segs[0]);
  expect(await page.locator("[data-page][data-back]").count(), "two behind: back").toBe(1);
});

test("wheel down turns this widget's page, wheel up back, a flick is one step, a sideways swipe counts the same, and nothing scrolls", async ({ page, context }) => {
  await open(page, context);
  const { tab, of } = await where(page);
  expect(of).toBeGreaterThanOrEqual(3);
  await wheel(page, context, 100);
  expect(await where(page)).toEqual({ tab, at: 2, of });
  await wheel(page, context, -100);
  expect(await at(page)).toBe(1);

  // A flick: many wheel events in quick succession, one step.
  await page.mouse.move(900, 30);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 40);
  await settle(context);
  expect(await at(page), "a flick is one page").toBe(2);

  await wheel(page, context, 0, 120); // trackpad swipe to the left: forward
  expect(await at(page)).toBe(3);
  await wheel(page, context, 0, -120);
  expect(await at(page)).toBe(2);
  await wheel(page, context, -100);
  await wheel(page, context, -100);
  const prev = await where(page);
  expect(prev.tab, "back past page 1 reads on into the previous widget").not.toBe(tab);
  expect(prev, "at its last page").toEqual({ tab: prev.tab, at: prev.of, of: prev.of });
  expect(await page.evaluate(() => scrollX + scrollY + document.scrollingElement!.scrollTop), "the wheel scrolled nothing").toBe(0);
});

test("a step back swipes left to right; forward and the clock's own turns swipe right to left; the band wipes up for the next widget and down for back", async ({ page, context }) => {
  await open(page, context);
  /** Mid-swipe: the x translation of the page coming in (the newest visit) and of the one going out. */
  const midSwipe = async () => {
    await context.clock.runFor(SWIPE_MS / 2);
    const xs = await page.locator("[data-pages] [data-page]").evaluateAll((els) =>
      els
        .map((e) => ({ visit: Number(e.getAttribute("data-visit")), x: new DOMMatrix(getComputedStyle(e).transform).m41 }))
        .sort((a, b) => a.visit - b.visit),
    );
    await context.clock.runFor(SWIPE_MS / 2 + 100);
    expect(xs, "two pages on the bar mid-swipe").toHaveLength(2);
    return { out: xs[0].x, in: xs[1].x };
  };
  const bands = () => page.locator("[data-band] [data-label]").count();

  await page.keyboard.press("ArrowRight");
  expect(await bands(), "a page turn inside the widget moves nothing in the band").toBe(1);
  const fwd = await midSwipe();
  expect(fwd.in, "forward: comes in from the right").toBeGreaterThan(0);
  expect(fwd.out, "and leaves to the left").toBeLessThan(0);

  await page.keyboard.press("ArrowLeft");
  const back = await midSwipe();
  expect(back.in, "back: comes in from the left").toBeLessThan(0);
  expect(back.out, "and leaves to the right").toBeGreaterThan(0);
  expect(await page.locator("[data-page][data-back]").count(), "the stepped-back page is marked").toBe(1);

  // The clock's own turn after a step back goes right to left again.
  for (let s = 0; s < 80 && (await page.locator("[data-pages] [data-page]").count()) === 1; s++) await context.clock.runFor(250);
  await context.clock.runFor(SWIPE_MS / 2 - 250);
  const xs = await page.locator("[data-pages] [data-page]").evaluateAll((els) =>
    els.map((e) => ({ visit: Number(e.getAttribute("data-visit")), x: new DOMMatrix(getComputedStyle(e).transform).m41 })).sort((a, b) => a.visit - b.visit),
  );
  expect(xs).toHaveLength(2);
  expect(xs[1].x, "an automatic turn comes in from the right").toBeGreaterThan(0);

  // The band's name and pills wipe with the widget: up on a jump forward, down on a jump back (SCROLLR-301, SCROLLR-303).
  const midWipe = async () => {
    await context.clock.runFor(200);
    const ys = await page.evaluate(() => {
      const pages = [...document.querySelectorAll("[data-pages] [data-page]")].sort((a, b) => Number(a.getAttribute("data-visit")) - Number(b.getAttribute("data-visit")));
      const now = pages[pages.length - 1].getAttribute("data-page")!.split(":")[0];
      return [...document.querySelectorAll("[data-band] [data-label]")].map((e) => ({ now: e.getAttribute("data-label") === now, y: new DOMMatrix(getComputedStyle(e).transform).m42 }));
    });
    await context.clock.runFor(SWIPE_MS);
    expect(ys, "two blocks mid-wipe").toHaveLength(2);
    return { in: ys.find((b) => b.now)!.y, out: ys.find((b) => !b.now)!.y };
  };
  await context.clock.runFor(1000); // the automatic turn's wipe has finished
  const segX = await page.locator("[data-seg]").first().boundingBox();
  await page.keyboard.press("ArrowDown");
  const fwdWipe = await midWipe();
  expect(fwdWipe.in, "forward: the new block comes up from below").toBeGreaterThan(0);
  expect(fwdWipe.out, "and the old one leaves upward").toBeLessThan(0);
  expect(await page.locator("[data-seg]").first().boundingBox(), "the edge bar never moves").toEqual(segX);
  await context.clock.runFor(1000);
  await page.keyboard.press("ArrowUp");
  const backWipe = await midWipe();
  expect(backWipe.in, "back: the new block comes down from above").toBeLessThan(0);
  expect(backWipe.out, "and the old one leaves downward").toBeGreaterThan(0);
});

test("a step restarts the page's dwell, and the clock then moves on to the next widget", async ({ page, context }) => {
  await open(page, context);
  const first = await tabUp(page);
  // Most of the way through page one's dwell, step by key (no pointer, so no hold).
  await context.clock.runFor((MIN_DWELL_S - 1.5) * 1000);
  expect(await at(page)).toBe(1);
  await page.keyboard.press("ArrowRight");
  await settle(context);
  const stepped = await pageUp(page);
  expect(await where(page)).toMatchObject({ tab: first, at: 2 });
  // Page one's dwell would have run out by now; page two's has only just begun.
  await context.clock.runFor((MIN_DWELL_S - 1) * 1000 - SWIPE_MS - 100);
  expect(await pageUp(page), "the stepped-to page holds a full dwell").toBe(stepped);
  // Then the clock turns on by itself, to the next widget.
  for (let s = 0; s < 14 && (await pageUp(page)) === stepped; s++) await context.clock.runFor(1000);
  await settle(context);
  expect(await tabUp(page)).not.toBe(first);
});

test("a move on a follower window turns the leader and every window with it", async ({ page, context }) => {
  // The relay is a BroadcastChannel (real time), so each move waits briefly for it to land.
  await open(page, context);
  const second = await context.newPage();
  await parkMouse(second);
  await second.goto("/ticker-shim.html?pages=1&fixture=pages&label=ticker-2");
  await parkMouse(second);
  await second.waitForSelector("[data-band] [data-name]");
  await page.waitForTimeout(400);
  const both = async () => [await pageUp(page), await pageUp(second)];
  expect(await at(second)).toBe(1);
  const relay = async () => {
    await page.waitForTimeout(300);
    await context.clock.runFor(SWIPE_MS + 100);
    await page.waitForTimeout(100);
  };

  await second.mouse.move(900, 30);
  await second.mouse.wheel(0, 100);
  await relay();
  expect(await at(page), "the leader took the follower's step").toBe(2);
  expect(await at(second)).toBe(2);
  const [a, b] = await both();
  expect(b).toBe(a);

  await second.mouse.move(900, 30);
  await expect.poll(() => second.locator("[data-keypad]").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  await second.locator('[data-keypad] button[aria-label="Previous page"]').click();
  await relay();
  expect(await at(page)).toBe(1);
  expect(await at(second)).toBe(1);

  const first = await tabUp(page);
  await second.keyboard.press("ArrowDown");
  await relay();
  const jumped = await tabUp(page);
  expect(jumped, "the leader took the follower's jump").not.toBe(first);
  expect(await tabUp(second)).toBe(jumped);

  await second.mouse.move(900, 30);
  await second.keyboard.down("Shift");
  await second.mouse.wheel(0, -100);
  await second.keyboard.up("Shift");
  await relay();
  expect(await tabUp(page)).toBe(first);
  expect(await tabUp(second)).toBe(first);

  const segs = await second.locator("[data-seg]").evaluateAll((els) => els.map((e) => e.getAttribute("data-seg")!));
  await second.locator(`[data-seg="${segs[3]}"]`).click({ force: true });
  await relay();
  expect(await tabUp(page), "a segment on the follower").toBe(segs[3]);
});

test("Page controls off: the band is the same at rest and nothing appears on hover; the wheel and keys still page", async ({ page, context }) => {
  await open(page, context);
  const on = (await page.locator("[data-pages] [data-page]").boundingBox())!;

  const off = await context.newPage();
  await parkMouse(off);
  await off.goto("/ticker-shim.html?pages=1&fixture=pages&controls=0");
  await parkMouse(off);
  await off.waitForSelector("[data-band] [data-name]");
  await off.evaluate(() => document.fonts.ready);
  await context.clock.runFor(1000);
  expect((await off.locator("[data-band]").boundingBox())!.width, "the band's width does not change").toBe(BAND_W);
  expect(await off.locator("[data-pages] [data-page]").boundingBox(), "nor do the columns").toEqual(on);
  await off.mouse.move(900, 30);
  expect(await off.locator("[data-keypad]").count(), "no keypad").toBe(0);
  await expect(off.locator("[data-band] [data-chip]"), "the chip stays").toBeVisible();

  const before = await visit(off);
  await off.mouse.wheel(0, 100);
  await settle(context);
  expect(await visit(off), "the wheel still turns the page").toBe(before + 1);
  await off.keyboard.press("ArrowRight");
  await settle(context);
  expect(await visit(off), "and so does the right arrow").toBe(before + 2);
});

test("down jumps to the next widget, up back to the page you were reading; a jump back swipes left to right", async ({ page, context }) => {
  await open(page, context);
  const first = await pageUp(page);
  await page.keyboard.press("ArrowDown");
  await settle(context);
  const second = await pageUp(page);
  expect(second.split(":")[0], "a different widget").not.toBe(first.split(":")[0]);
  expect(second.split(":")[1], "on its first page").toMatch(/^1\//);
  expect(await page.locator("[data-page][data-back]").count()).toBe(0);
  await page.keyboard.press("ArrowUp");
  await settle(context);
  expect(await pageUp(page), "back on the page you were reading").toBe(first);
  expect(await page.locator("[data-page][data-back]").count(), "a jump back swipes left to right").toBe(1);
  // Up from the first widget wraps to the last widget, at its last page (not up yet).
  await page.keyboard.press("ArrowUp");
  await settle(context);
  const last = await page.locator("[data-seg]").last().getAttribute("data-seg");
  const w = await where(page);
  expect([w.tab, w.at]).toEqual([last, w.of]);
});

test("Shift+wheel jumps whole widgets, forward and back", async ({ page, context }) => {
  await open(page, context);
  const first = await tabUp(page);
  await page.mouse.move(900, 30);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 100);
  await settle(context);
  const second = await tabUp(page);
  expect(second).not.toBe(first);
  await page.mouse.wheel(0, 100);
  await settle(context);
  const third = await tabUp(page);
  expect(third).not.toBe(second);
  expect(third).not.toBe(first);
  await page.mouse.wheel(0, -100);
  await settle(context);
  expect(await tabUp(page)).toBe(second);
  await page.keyboard.up("Shift");
});
