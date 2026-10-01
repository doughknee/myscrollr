import { test, expect, type Page } from "@playwright/test";

/**
 * SCROLLR-271: a page cell never moves anything when a value changes.
 *
 * The cells gallery (`?cells=1`, src/dev/cellsGallery.tsx) ends with one
 * strip per family holding ONE item in every state it passes through --
 * a game before kick-off, live with one-digit and two-digit scores, final;
 * a quote at 9.99 and 1,253.69 with a one- and two-digit change; a headline
 * nine minutes and twelve hours old -- each in a column of the same width.
 * Every reserved part must sit at the same x with the same width in every
 * state. jsdom cannot see this; a real layout can.
 */

/** [part, which edges must hold]. Names may change weight, so only their anchored edge counts. */
const PARTS: Record<string, [string, "box" | "left" | "right"][]> = {
  "game-stacked": [["away-score", "box"], ["home-score", "box"], ["status", "box"], ["mine", "box"], ["away-name", "left"], ["home-name", "left"]],
  "game-wide": [["away-score", "box"], ["home-score", "box"], ["status", "box"], ["away-name", "right"], ["home-name", "left"]],
  quote: [["change", "box"], ["price", "box"], ["range", "box"]],
  news: [["age", "box"], ["headline", "box"]],
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
