import { test, expect } from "@playwright/test";
import { openShim } from "./shim";
import quiet from "../../src/dev/__fixtures__/dashboard.quiet.json" with { type: "json" };

// Deterministic: selection, not timing.
test.describe.configure({ retries: 0 });

/**
 * CHIP_SPEC §8.1, the floors. With nothing inside any horizon the bar is
 * not empty: Sports shows the next matchday -- every `pre` on the local
 * calendar day of the soonest one within 7 days, and nothing else; News
 * shows a feed's newest item if it is under 48 h old, and nothing for a
 * feed whose newest is older.
 *
 * The `quiet` fixture holds 4 games three days out, 4 the day after, one
 * eight days out; a Guardian feed whose newest is 30 h old and a PBS feed
 * whose newest is 60 h old.
 */
test("[quiet] the bar shows the next matchday and the fresh feed's headline, nothing else", async ({ page }) => {
  // The shim shifts every timestamp by (now - _captured_at), so the
  // matchday is worked out on the shifted times, in this machine's zone,
  // exactly as the rail does.
  const delta = Date.now() - Date.parse(quiet._captured_at);
  const games = quiet.data.sports
    .filter((g) => g.state === "pre")
    .map((g) => ({ home: g.home_team_name, at: new Date(Date.parse(g.start_time) + delta) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const matchday = games[0].at.toDateString();
  const expected = games.filter((g) => g.at.toDateString() === matchday).map((g) => g.home);
  expect(expected.length).toBeGreaterThan(0);

  await openShim(page, "?fixture=quiet");

  const homes = await page.$$eval('.ticker-item [data-rotate-slot^="spo-"]', (els) =>
    els.map((el) => (JSON.parse(el.getAttribute("data-pin-subject")!) as { subject: string }).subject),
  );
  expect(homes.sort()).toEqual([...expected].sort());

  const byFeed = (url: string) =>
    quiet.data.rss
      .filter((r) => r.feed_url === url)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const guardian = byFeed("https://www.theguardian.com/world/rss");
  const pbs = byFeed("https://www.pbs.org/newshour/feeds/rss/headlines");

  const fresh = page.locator('.ticker-item [data-rotate-slot^="rss-news_guardian-"]');
  await expect(fresh).toHaveCount(1);
  await expect(fresh).toContainText(guardian[0].title.slice(0, 40));

  await expect(page.locator('.ticker-item [data-widget="news_pbs"]')).toHaveCount(0);
  expect(pbs.length).toBeGreaterThan(0); // the feed is in the fixture; the floor left it off
});
