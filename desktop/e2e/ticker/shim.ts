import type { Page } from "@playwright/test";

/** The marquee: the `<ul>` motion-plus moves, inside `.ticker-scroll-wrapper`. */
export const TRACK = ".ticker-scroll-wrapper ul";

/**
 * The fixtures every layout and rotation check runs over (SCROLLR-228):
 * the small default, the fifty-game Saturday, the longest names. `quiet`
 * is the floor case and has its own spec.
 */
export const FIXTURES = ["default", "busy", "longnames"] as const;

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

/**
 * One lap in ms: the original track's length at `speed`, plus the
 * container's own width, which a slot has to clear on top of that before
 * it counts as gone. Measured, never known: chip widths depend on the
 * fixture.
 */
export function measureLapMs(page: Page, speed: number) {
  return page.locator(TRACK).first().evaluate((ul, speed) => {
    const items = [...ul.querySelectorAll<HTMLElement>(".ticker-item")];
    const gap = parseFloat(getComputedStyle(ul).gap || "0") || 0;
    const track = items.reduce((w, li) => w + li.offsetWidth + gap, 0);
    const container = ul.closest(".ticker-container")!.getBoundingClientRect().width;
    return ((track + container) / speed) * 1000;
  }, speed);
}
