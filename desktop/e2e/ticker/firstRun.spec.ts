import { test, expect } from "@playwright/test";

// Deterministic: selection, not timing.
test.describe.configure({ retries: 0 });

/**
 * SCROLLR-246: a fresh account's first signed-in ticker scrolls NPR
 * headlines instead of the "no sources yet" CTA.
 *
 * What this harness can and can't prove: the shim's plugin:http stub
 * (ticker-shim.html's `reply()`) only answers GET /dashboard, /catalog,
 * /health — a POST to /users/me/widgets or a PUT to /users/me/preferences
 * both fall through to its "not stubbed" 500, so App.tsx's default-add
 * network call always fails here. That's fine for what these two specs
 * check:
 *
 *   - `fresh` proves the CLIENT side of the once-only contract: an
 *     eligible zero-widget account (`default_widgets_applied: false`)
 *     never shows the "no sources yet" CTA, because `App.tsx` suppresses
 *     it the instant it decides an add is owed — before the (here,
 *     doomed) network call even resolves.
 *   - `default` proves NPR chips actually render once the server has
 *     already applied the default (it ships a `news_npr` widget row) —
 *     i.e. what the ticker looks like on the other side of a successful
 *     add.
 *
 * The add call itself (the POST succeeding against a real server) is
 * covered by desktop/src/lib/firstRunDefaultWidget.test.ts (vitest,
 * mocked API), not by this harness.
 */

test("[fresh] a zero-widget, not-yet-offered account never shows the sourceless CTA", async ({ page }) => {
  await page.goto("/ticker-shim.html?fixture=fresh");
  await page.locator(".ticker-container").first().waitFor();

  // Give the effect (and its doomed network call) a beat to run and
  // settle, then confirm the CTA never appeared.
  await page.waitForTimeout(1000);

  await expect(page.getByText("You haven’t added any sources yet.")).toHaveCount(0);
});

test("[default] an account with the default already applied shows an NPR chip", async ({ page }) => {
  await page.goto("/ticker-shim.html?fixture=default");
  await page.locator(".ticker-container [data-chip]").first().waitFor();

  await expect(page.getByText("You haven’t added any sources yet.")).toHaveCount(0);
  const npr = page.locator('.ticker-item [data-rotate-slot^="rss-news_npr-"]');
  await expect(npr.first()).toBeVisible();
});
