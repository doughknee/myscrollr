import { readFileSync } from "node:fs";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { allShown, dwells, hoverReport, laps, lapStarts, mustSeeIds, pageOrder, parkMouse, readTrace, recordFromStart, startRecording, topFirst, unfilled, visits, type PagesTrace } from "./pages";

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
 *   4. one page per widget per lap, its pages running 1, 2 ... N, 1, and
 *      live and yours lead their widget (page 1; ids read from the fixture).
 *      A live game is NOT on every lap any more (SCROLLR-297);
 *   5. the lap stays within LAP_MAX_S;
 *   6. every page is full: `min(columns, available)` items (SCROLLR-292).
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

/**
 * Every page of every widget has been up within this (the scorecard's "all
 * shown", SCROLLR-266/294), and the virtual time to spend finding out. Every
 * run is held to it: the `over5` exemptions went once SCROLLR-297's one page a
 * lap brought mixed, busy and pages+npr30 under it (Home, SCROLLR-298). Never
 * raise it to pass.
 */
const ALL_SHOWN_MAX_S = 300;
const ALL_CAP_MS = 600_000;

const RUNS: { fixture: string; width: number; laps?: number; live?: boolean; full?: boolean; npr30?: boolean }[] = [
  { fixture: "pages", width: 1920, laps: 2, live: true }, // every page kind: NFL (yours + live), stocks, crypto, news, the Also page
  { fixture: "mixed", width: 1920, laps: 2, live: true }, // 56-game Saturday beside stocks and news, live and yours (all shown 249 s since SCROLLR-297; 314 s before)
  // SCROLLR-296 round 2: college cells at 276px give 3 columns at 1280 with the Clock (was 4), 19 pages: all shown 306.6 s. Flagged to Home (their call; 264 would keep 4 columns and ~217 s).
  { fixture: "busy", width: 1280, live: true }, // the overflow case: 19 pages of 3 games (all shown 115 s since SCROLLR-297; 307 s before)
  { fixture: "longnames", width: 1280 }, // the longest names, in the narrowest columns
  { fixture: "quiet", width: 1920 }, // nothing live: the floor
  { fixture: "default", width: 1920, live: true },
  // SCROLLR-292, every page is full. One widget, one page, so a lap is one page: three laps measure three dwells.
  // `full`: the fixture has enough to fill, so every page must have a column per item.
  // 16 games at 6 columns (SCROLLR-296 round 2: fewer, roomier game cells) split evenly 6/5/5: `unfilled` holds, "a column per item" cannot.
  { fixture: "nflthursday", width: 1920, laps: 3, live: true }, // TNF + Sunday (your Bears lead: page 1)
  { fixture: "nflthursday", width: 1280, laps: 3, live: true }, // 16 games at 4 columns: four pages of 4 (the whole week, SCROLLR-293), one a lap
  { fixture: "googl", width: 1920, laps: 3, full: true }, // GOOGL + popular fills
  { fixture: "sparsenews", width: 1280, laps: 3 }, // 9 headlines over 3 days: all of them now (SCROLLR-293), 5 pages at 2 columns
  // SCROLLR-293: a 30-headline feed, the whole of it. One widget, so a lap is one visit (one page).
  { fixture: "npr", width: 1920, laps: 3 },
  { fixture: "npr", width: 1280, laps: 3 },
  { fixture: "onegame", width: 1920, laps: 3 }, // truly short: one game, at a page's column width
  // SCROLLR-294: the worst case for "all shown": every page kind, with NPR's 30 headlines (8 pages at 1920) among them.
  { fixture: "pages", width: 1920, laps: 2, live: true, npr30: true }, // all shown 295 s since SCROLLR-297 (404 s before)
];

/** dashboard.npr.json's 30 headlines, rebased onto now as the shim rebases a fixture. */
function npr30(): unknown[] {
  const j = JSON.parse(readFileSync("src/dev/__fixtures__/dashboard.npr.json", "utf8"));
  const delta = Date.now() - Date.parse(j._captured_at);
  const shift = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v);
  return j.data.rss.map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, shift(v)])));
}

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

