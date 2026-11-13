import { test, expect } from "@playwright/test";
import { hoverReport, parkMouse } from "./pages";

// Deterministic: selection, not timing.
test.describe.configure({ retries: 0 });

/**
 * SCROLLR-246 / SCROLLR-283: a fresh account's first signed-in bar shows NPR
 * and Stocks as pages with the Clock on the edge, instead of the "no sources
 * yet" CTA.
 *
 * The shim (ticker-shim.html's `reply()`) stands in for the server: a
 * `POST /users/me/widgets/starter` against the `fresh` fixture (zero widgets,
 * flag false) swaps /dashboard for `dashboard.starter.json`, as the real
 * endpoint does, and records the write in `window.__shimRequests`. The
 * server's own half (one transaction, once per account, no half state) is
 * covered by the Go tests in api/internal/widgets/starter_test.go.
 *
 *   - `fresh` proves the CLIENT side of the once-only contract: the CTA never
 *     shows, exactly ONE starter call is made, and nothing else is written.
 *   - the pages test proves what the account sees after it: an NPR page, a
 *     Stocks page, and the Clock on the fixed edge, which was off before.
 *   - `default` proves NPR chips render for an account that already has them.
 */

const CTA = "You haven’t added any sources yet.";
const writes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __shimRequests: string[] }).__shimRequests);

test("[fresh] a zero-widget, not-yet-offered account never shows the sourceless CTA and asks for the starter once", async ({ page }) => {
  await page.goto("/ticker-shim.html?fixture=fresh");
  await page.locator(".ticker-container").first().waitFor();

  // Give the effect and its network call a beat to run and settle, then
  // confirm the CTA never appeared and the starter was asked for exactly once.
  await page.waitForTimeout(1000);

  await expect(page.getByText(CTA)).toHaveCount(0);
  expect(await writes(page)).toEqual([expect.stringMatching(/^POST .*\/users\/me\/widgets\/starter$/)]);
});

test("[fresh, pages] the first bar is an NPR page and a Stocks page, with the Clock on the edge", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 80 });
  // The pointer below the bar: a hovered page holds, and the bar then never
  // turns to Stocks (SCROLLR-289).
  await parkMouse(page);
  // utils= (none): the Clock starts OFF, so seeing it proves the client turned it on.
  await page.goto("/ticker-shim.html?fixture=fresh&pages=1&utils=");

  await parkMouse(page);

  // Pages swipe every 6 to 12 s; both starter widgets must come up within a lap.
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const up = await page
          .locator("[data-page]")
          .evaluateAll((els) => els.map((e) => e.getAttribute("data-page")!.split(":")[0]));
        up.forEach((u) => seen.add(u));
        return [...seen].sort();
      },
      { timeout: 40_000, intervals: [500] },
    )
    .toEqual(["finance_stocks", "news_npr"])
    .catch(async (e) => {
      throw new Error(`${await hoverReport(page)}\n${e}`);
    });

  // The Clock sits on the fixed edge, enabled by the client after the call.
  await expect(page.locator("[data-edge]")).toContainText(/\d{1,2}:\d{2}/);
  await expect(page.getByText(CTA)).toHaveCount(0);
  expect(await writes(page)).toHaveLength(1);
});

test("[default] an account with the default already applied shows an NPR chip", async ({ page }) => {
  await page.goto("/ticker-shim.html?fixture=default");
  await page.locator(".ticker-container [data-chip]").first().waitFor();

  await expect(page.getByText(CTA)).toHaveCount(0);
  const npr = page.locator('.ticker-item [data-rotate-slot^="rss-news_npr-"]');
  await expect(npr.first()).toBeVisible();
});

/**
 * SCROLLR-448 / SCROLLR-406: a signed-in account with no data source always
 * has a next step, and a dashboard that could not load is never dressed up
 * as an empty account.
 */
test("[fresh, starter fails, pages] the add-a-source step shows beside the Clock", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 1280, height: 80 });
  // Default utils: the Clock is on, as on a fresh install.
  await page.goto("/ticker-shim.html?fixture=fresh&pages=1&starter=fail");
  await expect(page.getByText(CTA)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-edge]")).toContainText(/\d{1,2}:\d{2}/);
  // The step sits in the page block, left of the edge, and is not cut off.
  const button = (await page.getByRole("button", { name: /browse the catalog/i }).boundingBox())!;
  const edge = (await page.locator("[data-edge]").boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(edge.x);
});

test("[empty, pages] a lone default Clock no longer hides the step", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 80 });
  await page.goto("/ticker-shim.html?fixture=empty&pages=1");
  await expect(page.getByText(CTA)).toBeVisible();
  await expect(page.locator("[data-edge]")).toContainText(/\d{1,2}:\d{2}/);
});

for (const mode of ["pages=1", "pages=0"]) {
  test(`[dashboard fails, ${mode}] says it could not load and offers a retry, not "no sources"`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 80 });
    // An unknown fixture makes /dashboard answer 500.
    await page.goto(`/ticker-shim.html?fixture=missing-on-purpose&${mode}`);
    await expect(page.getByText("Couldn’t load your sources.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(CTA)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });
}

test("[dashboard fails, Fill grid with a utility] the body says so and Try again is in it (SCROLLR-464)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/ticker-shim.html?fixture=missing-on-purpose&pages=1&fill=grid&utils=clock");
  const body = page.locator("[data-display-empty]");
  await expect(body.getByText("Couldn’t load your sources.")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-display-header]")).toContainText(/\d{1,2}:\d{2}/);
  const retry = body.getByRole("button", { name: /try again/i });
  await expect(retry).toBeVisible();
  const box = (await body.boundingBox())!;
  expect(box.height).toBeGreaterThan(500);
});
