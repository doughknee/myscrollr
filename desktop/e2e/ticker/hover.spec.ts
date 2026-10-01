import { test, expect, type Page } from "@playwright/test";
import { openShim } from "./shim";

/**
 * SCROLLR-281: under Pages, On hover is Hold page or Keep going. A page
 * dwells 6-12 s, so 14 s covers at least one turn. The shim seeds the pref
 * with ?hover= ("slow" is what a Hold page user has, "keep" is Keep going).
 */
test.describe.configure({ retries: 0 });

const current = (page: Page) => page.locator("[data-pages] [data-page]").first().getAttribute("data-page");

test("hold: the page under the mouse does not turn, and turns again once let go", async ({ page }) => {
  await openShim(page, "?pages=1&hover=slow");
  const before = await current(page);
  const box = (await page.locator("[data-pages]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(14_000);
  expect(await current(page)).toBe(before);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect.poll(() => current(page), { timeout: 14_000 }).not.toBe(before);
});

test("keep going: the page turns under the mouse", async ({ page }) => {
  await openShim(page, "?pages=1&hover=keep");
  const before = await current(page);
  const box = (await page.locator("[data-pages]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => current(page), { timeout: 14_000 }).not.toBe(before);
});
