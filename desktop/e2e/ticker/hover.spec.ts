import { test, expect, type Page } from "@playwright/test";
import { openShim } from "./shim";

/**
 * SCROLLR-281: Pages have no hover setting; the page under the mouse always
 * holds, whatever `onHover` was left at by Continuous. A page dwells 6-12 s,
 * so 14 s covers at least one turn. `?hover=keep` seeds the pref a Continuous
 * user who chose "Keep moving" would carry into Pages.
 */
test.describe.configure({ retries: 0 });

const current = (page: Page) => page.locator("[data-pages] [data-page]").first().getAttribute("data-page");

test("the page under the mouse does not turn, even with onHover keep, and turns once let go", async ({ page }) => {
  await openShim(page, "?pages=1&hover=keep");
  const before = await current(page);
  const box = (await page.locator("[data-pages]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(14_000);
  expect(await current(page)).toBe(before);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect.poll(() => current(page), { timeout: 14_000 }).not.toBe(before);
});
