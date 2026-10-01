import { writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { installTickerAudit } from "./audit";
import { swapsWhileVisible, type AuditEntry } from "../../src/dev/tickerIdentity";
import { openShim } from "./shim";

/**
 * SCROLLR-266 scorecard: measures the bar against the six criteria
 * (lap, share per widget, chips per lap, jumps/resizes/holes, page-mode
 * pauses, CPU, where a click goes). Skipped unless SCORECARD=1, so
 * `npm run test:browser` and CI never run it. Run it headed: headless rAF
 * is throttled, so a motion trace there is fiction. One JSON (+ PNG) per
 * fixture x mode lands in SCORECARD_OUT.
 *
 *   SCORECARD=1 SCORECARD_OUT=out SHIM_PORT=5185 npx playwright test scorecard --headed
 *
 * SCORECARD_FIXTURES / SCORECARD_MODES (continuous,shots) /
 * SCORECARD_MS narrow a run. Each fixture x mode takes RUN_MS + ~40 s.
 */
const ON = !!process.env.SCORECARD;
const OUT = process.env.SCORECARD_OUT || ".";
const RUN_MS = Number(process.env.SCORECARD_MS) || 150_000;
const CPU_MS = 20_000;
const FIXTURES = (process.env.SCORECARD_FIXTURES || "default,busy,quiet,longnames").split(",");
const MODES = (process.env.SCORECARD_MODES || "continuous").split(",");

test.use({ viewport: { width: 1920, height: 120 } });
test.describe.configure({ retries: 0 });

/** Self-contained (serialised into the page): per-frame trace of every item on the rail. */
function installRecorder(cfg: { area: string; items: string }) {
  type Box = { l: number; w: number; vis: boolean };
  const ids = new WeakMap<Element, number>();
  let next = 1;
  const r = {
    frames: 0, dts: [] as number[], speeds: [] as number[],
    jumps: [] as { t: number; dx: number; med: number; text: string }[],
    resizes: [] as { t: number; from: number; to: number; text: string }[],
    holeFrames: 0, noChipFrames: 0, maxHole: 0,
    entries: [] as { t: number; key: string; id: number }[],
    stills: [] as { t: number; dur: number; cutL: number; cutR: number; cutPx: number }[],
    t0: performance.now(), running: true,
  };
  (window as unknown as { __sc: typeof r }).__sc = r;
  let prev = new Map<number, Box>();
  let lastT = 0;
  let stillStart = -1;
  let stillCut = { cutL: 0, cutR: 0, cutPx: 0 };
  const tick = (t: number) => {
    if (!r.running) return;
    const area = document.querySelector(cfg.area);
    if (area) {
      const a = area.getBoundingClientRect();
      const cur = new Map<number, Box>();
      const dxs: number[] = [];
      const vis: [number, number][] = [];
      let cutL = 0, cutR = 0, cutPx = 0;
      const els = area.querySelectorAll(cfg.items);
      for (const el of els) {
        let id = ids.get(el);
        if (!id) { id = next++; ids.set(el, id); }
        const b = el.getBoundingClientRect();
        const v = b.right > a.left + 0.5 && b.left < a.right - 0.5 && b.width > 0;
        cur.set(id, { l: b.left, w: b.width, vis: v });
        if (!v) continue;
        vis.push([Math.max(b.left, a.left), Math.min(b.right, a.right)]);
        if (b.left < a.left - 0.5) { cutL++; cutPx = Math.max(cutPx, a.left - b.left); }
        if (b.right > a.right + 0.5) { cutR++; }
        const p = prev.get(id);
        if (!p || !p.vis) r.entries.push({ t: t - r.t0, key: (el.textContent || "").slice(0, 60), id });
        if (p && p.vis) {
          dxs.push(b.left - p.l);
          if (Math.abs(b.width - p.w) > 0.5)
            r.resizes.push({ t: t - r.t0, from: p.w, to: b.width, text: (el.textContent || "").slice(0, 40) });
        }
      }
      if (lastT) {
        const dt = t - lastT;
        r.dts.push(dt);
        dxs.sort((x, y) => x - y);
        const med = dxs.length ? dxs[dxs.length >> 1] : 0;
        if (dxs.length) {
          r.speeds.push((med / dt) * 1000);
          // Every chip on screen moves with the rail; one that does not jumped.
          for (const el of els) {
            const id = ids.get(el)!;
            const c = cur.get(id)!, p = prev.get(id);
            if (c.vis && p && p.vis && Math.abs(c.l - p.l - med) > 1)
              r.jumps.push({ t: t - r.t0, dx: c.l - p.l, med, text: (el.textContent || "").slice(0, 40) });
          }
        }
        const moving = Math.abs(med) > 0.05;
        if (!moving && stillStart < 0) { stillStart = t; stillCut = { cutL, cutR, cutPx }; }
        if (moving && stillStart >= 0) {
          if (t - stillStart > 500) r.stills.push({ t: stillStart - r.t0, dur: t - stillStart, ...stillCut });
          stillStart = -1;
        }
      }
      // Holes: the widest stretch of the rail with no chip on it.
      vis.sort((x, y) => x[0] - y[0]);
      let edge = a.left, hole = 0;
      for (const [l, rt] of vis) { hole = Math.max(hole, l - edge); edge = Math.max(edge, rt); }
      hole = Math.max(hole, a.right - edge);
      r.maxHole = Math.max(r.maxHole, hole);
      if (!vis.length) r.noChipFrames++;
      else if (hole > 100) r.holeFrames++;
      prev = cur;
      lastT = t;
      r.frames++;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Static facts about the rail: what is on one lap and whose it is. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const ul = document.querySelector(".ticker-scroll-wrapper ul")!;
    const gap = parseFloat(getComputedStyle(ul).gap || "0") || 0;
    const area = document.querySelector(".ticker-scroll-wrapper")!.getBoundingClientRect();
    const chips = [...ul.querySelectorAll<HTMLElement>("li.ticker-item")].map((li) => {
      const c = li.querySelector<HTMLElement>("[data-chip]");
      const btn = li.querySelector("button");
      const truncated = [...li.querySelectorAll<HTMLElement>("*")].filter(
        (e) => !e.closest("[aria-hidden=true]") && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1,
      ).length;
      const cls = li.innerHTML;
      return {
        widget: c?.dataset.widget || "?",
        slot: c?.dataset.rotateSlot || null,
        status: c?.hasAttribute("data-status") || false,
        width: li.getBoundingClientRect().width,
        text: (btn?.innerText || li.innerText || "").replace(/\s+/g, " ").slice(0, 90),
        live: !!li.querySelector(".bg-live:not(.invisible)"),
        final: cls.includes("opacity-[0.82]"),
        staleNews: cls.includes("text-fg/55"),
        truncated,
      };
    });
    return {
      gap,
      areaWidth: area.width,
      clones: ul.querySelectorAll("li.clone-item").length,
      pinned: document.querySelectorAll(".ticker-pinned-zone [data-chip]").length,
      track: chips.reduce((w, c) => w + c.width + gap, 0),
      chips,
    };
  });
}

async function cpu(page: Page, ms: number) {
  const s = await page.context().newCDPSession(page);
  await s.send("Performance.enable");
  const get = async () =>
    Object.fromEntries((await s.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const a = await get();
  await page.waitForTimeout(ms);
  const b = await get();
  const d = (k: string) => (b[k] - a[k]) / (ms / 1000);
  return {
    taskPct: d("TaskDuration") * 100,
    scriptPct: d("ScriptDuration") * 100,
    layoutPct: d("LayoutDuration") * 100,
    stylePct: d("RecalcStyleDuration") * 100,
    layoutsPerSec: d("LayoutCount"),
  };
}

async function trace(page: Page, ms: number, cfg = { area: ".ticker-scroll-wrapper", items: "li.ticker-item, li.clone-item" }) {
  await page.evaluate(installRecorder, cfg);
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const r = (window as unknown as { __sc: Record<string, unknown> & { running: boolean } }).__sc;
    r.running = false;
    return r;
  });
}

/** Click one chip per widget and record what the click asked the host to do. */
async function clicks(page: Page) {
  const widgets: string[] = await page.$$eval("li.ticker-item [data-chip]", (els) => [
    ...new Set(els.map((e) => (e as HTMLElement).dataset.widget || "?")),
  ]);
  const out: Record<string, string[]> = {};
  for (const w of widgets) {
    const n = await page.evaluate(() => (window as unknown as { __shimCalls: string[] }).__shimCalls.length);
    await page.evaluate((w) => {
      const b = document.querySelector<HTMLElement>(`li.ticker-item [data-chip][data-widget="${w}"] button, li.ticker-item [data-chip][data-widget="${w}"][role=button]`)
        ?? document.querySelector<HTMLElement>(`li.ticker-item [data-chip][data-widget="${w}"]`);
      b?.click();
    }, w);
    await page.waitForTimeout(400);
    out[w] = await page.evaluate(
      (n) => (window as unknown as { __shimCalls: string[] }).__shimCalls.slice(n).filter((c) => !c.startsWith("plugin:store") && !c.startsWith("plugin:event")),
      n,
    );
  }
  return out;
}

for (const fixture of FIXTURES) {
  for (const mode of MODES.filter((m) => m === "continuous")) {
    test(`scorecard ${fixture} ${mode}`, async ({ page }) => {
      test.skip(!ON, "opt-in: SCORECARD=1, headed");
      test.setTimeout(RUN_MS + CPU_MS + 120_000);
      await page.addInitScript(installTickerAudit);
      await openShim(page, `?fixture=${fixture}`);
      await page.waitForTimeout(2000);
      const snap = await snapshot(page);
      const load = await cpu(page, CPU_MS);
      const tr = await trace(page, RUN_MS);
      const audit = await page.evaluate(() => (window as unknown as { __tickerAudit: AuditEntry[] }).__tickerAudit);
      const swaps = swapsWhileVisible(audit);
      const shot = `${OUT}/${fixture}-${mode}.png`;
      await page.screenshot({ path: shot });
      const click = await clicks(page);
      writeFileSync(
        `${OUT}/${fixture}-${mode}.json`,
        JSON.stringify({ fixture, mode, snap, cpu: load, trace: tr, swaps, mutations: audit.length, click }, null, 1),
      );
    });
  }
}

/** Dark-theme captures of the bar itself, for the report. */
for (const fixture of FIXTURES) {
  test(`shot ${fixture}`, async ({ page }) => {
    test.skip(!ON || !MODES.includes("shots"), "opt-in: SCORECARD_MODES includes shots");
    await page.emulateMedia({ colorScheme: "dark" });
    await openShim(page, `?fixture=${fixture}`);
    await page.waitForTimeout(3000);
    await page.locator(".ticker-container").first().screenshot({ path: `${OUT}/shot-${fixture}.png` });
  });
}
