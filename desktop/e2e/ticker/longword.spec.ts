import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// SCROLLR-413: an unbroken headline (a 1,200-character token, a URL) used to clip mid-glyph on
// one line. It now breaks inside the lines the cell already reserves, and the reserved box does
// not change.
const URL_TITLE = "https://www.example.com/politics/2026/11/13/federal-reserve-officials-signal-no-hurry-to-cut-interest-rates?utm_source=feed&utm_medium=rss&utm_campaign=morning";
const PROSE = "Federal Reserve officials signal they are in no hurry to cut interest rates despite cooling inflation";

for (const [name, query, size] of [
  ["docked", "pages=1", { width: 1920, height: 64 }],
  ["Fill", "pages=1&fill=grid&utils=clock", { width: 1280, height: 720 }],
] as const) {
  test(`[${name}] long unbroken headlines wrap inside their lines and prose is untouched`, async ({ page }) => {
    const fx = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/dev/__fixtures__/dashboard.npr.json"), "utf8"));
    fx.data.rss[0].title = "W".repeat(1200);
    fx.data.rss[1].title = URL_TITLE;
    fx.data.rss[2].title = PROSE;
    await page.route("**/dashboard.npr.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(fx) }));
    await page.setViewportSize(size);
    await page.goto(`/ticker-shim.html?fixture=npr&${query}`);
    const heads = page.locator("[data-page] [data-part=headline]");
    await expect(heads.first()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    const read = () => heads.evaluateAll((nodes) => nodes.slice(0, 3).map((n) => {
      const cs = getComputedStyle(n);
      // Fill draws the canvas with CSS zoom: offsetHeight is in layout px, the rect in screen px.
      const lh = parseFloat(cs.lineHeight);
      return { fits: n.scrollWidth <= n.clientWidth, lines: Math.round((n as HTMLElement).offsetHeight / lh), h: n.getBoundingClientRect().height };
    }));
    const [token, url, prose] = await read();
    // Wide-open lines, nothing pushed past the cell's right edge.
    expect(token.fits).toBe(true);
    expect(url.fits).toBe(true);
    // The token uses every line reserved for it, not one clipped line.
    expect(token.lines).toBe(name === "Fill" ? 3 : 2);
    expect(prose.fits).toBe(true);
  });
}
