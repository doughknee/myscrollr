import { test, expect } from "@playwright/test";
import { fixture, openMain } from "./mainWindow";

// SCROLLR-464: a Markets symbol such as BTC/USD used to overflow its fixed-width cell.
for (const [width, height] of [[1100, 760], [720, 480]]) {
  test(`Home Markets symbols fit their cell at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await openMain(page, context, { dashboard: fixture("default") });
    const symbol = page.getByText("BTC/USD", { exact: true }).first();
    await expect(symbol).toBeVisible({ timeout: 15_000 });
    expect(await symbol.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // And the price column stays clear of it.
    const row = symbol.locator("xpath=..");
    expect(await row.evaluate((r) => r.scrollWidth <= r.clientWidth)).toBe(true);
  });
}
