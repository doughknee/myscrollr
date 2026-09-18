import type { Page } from "@playwright/test";

/** The marquee: the `<ul>` motion-plus moves, inside `.ticker-scroll-wrapper`. */
export const TRACK = ".ticker-scroll-wrapper ul";

/**
 * Open the ticker shim, wait for the rail to hold chips, and park the
 * mouse at the bottom of the viewport so the hover factor (default
 * `onHover: "slow"`) cannot touch the bar.
 */
export async function openShim(page: Page, query = "") {
  await page.goto(`/ticker-shim.html${query}`);
  await page.locator(".ticker-container [data-chip]").first().waitFor();
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height - 1);
}

export function trackTransform(page: Page) {
  return page.locator(TRACK).first().evaluate((ul) => getComputedStyle(ul).transform);
}