for (const { fixture, width, laps: wantLaps = LAPS, live, full, npr30: swapNpr } of RUNS) {
  test(`pages ${fixture}${swapNpr ? "+npr30" : ""} @${width}: still, whole, long enough, one page a lap, live first, short lap, all shown`, async ({ page, context }) => {
    test.setTimeout(600_000);
    await context.clock.install();
    await page.setViewportSize({ width, height: 80 });
    await recordFromStart(page);
    // A pointer Chromium places over the bar holds the page (one 37 s dwell on mixed, SCROLLR-294's longer runs).
    await parkMouse(page);
    await page.goto(url(fixture));
    await parkMouse(page);

    // Let the app boot on real time (fonts, /dashboard): the fake clock would
    // otherwise run minutes of virtual time before the first fetch resolves.
    await page.waitForSelector("[data-page]");
    if (swapNpr) {
      // NPR's 3 headlines become dashboard.npr.json's 30, before NPR's first visit.
      await page.evaluate((rows) => window.__shimDashboard!((d) => ({ ...d, data: { ...d.data, rss: [...(d.data.rss as { feed_url: string }[]).filter((r) => !/npr\.org/.test(r.feed_url)), ...rows] } })), npr30());
    }
    const spent = await runUntil(context.clock, async () => {
      const e = (await readTrace(page)).enters;
      return lapStarts(e).length > wantLaps && allShown(e) !== null;
    }, ALL_CAP_MS);
    const tr = await readTrace(page);
    const all = allShown(tr.enters);
    console.log(`[pages ${fixture}${swapNpr ? "+npr30" : ""} @${width}] ${(spent / 1000).toFixed(0)}s virtual: ${summarise(tr)} allShown=${all?.toFixed(1) ?? "never"}s`);

    const lapLens = laps(tr.enters);
    expect.soft(lapLens.length, `observed at least ${wantLaps} full laps`).toBeGreaterThanOrEqual(wantLaps);
    expect.soft(all, `every page of every widget up within ${ALL_CAP_MS / 1000}s of virtual time`).not.toBeNull();
    if (all !== null) expect.soft(all, "all shown (s)").toBeLessThanOrEqual(ALL_SHOWN_MAX_S);

    expect.soft(tr.moved, "no cell moves while its page is up").toEqual([]);
    expect.soft(tr.cuts, "no cell is cut off").toEqual([]);
    expect.soft(unfilled(tr.enters), "every page shows min(columns, available) items").toEqual([]);
    expect.soft(tr.enters.filter((e) => e.pos !== (e.count > 1 ? `${e.index + 1}/${e.count}` : null)).map((e) => `${e.page}: label says ${e.pos}`), "the label counts the page").toEqual([]);
    expect.soft(tr.enters.filter((e) => e.factCut).map((e) => `${e.page}: "${e.fact}" beside ${e.pos}`), "the label's fact fits beside the counter").toEqual([]);
    if (full) expect.soft(tr.enters.filter((e) => e.items.length !== e.cols).map((e) => `${e.page}: ${e.items.length}/${e.cols}`), "a column per item").toEqual([]);

    const d = dwells(tr.enters);
    expect.soft(d.length, "pages were measured").toBeGreaterThanOrEqual(3);
    expect.soft(Math.min(...d), `shortest dwell (s)`).toBeGreaterThanOrEqual(MIN_DWELL_S);
    expect.soft(Math.max(...d), `longest dwell (s)`).toBeLessThanOrEqual(MAX_DWELL_S);

    for (const [i, len] of lapLens.entries()) expect.soft(len, `lap ${i + 1} (s)`).toBeLessThanOrEqual(LAP_MAX_S);

    expect.soft(pageOrder(tr.enters), "one page per widget per lap, 1, 2 ... N, 1").toEqual([]);
    expect.soft(topFirst(tr.enters), "live and yours lead their widget (page 1)").toEqual([]);
    const must = mustSeeIds(fixture);
    if (live) expect(must.length, "the fixture has live games or yours (else this check is vacuous)").toBeGreaterThan(0);
    const marked = new Set(tr.enters.flatMap((e) => e.items.filter((i) => i.live || i.mine).map((i) => i.id)));
    expect.soft(must.filter((id) => !marked.has(id)), "every live game and your team shown, marked live or yours").toEqual([]);
  });
}

