import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { dwells, itemsPerLap, laps, lapStarts, mustSeeIds, readTrace, recordFromStart, startRecording, type PagesTrace } from "./pages";

/**
 * SCROLLR-275: the widget-pages bar (`?pages=1`), measured in a real layout.
 *
 * Time is Playwright's fake clock, so a 60-second lap costs ~20 s of wall
 * time and every run is the same run: `clock.runFor` fires the page clock's
 * 100 ms tick, the 4 s live-update sim and every animation frame in order.
 * The recorder (pages.ts) reads `performance.now()` inside a MutationObserver
 * callback, which the fake clock also owns.
 *
 * Asserted on each fixture x width:
 *   1. no cell moves while its page is up (live updates land every 4 s);
 *   2. no cell is cut off the page;
 *   3. every page dwells at least MIN_DWELL_S (and at most MAX_DWELL_S);
 *   4. a live game or your team is on every lap (ids read from the fixture);
 *   5. the lap stays within LAP_MAX_S.
 * Plus: two windows turn pages in step (real time, 4 turns).
 */

/** The design's floor (pagePlan's dwellFor: 6..12 s); 20 ms under it for the clock's frame step. */
const MIN_DWELL_S = 5.98;
const MAX_DWELL_S = 12.1;
/**
 * One trip round the bar: the scorecard (SCROLLR-266) says a lap is <= 60 s. Measured 14.6-57.8 s. The SCROLLR-268 prototype measured 23-60 s at
 * 1920 (today's continuous bar: ~170 s); this leaves headroom over that
 * and fails long before a lap drifts back toward the old minutes.
 */
const LAP_MAX_S = 60;
/** Laps to observe by default (needs LAPS + 1 visit starts), and the most virtual time to spend on them. */
const LAPS = 1;
const CAP_MS = 240_000;
/** Two windows: how far apart their swipe-ins may land. Measured: a few ms; the bound is for a loaded CI box. */
const SKEW_MS = 400;

const RUNS: { fixture: string; width: number; laps?: number; live?: boolean }[] = [
  { fixture: "pages", width: 1920, laps: 2, live: true }, // every page kind: NFL (yours + live), stocks, crypto, news, the Also page
  { fixture: "mixed", width: 1920, laps: 2, live: true }, // 56-game Saturday beside stocks and news, live and yours
  { fixture: "busy", width: 1280, live: true }, // the overflow case: 14 pages of 4 games
  { fixture: "longnames", width: 1280 }, // the longest names, in the narrowest columns
  { fixture: "quiet", width: 1920 }, // nothing live: the floor
  { fixture: "default", width: 1920, live: true },
];

test.use({ viewport: { width: 1920, height: 80 } });

const url = (fixture: string, extra = "") => `/ticker-shim.html?pages=1&live=1&fixture=${fixture}${extra}`;

/** Advance the fake clock until `done` or the cap; returns the virtual ms spent. */
async function runUntil(clock: BrowserContext["clock"], done: () => Promise<boolean>, capMs = CAP_MS, stepMs = 2000) {
  let spent = 0;
  while (spent < capMs && !(await done())) {
    await clock.runFor(stepMs);
    spent += stepMs;
  }
  return spent;
}

const enterCount = (page: Page) => page.evaluate(() => window.__pg!.enters.length);

function summarise(tr: PagesTrace) {
  const l = laps(tr.enters);
  const d = dwells(tr.enters);
  return `pages=${tr.enters.length} laps=[${l.map((x) => x.toFixed(1)).join(", ")}]s dwell=${Math.min(...d).toFixed(2)}..${Math.max(...d).toFixed(2)}s moved=${tr.moved.length} cuts=${tr.cuts.length}`;
}

for (const { fixture, width, laps: wantLaps = LAPS, live } of RUNS) {
  test(`pages ${fixture} @${width}: still, whole, long enough, live every lap, short lap`, async ({ page, context }) => {
    test.setTimeout(300_000);
    await context.clock.install();
    await page.setViewportSize({ width, height: 80 });
    await recordFromStart(page);
    await page.goto(url(fixture));

    // Let the app boot on real time (fonts, /dashboard): the fake clock would
    // otherwise run minutes of virtual time before the first fetch resolves.
    await page.waitForSelector("[data-page]");
    const spent = await runUntil(context.clock, async () => lapStarts((await readTrace(page)).enters).length > wantLaps);
    const tr = await readTrace(page);
    console.log(`[pages ${fixture} @${width}] ${(spent / 1000).toFixed(0)}s virtual: ${summarise(tr)}`);

    const lapLens = laps(tr.enters);
    expect.soft(lapLens.length, `observed ${wantLaps} full laps in ${CAP_MS / 1000}s of virtual time`).toBe(wantLaps);

    expect.soft(tr.moved, "no cell moves while its page is up").toEqual([]);
    expect.soft(tr.cuts, "no cell is cut off").toEqual([]);

    const d = dwells(tr.enters);
    expect.soft(d.length, "pages were measured").toBeGreaterThanOrEqual(3);
    expect.soft(Math.min(...d), `shortest dwell (s)`).toBeGreaterThanOrEqual(MIN_DWELL_S);
    expect.soft(Math.max(...d), `longest dwell (s)`).toBeLessThanOrEqual(MAX_DWELL_S);

    for (const [i, len] of lapLens.entries()) expect.soft(len, `lap ${i + 1} (s)`).toBeLessThanOrEqual(LAP_MAX_S);

    const must = mustSeeIds(fixture);
    if (live) expect(must.length, "the fixture has live games or yours (else this check is vacuous)").toBeGreaterThan(0);
    if (must.length) {
      for (const [i, seen] of itemsPerLap(tr.enters).entries()) {
        expect.soft(must.filter((id) => !seen.has(id)), `live games and your team missing from lap ${i + 1}`).toEqual([]);
      }
    }
  });
}

test("two ticker windows turn pages together", async ({ page, context }) => {
  // Real time: the two windows talk over a BroadcastChannel in real time,
  // which a fake clock does not carry (each page's clock runs on its own).
  // Four turns of the leader's 6+ s dwell.
  test.setTimeout(90_000);
  await page.goto(url("pages"));
  const second = await context.newPage();
  await second.goto(url("pages", "&label=ticker-2"));
  await startRecording(page);
  await startRecording(second);

  await page.waitForFunction(() => window.__pg!.enters.length >= 5, null, { timeout: 60_000, polling: 250 });
  const lead = (await readTrace(page)).enters.slice(1, 5);
  const follow = (await readTrace(second)).enters;

  for (const e of lead) {
    const m = follow.find((x) => x.page === e.page && Math.abs(x.t - e.t) < 2000);
    expect.soft(m, `second window showed ${e.page} (leader up at ${new Date(e.t).toISOString()})`).toBeTruthy();
    if (m) expect.soft(Math.abs(m.t - e.t), `skew on ${e.page} (ms)`).toBeLessThanOrEqual(SKEW_MS);
  }
});
