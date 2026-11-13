import { test, expect } from "@playwright/test";
import { fixture, openMain } from "./mainWindow";

// SCROLLR-405: a ticker window that could not be placed is hidden, so the monitors page shows
// the failure and a retry. The failure arrives the way the ticker sends it: a `ticker-placement`
// event (web mode relays it over the same BroadcastChannel the two windows share).
const send = (page: import("@playwright/test").Page, failed: boolean) =>
  page.evaluate((failed) => {
    const bus = new BroadcastChannel("scrollr-web");
    bus.postMessage({ event: "ticker-placement", payload: { label: "ticker", monitor: "Browser", failed } });
    bus.close();
  }, failed);

for (const [width, height] of [[960, 640], [720, 480]]) {
  test(`monitors page shows a failed placement with Try again at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height });
    await openMain(page, context, { dashboard: fixture("default"), store: { "scrollr:lastRoute": "/customize" } });
    await page.getByText("Ticker", { exact: true }).nth(1).click();
    await expect(page.getByText("Display 1 ·")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Couldn.t place the bar/)).toHaveCount(0);

    await send(page, true);
    const row = page.getByText("Couldn’t place the bar on Display 1");
    await expect(row).toBeVisible();
    await page.screenshot({ path: info.outputPath(`placement-failed-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    await send(page, false);
    await expect(row).toHaveCount(0);
  });
}
