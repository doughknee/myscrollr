import { test, expect, type Page } from "@playwright/test";
import { openShim } from "./shim";

// Deterministic: selection and layout, not timing.
test.describe.configure({ retries: 0 });

/**
 * SCROLLR-264, CHIP_SPEC §8.7: no silent empty widgets. The `idle`
 * fixture holds three on-ticker widgets that contribute no chip -- a
 * Premier League whose only fixture is 10 days out, an off-season NBA
 * with no date, a PBS feed whose newest item is 60 h old -- so each must
 * show exactly one status chip, with the right words, without anything on
 * the bar shifting; and the league's status chip must give way to its game
 * chip the moment the fixture enters the horizon.
 */

const status = (page: Page, widget: string) =>
  page.locator(`.ticker-item [data-status][data-widget="${widget}"]`);

/** Run code in the ticker window through the dev bus (`qc` is the QueryClient). */
async function bus<T>(page: Page, code: string): Promise<T> {
  const res = await page.request.post("/__dev/cmd", { data: { window: "ticker", code, timeout: 4000 } });
  const body = (await res.json()) as { ok: boolean; value?: T; error?: string };
  expect(body.ok, body.error).toBe(true);
  return body.value as T;
}

test("[idle] one status chip per empty widget, the right words, no layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as any).__shifts.push((e as any).value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await openShim(page, "?fixture=idle");
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__shifts)).toEqual([]);

  await expect(status(page, "sports_premierleague")).toHaveCount(1);
  await expect(status(page, "sports_nba")).toHaveCount(1);
  await expect(status(page, "news_pbs")).toHaveCount(1);
  // Nothing else from those widgets is on the tape.
  await expect(page.locator('.ticker-item [data-widget^="sports_"]:not([data-status])')).toHaveCount(0);
  await expect(page.locator('.ticker-item [data-widget="news_pbs"]:not([data-status])')).toHaveCount(0);

  // The date is whatever the shim rebased next_game to, in this locale.
  const expected = await bus<string>(
    page,
    `const m = qc.getQueryData(["dashboard"]).data.sports_meta.leagues.find((l) => l.name === "Premier League");
     return "next match " + new Date(m.next_game).toLocaleString(undefined,
       { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });`,
  );
  // The visible line only: the width sizer holds a sample date by design.
  const said = (w: string) => status(page, w).getByTestId("status-text");
  await expect(status(page, "sports_premierleague")).toContainText("EPL");
  await expect(said("sports_premierleague")).toHaveText(expected);
  await expect(said("sports_nba")).toHaveText("off-season");
  await expect(said("news_pbs")).toHaveText("no headlines in the last 2 days");

  // Status chips are not pin targets and do not rotate.
  for (const w of ["sports_premierleague", "sports_nba", "news_pbs"]) {
    expect(await status(page, w).getAttribute("data-pin-subject")).toBeNull();
    expect(await status(page, w).getAttribute("data-rotate-slot")).toBeNull();
  }
});

test("[idle] the status chip holds its width across messages, then gives way to the game", async ({ page }) => {
  await openShim(page, "?fixture=idle");
  const epl = status(page, "sports_premierleague");
  const dated = (await epl.boundingBox())!.width;

  // The league loses its date: the same chip now says "off-season".
  await bus(
    page,
    `const d = qc.getQueryData(["dashboard"]);
     window.__idle = d;
     const leagues = d.data.sports_meta.leagues.map((l) =>
       l.name === "Premier League" ? { ...l, is_offseason: true, next_game: null } : l);
     qc.setQueryData(["dashboard"], { ...d, data: { ...d.data, sports: [], sports_meta: { leagues } } });
     return true;`,
  );
  await expect(epl.getByTestId("status-text")).toHaveText("off-season");
  expect(Math.abs((await epl.boundingBox())!.width - dated)).toBeLessThan(0.01);

  // The fixture moves inside the 24 h horizon: a real chip replaces the status.
  const n = await bus<number>(
    page,
    `const d = window.__idle;
     const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
     const sports = d.data.sports.map((g) => ({ ...g, start_time: soon }));
     const leagues = d.data.sports_meta.leagues.map((l) =>
       l.name === "Premier League" ? { ...l, next_game: soon } : l);
     qc.setQueryData(["dashboard"], { ...d, data: { ...d.data, sports, sports_meta: { leagues } } });
     return sports.length;`,
  );
  expect(n).toBe(1);
  await expect(epl).toHaveCount(0);
  await expect(page.locator('.ticker-item [data-widget="sports_premierleague"]')).toHaveCount(1);
  await expect(page.locator('.ticker-item [data-widget="sports_premierleague"]')).toContainText("Burnley");
  // The other two widgets are still empty, still one status chip each.
  await expect(status(page, "sports_nba")).toHaveCount(1);
  await expect(status(page, "news_pbs")).toHaveCount(1);
});
