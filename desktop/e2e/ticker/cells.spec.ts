import { test, expect, type Page } from "@playwright/test";

/**
 * SCROLLR-271: a page cell never moves anything when a value changes.
 *
 * The cells gallery (`?cells=1`, src/dev/cellsGallery.tsx) ends with one
 * strip per family holding ONE item in every state it passes through --
 * a game before kick-off, live with one-digit and two-digit scores, final;
 * a quote at 9.99 and 1,253.69 with a one- and two-digit change and a short,
 * a long and no day's range (the rail's ends must not move); a headline
 * nine minutes and twelve hours old -- each in a column of the same width.
 * Every reserved part must sit at the same x with the same width in every
 * state. jsdom cannot see this; a real layout can.
 */

/** [part, which edges must hold]. Names may change weight, so only their anchored edge counts. */
const PARTS: Record<string, [string, "box" | "left" | "right"][]> = {
  "game-stacked": [["away-score", "box"], ["home-score", "box"], ["status", "box"], ["mine", "box"], ["close", "box"], ["away-name", "left"], ["home-name", "left"]],
  "game-wide": [["away-score", "box"], ["home-score", "box"], ["status", "box"], ["away-name", "right"], ["home-name", "left"]],
  quote: [["change", "box"], ["price", "box"], ["spark", "box"], ["range", "box"], ["range-rail", "box"], ["range-low", "left"], ["range-high", "right"]],
  news: [["age", "box"], ["headline", "box"], ["summary", "left"]],
};

async function edges(page: Page, strip: string) {
  return page.evaluate(
    ({ strip, parts }) =>
      [...document.querySelectorAll(`[data-strip="${strip}"] [data-state]`)].map((cell) => {
        const origin = cell.getBoundingClientRect().left;
        const out: Record<string, string> = {};
        for (const [part, how] of parts) {
          const r = cell.querySelector(`[data-part="${part}"]`)!.getBoundingClientRect();
          const l = (r.left - origin).toFixed(1), w = r.width.toFixed(1), rt = (r.right - origin).toFixed(1);
          out[part] = how === "box" ? `${l}+${w}` : how === "left" ? l : rt;
        }
        return { state: cell.getAttribute("data-state"), out };
      }),
    { strip, parts: PARTS[strip] },
  );
}

test.describe("page cells hold still", () => {
  test.use({ viewport: { width: 1920, height: 1000 } });

  // SCROLLR-296 round 6: the price reserves its length plus one at mount, so a
  // digit-boundary crossing while the page is up, either way, moves nothing.
  test("quote: a price crossing a digit boundary, up or down, moves nothing", async ({ page }) => {
    const parts: [string, "box" | "left" | "right"][] = [["price", "box"], ["change", "box"], ["spark", "box"], ["range-rail", "box"], ["range-low", "left"], ["range-high", "right"]];
    await page.goto("/ticker-shim.html?cells=1");
    await page.locator('[data-strip="quote-cross"] [data-state]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const read = () =>
      page.evaluate((parts) =>
        [...document.querySelectorAll('[data-strip="quote-cross"] [data-state]')].map((cell) => {
          const origin = cell.getBoundingClientRect().left;
          const out: Record<string, string> = { text: cell.querySelector('[data-part="price"]')!.textContent! };
          for (const [part, how] of parts) {
            const r = cell.querySelector(`[data-part="${part}"]`)!.getBoundingClientRect();
            out[part] = how === "box" ? `${(r.left - origin).toFixed(1)}+${r.width.toFixed(1)}` : how === "left" ? (r.left - origin).toFixed(1) : (r.right - origin).toFixed(1);
          }
          return out;
        }), parts);
    const before = await read();
    await page.locator("[data-ticked]").waitFor({ state: "attached" });
    const after = await read();
    expect(after.length).toBe(before.length);
    for (const [i, a] of after.entries()) {
      expect(a.text, "the price changed").not.toBe(before[i].text);
      const { text: _a, ...nowAt } = a;
      const { text: _b, ...wasAt } = before[i];
      expect(nowAt, `${before[i].text} to ${a.text}`).toEqual(wasAt);
    }
  });
});

test.describe("page cells hold still", () => {
  test.use({ viewport: { width: 1920, height: 1000 } });

  for (const strip of Object.keys(PARTS)) {
    test(`${strip}: every part is where it was, in every state`, async ({ page }) => {
      await page.goto("/ticker-shim.html?cells=1");
      await page.locator(`[data-strip="${strip}"] [data-state]`).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const cells = await edges(page, strip);
      expect(cells.length).toBeGreaterThan(1);
      for (const c of cells.slice(1)) expect(c.out, `${strip} ${c.state} vs ${cells[0].state}`).toEqual(cells[0].out);
    });
  }
});
