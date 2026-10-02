import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * What the widget-pages checks measure with (SCROLLR-275), shared by
 * pages.spec.ts (CI, on a fake clock) and the opt-in scorecard (real rAF).
 * Ported from the SCROLLR-268 prototype's measure/analyze scripts.
 *
 * The rules, learned the hard way:
 *  - A page is "up" only once it is the ONLY `[data-page]` and its transform
 *    is none. Anything else is a swipe.
 *  - A page already showing when the recorder installs is `initial`: its
 *    real up time is unknown, so it never counts toward a dwell or a lap.
 *    `recordFromStart` installs before the page exists, so the first page
 *    is timed exactly and nothing is skipped.
 *  - Time comes from a MutationObserver (plus a 250 ms poll for layout that
 *    changes without a mutation), not requestAnimationFrame: a hidden
 *    window's rAF stalls.
 */

export interface SeenItem {
  id: string;
  live: boolean;
  mine: boolean;
}

export interface Enter {
  /** Epoch ms (timeOrigin + performance.now(), so two windows compare) at which the page became "up". */
  t: number;
  /** `sports_nfl:2/3` */
  page: string;
  tab: string;
  /** 0-based */
  index: number;
  count: number;
  /** The leader's turn counter (`data-visit`): one page is one visit (SCROLLR-297). */
  visit: number;
  /** The label's position counter ("2/8"), or null when the widget has one page. */
  pos: string | null;
  /** The label's fact line ("6 LIVE") as drawn, and whether the counter beside it cut it short. */
  fact: string | null;
  factCut: boolean;
  items: SeenItem[];
  initial: boolean;
  /** The page's `data-cols` / `data-total` / `data-avail` (PagedBar): a full page's columns, the widget's items over its pages, what it could have shown. */
  cols: number;
  total: number;
  avail: number;
}

