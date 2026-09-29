import { test, expect } from "@playwright/test";

// Deterministic: no timing beyond a fixed settle window.
test.describe.configure({ retries: 0 });

/**
 * SCROLLR-254: the bar's first paint is final. The fonts are bundled
 * (`font-display: block`) and main.tsx holds the ticker mount until they are
 * decoded, so nothing reflows after load. Before, the Google Fonts swap
 * widened chips 191 -> 204 px at ~0.5 s and moved the number spans at ~1 s.
 * A layout-shift entry of ANY size means something on screen moved.
 */
test("[first paint] no layout shift after load, and no font from a CDN", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as any).__shifts.push((e as any).value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/ticker-shim.html?fixture=default");
  await page.locator(".ticker-container [data-chip]").first().waitFor();
  await page.waitForTimeout(3000);

  expect(await page.evaluate(() => (window as any).__shifts)).toEqual([]);
  const cdn = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((r) => /fonts\.g(oogleapis|static)\.com/.test(r.name)),
  );
  expect(cdn).toEqual([]);
});