test("a truly short widget keeps a page's column width, left-aligned (SCROLLR-292)", async ({ page }) => {
  // One NFL game in the whole week: nothing can fill the page. The game is
  // drawn at a full page's column width from the label, not stretched across
  // the bar (and not floated to the middle, away from its label).
  await parkMouse(page);
  await page.goto(url("onegame"));
  await parkMouse(page);
  const el = page.locator("[data-page]").first();
  await el.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const m = await el.evaluate((p) => {
    const box = p.getBoundingClientRect();
    const cells = [...p.querySelectorAll("[data-chip]")].map((c) => c.getBoundingClientRect());
    return { short: p.hasAttribute("data-short"), cols: Number(p.getAttribute("data-cols")), left: box.left, width: box.width, cells: cells.map((c) => ({ left: c.left, width: c.width })) };
  });
  expect(m.short).toBe(true);
  expect(m.cells).toHaveLength(1);
  expect(m.cols).toBeGreaterThan(1);
  expect(Math.abs(m.cells[0].width - m.width / m.cols), "one column of a full page").toBeLessThan(2);
  expect(Math.abs(m.cells[0].left - m.left), "starts at the label").toBeLessThan(2);
});

test("a 30-headline feed: one page a visit, 1, 2, 3 ... 8, 1, a refresh keeps the place, every headline in 8 laps (SCROLLR-293/294)", async ({ page, context }) => {
  // NPR with 30 headlines over six days, at 1920: 4 columns, 8 pages. A
  // visit is one page, continuing where the last one stopped. The live sim writes the dashboard
  // every 4 s (a refresh, a re-plan); on top of that a refresh with a NEW
  // headline lands while page 4 is up. Neither may send the widget back to
  // page 1.
  test.setTimeout(300_000);
  await context.clock.install();
  await page.setViewportSize({ width: 1920, height: 80 });
  await recordFromStart(page);
  await page.goto(url("npr"));
  await page.waitForSelector("[data-page]");
  const ids: string[] = JSON.parse(readFileSync("src/dev/__fixtures__/dashboard.npr.json", "utf8")).data.rss.map((r: { id: number }) => String(r.id));
  expect(ids).toHaveLength(30);

  await runUntil(context.clock, async () => (await readTrace(page)).enters.some((e) => e.index === 3), CAP_MS, 500);
  await page.evaluate(() =>
    window.__shimDashboard!((d) => {
      const rss = d.data.rss as { id: number }[];
      const now = new Date().toISOString();
      return { ...d, data: { ...d.data, rss: [{ ...rss[0], id: 949999, guid: "npr-new", title: "A refresh landed in the middle of a visit", published_at: now, created_at: now }, ...rss] } };
    }),
  );
  await runUntil(context.clock, async () => visits((await readTrace(page)).enters).length > 9);
  const tr = await readTrace(page);
  const v = visits(tr.enters);
  console.log(`[npr visits] ${v.map((x) => x.pages.map((p) => p + 1).join(",")).join(" | ")}`);
  expect(v.slice(0, 9).map((x) => x.pages)).toEqual([[0], [1], [2], [3], [4], [5], [6], [7], [0]]);
  expect(tr.enters.find((e) => e.index === 4)?.pos, "the label counts the page").toBe("5/8");
  const firstVisit = tr.enters[0].visit;
  const seen = new Set(tr.enters.filter((e) => e.visit < firstVisit + 9).flatMap((e) => e.items.map((i) => i.id)));
  expect(ids.filter((id) => !seen.has(id)), "every headline seen within 8 laps").toEqual([]);
  expect(seen.has("949999"), "the refresh's new headline reached the bar").toBe(true);
});

