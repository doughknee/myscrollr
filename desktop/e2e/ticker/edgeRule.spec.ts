import { test, expect, type Page } from "@playwright/test";

import { openShim } from "./shim";

/**
 * The edge's width rule on the real pages bar (SCROLLR-284): the edge never
 * takes more than 40% of the bar, the newest pins step back onto their pages
 * when the window shrinks, and they return when it widens.
 *
 * Local time + 2 zones + weather is the strip SCROLLR-273 measured (193 px).
 */
const BASE =
  "?pages=1&fixture=pages&utils=clock,weather&zones=America/New_York,Asia/Tokyo&weather=demo";
const pins = (...p: string[]) => p.map((x) => `&pin=${encodeURIComponent(x)}`).join("");
const CMD = "sports_nfl:Washington Commanders";
const TEX = "sports_nfl:Houston Texans";
const BBC = "news_bbc:https://feeds.bbci.co.uk/news/rss.xml";
const NPR = "news_npr:https://feeds.npr.org/1001/rss.xml";

const measure = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-pages]")!;
    const edge = document.querySelector<HTMLElement>("[data-edge]")!;
    return {
      bar: bar.clientWidth,
      edge: edge.offsetWidth,
      pins: edge.querySelectorAll("[data-part=pinned]").length,
    };
  });

test("1280: one headline fits beside clocks and weather, a second does not", async ({ page }) => {
  await openShim(page, BASE + pins(BBC, NPR));
  await expect.poll(async () => (await measure(page)).pins).toBe(1);
  const m = await measure(page);
  expect(m.edge).toBeLessThanOrEqual(Math.floor(m.bar * 0.4));
  // The pinned headline is the narrow one-line column, 260 px.
  const w = await page.locator("[data-edge] [data-part=pinned]").evaluate((e) => e.parentElement!.getBoundingClientRect().width);
  expect(Math.round(w)).toBe(260);
});

test("1280: a game pin beside clocks and weather leaves every family its columns", async ({ page }) => {
  await openShim(page, BASE + pins(CMD, TEX));
  await expect.poll(async () => (await measure(page)).pins).toBe(1);
  const m = await measure(page);
  expect(m.edge).toBeLessThanOrEqual(Math.floor(m.bar * 0.4));
  // Pro games (264) and quotes (260) keep 2 or more columns.
  expect(Math.floor((m.bar - 112 - m.edge) / 264)).toBeGreaterThanOrEqual(2);
});

test("a shrinking window steps the newest pin back; widening brings it back", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 720 });
  await openShim(page, BASE + pins(CMD, TEX, BBC));
  // 1920 holds two games (722 of 768) but not the headline as well.
  await expect.poll(async () => (await measure(page)).pins).toBe(2);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await measure(page)).pins).toBe(1);
  const m = await measure(page);
  expect(m.edge).toBeLessThanOrEqual(Math.floor(m.bar * 0.4));

  await page.setViewportSize({ width: 1920, height: 720 });
  await expect.poll(async () => (await measure(page)).pins).toBe(2);
});