export interface Moved {
  t: number;
  page: string;
  id: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface Cut {
  t: number;
  page: string;
  id: string;
}

/** A page element entering the DOM: the moment a window starts turning to it (before its swipe). */
export interface Turn {
  t: number;
  page: string;
}

export interface PagesTrace {
  enters: Enter[];
  /** Every `[data-page]` element as it appears, swipe start. Needs no polling and no animation frame, so it is the clock for comparing two windows. */
  turns: Turn[];
  moved: Moved[];
  cuts: Cut[];
  /** Frames seen while a swipe was in flight (real-rAF runs only). */
  swipeFrames: number;
  frameDts: number[];
}

declare global {
  interface Window {
    __pg?: PagesTrace & { running: boolean };
    /** src/dev/liveSim.ts (`?live=1`): write the dashboard cache as a refetch would. */
    __shimDashboard?: (update: (prev: { data: Record<string, unknown> }) => unknown) => void;
  }
}

/** Self-contained (serialised into the page). Call after the first page is up. */
export function installPagesRecorder(opts: { frames: boolean }) {
  const r: NonNullable<Window["__pg"]> = { enters: [], turns: [], moved: [], cuts: [], swipeFrames: 0, frameDts: [], running: true };
  window.__pg = r;
  let installing = true;
  let cur: Element | null = null;
  let rects = new Map<string, { l: number; t: number; w: number; h: number }>();

  const isUp = (pages: NodeListOf<Element>) =>
    pages.length === 1 && getComputedStyle(pages[0]).transform === "none";

  const seen = new WeakSet<Element>();
  const check = () => {
    if (!r.running) return;
    const pages = document.querySelectorAll("[data-page]");
    for (const p of pages) {
      if (seen.has(p)) continue;
      seen.add(p);
      r.turns.push({ t: performance.timeOrigin + performance.now(), page: p.getAttribute("data-page")! });
    }
    if (!isUp(pages)) return;
    const el = pages[0];
    const t = performance.timeOrigin + performance.now();
    const label = el.getAttribute("data-page")!;
    const area = el.getBoundingClientRect();
    const cells = [...el.querySelectorAll<HTMLElement>("[data-chip]")];
    const fresh = el !== cur;
    if (fresh) {
      const [tab, pos] = label.split(":");
      const [i, n] = pos.split("/").map(Number);
      cur = el;
      rects = new Map();
      const num = (a: string) => Number(el.getAttribute(a));
      r.enters.push({
        t, page: label, tab, index: i - 1, count: n, visit: num("data-visit"), initial: installing,
        pos: document.querySelector(`[data-label="${tab}"] [data-pos]`)?.textContent ?? null,
        ...((f) => ({ fact: f?.textContent ?? null, factCut: !!f && f.scrollWidth > f.clientWidth }))(document.querySelector<HTMLElement>(`[data-label="${tab}"] [data-fact]`)),
        cols: num("data-cols"), total: num("data-total"), avail: num("data-avail"),
        items: cells.map((c) => ({ id: c.dataset.item!, live: c.hasAttribute("data-live"), mine: c.hasAttribute("data-mine") })),
      });
    }
    for (const c of cells) {
      const id = c.dataset.item!;
      const b = c.getBoundingClientRect();
      if (b.left < area.left - 1 || b.right > area.right + 1 || b.top < area.top - 1 || b.bottom > area.bottom + 1) r.cuts.push({ t, page: label, id });
      const o = rects.get(id);
      if (o && (Math.abs(o.l - b.left) > 0.5 || Math.abs(o.t - b.top) > 0.5 || Math.abs(o.w - b.width) > 0.5 || Math.abs(o.h - b.height) > 0.5))
        r.moved.push({ t, page: label, id, dx: b.left - o.l, dy: b.top - o.t, dw: b.width - o.w, dh: b.height - o.h });
      rects.set(id, { l: b.left, t: b.top, w: b.width, h: b.height });
    }
  };

  check();
  installing = false;
  new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  setInterval(check, 250);

  if (opts.frames) {
    let last = 0;
    const tick = (t: number) => {
      if (!r.running) return;
      if (document.querySelectorAll("[data-page]").length > 1 && last) {
        r.frameDts.push(t - last);
        r.swipeFrames++;
      }
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/**
 * Park the mouse just below the bar. A page under the pointer HOLDS (the bar
 * stands still while hovered, SCROLLR-281), and a pointer that Chromium
 * thinks is over the bar when the page opens freezes the leader's clock for
 * the whole test: the bar sat on its first page for the full 40-60 s timeout
 * in CI, then passed on rerun (SCROLLR-289). Call before `goto` and again
 * after, as `openShim` does for the continuous bar.
 */
export async function parkMouse(page: Page) {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height - 1);
}

/** What is under the pointer and held, for a failure message. */
export function hoverReport(page: Page) {
  return page.evaluate(() => `hover=[${[...document.querySelectorAll(":hover")].map((e) => e.tagName.toLowerCase() + (e.getAttribute("data-pages") !== null ? "[data-pages]" : "")).join(" ")}] pages=${[...document.querySelectorAll("[data-page]")].map((e) => e.getAttribute("data-page")).join(",")}`);
}

export async function startRecording(page: Page, frames = false) {
  await page.waitForSelector("[data-page]");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installPagesRecorder, { frames });
}

/** Install at document start (call before `goto`): the first page is then a real enter. */
export async function recordFromStart(page: Page, frames = false) {
  await page.addInitScript(
    `document.addEventListener("DOMContentLoaded", () => (${installPagesRecorder.toString()})(${JSON.stringify({ frames })}))`,
  );
}

export function readTrace(page: Page): Promise<PagesTrace> {
  return page.evaluate(() => {
    const r = window.__pg!;
    return { enters: r.enters, turns: r.turns, moved: r.moved, cuts: r.cuts, swipeFrames: r.swipeFrames, frameDts: r.frameDts };
  });
}

export function stopRecording(page: Page): Promise<PagesTrace> {
  return page.evaluate(() => {
    const r = window.__pg!;
    r.running = false;
    return { enters: r.enters, turns: r.turns, moved: r.moved, cuts: r.cuts, swipeFrames: r.swipeFrames, frameDts: r.frameDts };
  });
}

// ── Analysis ───────────────────────────────────────────────────────

/** Seconds each page was up before the next one swiped in (an initial page never counts; the last one is still up). */
export function dwells(enters: readonly Enter[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < enters.length - 1; i++) if (!enters[i].initial) out.push((enters[i + 1].t - enters[i].t) / 1000);
  return out;
}

/**
 * Lap boundaries: the first page of each visit to the first widget seen.
 * A visit no longer always opens on page 1 (a widget with nothing live
 * continues where it left off, SCROLLR-293), so a visit starts where the
 * leader's visit counter changes. An initial page may be mid-visit and is
 * skipped.
 */
export function lapStarts(enters: readonly Enter[]): number[] {
  const w0 = enters[0]?.tab;
  const out: number[] = [];
  enters.forEach((e, i) => {
    if (!e.initial && e.tab === w0 && (i === 0 || enters[i - 1].visit !== e.visit)) out.push(i);
  });
  return out;
}

/** Each visit's page indexes (0-based), in order: [[0,1,2],[3,4,5],…]. An initial page's visit is dropped (it may be partial). */
export function visits(enters: readonly Enter[]): { tab: string; pages: number[] }[] {
  const out: { tab: string; visit: number; pages: number[] }[] = [];
  for (const e of enters) {
    if (e.initial) continue;
    const last = out.at(-1);
    if (last?.visit === e.visit) last.pages.push(e.index);
    else out.push({ tab: e.tab, visit: e.visit, pages: [e.index] });
  }
  return out.map(({ tab, pages }) => ({ tab, pages }));
}

/** Lap lengths in seconds. */
export function laps(enters: readonly Enter[]): number[] {
  const s = lapStarts(enters);
  return s.slice(1).map((e, k) => (enters[e].t - enters[s[k]].t) / 1000);
}

/**
 * Seconds from the first lap's start until every page of every widget has
 * been up and dwelt (SCROLLR-294, the scorecard's "all shown"): the widgets
 * are the first lap's, each widget's page count its latest, and the time is
 * when the last page still missing swipes out. Null until then.
 */
export function allShown(enters: readonly Enter[]): number | null {
  const s = lapStarts(enters);
  if (s.length < 2) return null;
  const tabs = new Set(enters.slice(s[0], s[1]).map((e) => e.tab));
  const seen = new Map<string, Set<number>>();
  const count = new Map<string, number>();
  for (let i = s[0]; i < enters.length - 1; i++) {
    const e = enters[i];
    count.set(e.tab, e.count);
    seen.set(e.tab, (seen.get(e.tab) ?? new Set()).add(e.index));
    const whole = (t: string) => Array.from({ length: count.get(t) ?? 1 }, (_, k) => k).every((k) => seen.get(t)?.has(k));
    if (i >= s[1] - 1 && [...tabs].every(whole)) {
      return (enters[i + 1].t - enters[s[0]].t) / 1000;
    }
  }
  return null;
}

/**
 * One page per widget per lap, in order (SCROLLR-297). Each full lap shows
 * every widget once, and each widget's pages run 1, 2 ... N, 1 from its
 * first visit: the next is the last one plus one, wrapped on the count it
 * had then and on the count it has now (a refresh may re-plan). Returns
 * what broke it.
 */
export function pageOrder(enters: readonly Enter[]): string[] {
  const out: string[] = [];
  const s = lapStarts(enters);
  for (let k = 1; k < s.length; k++) {
    const tabs = enters.slice(s[k - 1], s[k]).map((e) => e.tab);
    if (new Set(tabs).size !== tabs.length) out.push(`lap ${k}: ${tabs.join(",")}`);
  }
  const last = new Map<string, Enter>();
  for (const e of enters) {
    if (e.initial) continue;
    const p = last.get(e.tab);
    const want = p ? ((p.index + 1) % p.count) % e.count : 0;
    if (e.index !== want) out.push(`${e.page} after ${p?.page ?? "nothing"}: want page ${want + 1}`);
    last.set(e.tab, e);
  }
  return out;
}

/**
 * Live and yours lead their widget (SCROLLR-297): across each widget's
 * pages in order, the items marked live or yours come before every other
 * item, so page 1 is the live/yours page. Returns what broke it.
 */
export function topFirst(enters: readonly Enter[]): string[] {
  const byTab = new Map<string, Map<number, SeenItem[]>>();
  for (const e of enters) byTab.set(`${e.tab}/${e.count}`, (byTab.get(`${e.tab}/${e.count}`) ?? new Map()).set(e.index, e.items));
  const out: string[] = [];
  for (const [tab, pages] of byTab) {
    const flat = [...pages.keys()].sort((a, b) => a - b).flatMap((i) => pages.get(i)!.map((it) => ({ i, top: it.live || it.mine, id: it.id })));
    const firstRest = flat.findIndex((x) => !x.top);
    const late = firstRest < 0 ? [] : flat.slice(firstRest).filter((x) => x.top);
    if (late.length) out.push(`${tab}: ${late.map((x) => `${x.id} on page ${x.i + 1}`).join(", ")} after other items`);
  }
  return out;
}

/** Ids a lap showed, one set per full lap. */
export function itemsPerLap(enters: readonly Enter[]): Set<string>[] {
  const s = lapStarts(enters);
  return s.slice(1).map((end, k) => new Set(enters.slice(s[k], end).flatMap((e) => e.items.map((i) => i.id))));
}

/**
 * Game ids that lead their widget: live now, or one of the user's teams
 * (the widget's `favoriteTeams`). Read from the fixture, so a bar that
 * never drew one cannot hide behind "nothing was seen live".
 */
export function mustSeeIds(fixture: string): string[] {
  const d = JSON.parse(readFileSync(`src/dev/__fixtures__/dashboard.${fixture}.json`, "utf8"));
  const mine = new Set<string>();
  for (const w of d.widgets ?? []) {
    for (const f of Object.values<{ teamName?: string }>(w.config?.favoriteTeams ?? {})) if (f?.teamName) mine.add(f.teamName);
  }
  const games: { id: string | number; state: string; home_team_name: string; away_team_name: string }[] = d.data?.sports ?? [];
  return games
    .filter((g) => g.state === "in" || g.state === "in_progress" || mine.has(g.home_team_name) || mine.has(g.away_team_name))
    .map((g) => String(g.id));
}

/**
 * Every page is full (SCROLLR-292). A widget on one page shows
 * `min(columns, available)` items, where available is its own items plus
 * every fill it may use; a widget on several pages shows a full page each
 * time, unless its fill ran out (then the pages split evenly, never a
 * lonely last page, and no page holds fewer than its share). Returns the
 * pages that broke it.
 */
export function unfilled(enters: readonly Enter[]): string[] {
  return enters.flatMap((e) => {
    const n = e.items.length;
    const want =
      e.count === 1 ? Math.min(e.cols, e.avail)
      : e.total === e.count * e.cols ? e.cols
      : Math.floor(e.total / e.count);
    const ok = e.count === 1 || e.total === e.count * e.cols ? n === want : n >= want && n <= e.cols;
    return ok ? [] : [`${e.page}: ${n} items, want ${want} (cols ${e.cols}, total ${e.total}, avail ${e.avail})`];
  });
}

/** Seconds on screen per widget, as a share of the run: the "widget share" criterion. */
export function shareByWidget(enters: readonly Enter[]): Record<string, number> {
  const secs: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < enters.length - 1; i++) {
    if (enters[i].initial) continue;
    const d = (enters[i + 1].t - enters[i].t) / 1000;
    secs[enters[i].tab] = (secs[enters[i].tab] ?? 0) + d;
    total += d;
  }
  return Object.fromEntries(Object.entries(secs).map(([k, v]) => [k, Math.round((v / (total || 1)) * 1000) / 1000]));
}