test("the label's counter fits its 112 px at two-digit pages, beside the fact (SCROLLR-293)", async ({ page, context }) => {
  // At 1280: NPR is 15 pages of 2 (the fact gives way to "10/15"), and the
  // busy Saturday's NCAAF is 14 pages of 4 ("n LIVE" or "SAT 3" beside
  // "10/14"). Run until each shows a two-digit page; nothing in the label is cut.
  test.setTimeout(300_000);
  await context.clock.install();
  await page.setViewportSize({ width: 1280, height: 80 });
  for (const fixture of ["npr", "busy"]) {
    await recordFromStart(page);
    await page.goto(url(fixture));
    await page.waitForSelector("[data-page]");
    await runUntil(context.clock, async () => (await readTrace(page)).enters.some((e) => e.index >= 9 && e.count >= 10));
    const tr = await readTrace(page);
    const two = tr.enters.find((e) => e.index >= 9 && e.count >= 10)!;
    console.log(`[label ${fixture}] ${two.page}: "${two.fact}" ${two.pos}`);
    expect(two.pos).toBe(`${two.index + 1}/${two.count}`);
    expect(tr.enters.filter((e) => e.factCut).map((e) => `${e.page}: "${e.fact}" beside ${e.pos}`), `${fixture}: the fact fits beside the counter`).toEqual([]);
    const fits = await page.evaluate(() => {
      const label = document.querySelector("[data-label]")!.getBoundingClientRect();
      const pos = document.querySelector("[data-label] [data-pos]")?.getBoundingClientRect();
      return !pos || pos.right <= label.right;
    });
    expect(fits, `${fixture}: the counter is inside the label`).toBe(true);
  }
});

test("two ticker windows turn pages together", async ({ page, context }) => {
  // Real time: the two windows talk over a BroadcastChannel in real time,
  // which a fake clock does not carry (each page's clock runs on its own).
  // Four turns of the leader's 6+ s dwell.
  //
  // A turn is when a window's new `[data-page]` element appears (`turns`),
  // not when its swipe lands (`enters`): that needs a 250 ms poll and an
  // animation frame per window, so on a loaded runner the two windows'
  // samples drifted by more than the bound with nothing wrong in the app
  // (SCROLLR-289). Insertion time is the relay latency and nothing else.
  //
  // The pointer is parked below both bars (parkMouse): a hovered page holds,
  // and a stray hover on either window froze the whole test.
  test.setTimeout(120_000);
  await parkMouse(page);
  await page.goto(url("pages"));
  await parkMouse(page);
  const second = await context.newPage();
  await parkMouse(second);
  await second.goto(url("pages", "&label=ticker-2"));
  await parkMouse(second);
  await startRecording(page);
  await startRecording(second);

  // turns[0] is the page already up when the recorder installed: no real time.
  // Five turns of the longest dwell (12 s) fit well inside the timeout.
  await page.waitForFunction(() => window.__pg!.turns.length >= 5, null, { timeout: 90_000, polling: 250 }).catch(async (e) => {
    throw new Error(`the leader never turned: ${await hoverReport(page)} | follower ${await hoverReport(second)}\n${e}`);
  });
  const lead = (await readTrace(page)).turns.slice(1, 5);
  // The follower may be a relay behind the leader's newest turn; wait for it, then measure.
  await second.waitForFunction((pg) => window.__pg!.turns.some((x) => x.page === pg), lead[3].page, { timeout: 10_000, polling: 100 });
  const follow = (await readTrace(second)).turns.slice(1);

  for (const e of lead) {
    const m = follow.find((x) => x.page === e.page && Math.abs(x.t - e.t) < 2000);
    expect.soft(m, `second window showed ${e.page} (leader turned at ${new Date(e.t).toISOString()})`).toBeTruthy();
    if (m) expect.soft(Math.abs(m.t - e.t), `skew on ${e.page} (ms)`).toBeLessThanOrEqual(SKEW_MS);
    console.log(`[two windows] ${e.page} skew ${m ? Math.round(m.t - e.t) : "none"} ms`);
  }
});
