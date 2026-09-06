#!/usr/bin/env node
/**
 * Re-shoot the website's ticker screenshots from the running dev app.
 *
 *   make screenshots                      # everything (from the repo root)
 *   node scripts/capture-ticker.mjs --only sports,news --density compact --theme dark
 *   node scripts/capture-ticker.mjs --no-optimize
 *
 * For every channel x density x theme the site shows, this drives the
 * REAL app through the dev command bus (scripts/dev/devctl.mjs is the
 * hand-held version of the same calls): set the theme and density from
 * the main window, put only that channel's widgets on the bar, wait for
 * the ticker to fill, capture the ticker window pixel-exact
 * (scripts/dev/capture-window.ps1), crop it to the aspect the site lays
 * out for, and write it where optimize-screenshots.mjs already looks:
 *
 *   screenshot-sources-ticker/<density>/<theme>/<channel>-<theme>-<density>.png
 *
 * then runs the optimizer so public/screenshots/ticker/* is current.
 * Your prefs and which widgets are on your bar are put back afterwards.
 *
 * Needs: the desktop dev build running (make desktop), signed in, with a
 * seeded stack behind it (make seed; make live for scores that move).
 * Windows only, because the capture is.
 *
 * HONESTY BOUNDARY. The app in the shot is the real app, the data is the
 * dev seed advanced by `make live`: real teams and tickers, scores and
 * prices that are simulated. Caption as product shots, never as a
 * specific real day. Fantasy is not re-shot: there is no fantasy data in
 * the dev stack outside an NFL week, so its files are left as they are
 * (see desktop/fixtures/serve-fantasy-demo.mjs for that rig).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const site = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(site);
const PS1 = join(repo, "scripts", "dev", "capture-window.ps1");
const OUT = join(site, "screenshot-sources-ticker");
const BUS = process.env.SCROLLR_DEV_URL ?? "http://localhost:5174";

// What the site lays each row out for (TickerShowcase.tsx ASPECT_*).
const ASPECT = { compact: 2930 / 80, detailed: 2930 / 124 };
const MODE = { compact: "compact", detailed: "detailed" };
// Which server-backed widgets belong on the bar for each channel shot.
const CHANNELS = {
  sports: (id) => id.startsWith("sports_"),
  finance: (id) => id.startsWith("finance_"),
  news: (id) => id.startsWith("news_") || id.startsWith("rss_"),
  "all-purpose": (id) => !id.startsWith("fantasy"),
};
// Chips at 1.5x so a 3440-wide bar crops to roughly the old retina widths.
const SCALE = 150;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const list = (v, all) => (v ? v.split(",") : all);
const channels = list(arg("only"), Object.keys(CHANNELS));
const densities = list(arg("density"), Object.keys(ASPECT));
const themes = list(arg("theme"), ["dark", "light"]);
const optimize = !process.argv.includes("--no-optimize");

async function run(win, code, timeout = 10_000) {
  const res = await fetch(`${BUS}/__dev/cmd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ window: win, code, timeout }),
  }).catch(() => null);
  const body = await res?.json().catch(() => null);
  if (!body?.ok) throw new Error(`${win}: ${body?.error ?? "dev bus unreachable — is the desktop dev build running?"}`);
  return body.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(win, code, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await run(win, code)) return;
    await sleep(500);
  }
  const state = await run(win, `({ onBar: (qc.getQueryData(["dashboard"])?.widgets ?? []).filter(w => w.enabled !== false && w.ticker_enabled !== false).map(w => w.widget_type), data: Object.keys(qc.getQueryData(["dashboard"])?.data ?? {}), text: text().replace(/\s+/g, " ").slice(0, 120) })`).catch(() => null);
  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(state)}`);
}

// Prefs are always written from the main window: the ticker listens
// cross-window and ignores writes that match its own cache.
const setPrefs = (patch) =>
  run("main", `const p = prefs(); savePrefs({ ...p, appearance: { ...p.appearance, ...${JSON.stringify(patch.appearance ?? {})} }, ticker: { ...p.ticker, ...${JSON.stringify(patch.ticker ?? {})} }, widgets: { ...p.widgets, ...${JSON.stringify(patch.widgets ?? {})} } }); return true`);

// What is on the bar right now, by widget id -- the snapshot is what to
// restore, not what the previous shot left behind.
const onBar = new Map();
async function toggle(id, ticker, enabled) {
  const code = `const { toggleDataWidgetVisibility } = await import("/src/api/client.ts"); await toggleDataWidgetVisibility(${JSON.stringify(id)}, ${ticker}, ${enabled === undefined ? "undefined" : enabled}); return true`;
  try { await run("main", code); }
  catch { await sleep(1500); await run("main", code); } // one retry: the PATCH can fail while core hot-reloads
}
async function setRows(rows, wanted) {
  let changed = 0;
  for (const row of rows) {
    const on = wanted(row.id);
    if (on === onBar.get(row.id)) continue;
    await toggle(row.id, on, on ? true : undefined);
    onBar.set(row.id, on);
    changed++;
  }
  if (changed) await refresh();
  return changed;
}
async function restoreRows(rows) {
  const failed = [];
  for (const row of rows) {
    await toggle(row.id, !!row.ticker, !!row.enabled).catch(() => failed.push(row.id));
  }
  await refresh().catch(() => {});
  if (failed.length) console.error(`could not restore: ${failed.join(", ")} -- check the sidebar`);
}
async function refresh() {
  await run("main", `await qc.invalidateQueries({ queryKey: ["dashboard"] }); return true`, 20_000);
  await run("ticker", `await qc.invalidateQueries({ queryKey: ["dashboard"] }); return true`, 20_000);
}

async function capture(dest, aspect) {
  // Start the crop on a chip edge, not mid-chip: the first chip whose
  // left edge is inside the window, in device pixels.
  const left = await run("ticker", `Math.round(Math.min(...rects("[data-chip]").map(r => r.x).filter(x => x >= 0), 1e9) * devicePixelRatio)`);
  const tmp = join(mkdtempSync(join(tmpdir(), "scrollr-shot-")), "ticker.png");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, "-Title", "Scrollr Ticker", "-Out", tmp], { stdio: "pipe" });
  const meta = await sharp(tmp).metadata();
  const width = Math.round(meta.height * aspect);
  const x = left + width <= meta.width ? left : Math.max(0, meta.width - width);
  mkdirSync(dirname(dest), { recursive: true });
  await sharp(tmp).extract({ left: x, top: 0, width: Math.min(width, meta.width), height: meta.height }).png().toFile(dest);
  return `${Math.min(width, meta.width)}x${meta.height} @${x}`;
}

const snapshot = {
  prefs: await run("main", "prefs()"),
  rows: await run("main", `(qc.getQueryData(["dashboard"])?.widgets ?? []).map(w => ({ id: w.widget_type, enabled: w.enabled !== false, ticker: w.ticker_enabled !== false }))`),
};
if (snapshot.rows.length === 0) throw new Error("no widgets on the account — add some before shooting");
for (const row of snapshot.rows) onBar.set(row.id, row.ticker && row.enabled);

const shots = [];
try {
  for (const density of densities) {
    for (const theme of themes) {
      await setPrefs({
        appearance: { themeMode: theme, themeFamily: "scrollr", tickerScale: SCALE },
        // A crawl, so the chip edge measured before the capture is
        // still the chip edge in the capture (no way to pause the marquee).
        ticker: { showTicker: true, tickerMode: MODE[density], tickerSpeed: 5 },
      });
      await sleep(1500); // window re-sizes, AppBar re-registers
      for (const channel of channels) {
        const wanted = CHANNELS[channel];
        // Utilities come along only for the all-purpose shot.
        await setPrefs({ widgets: { widgetsOnTicker: channel === "all-purpose" ? snapshot.prefs.widgets.widgetsOnTicker : [] } });
        await setRows(snapshot.rows, wanted);
        await until("ticker", `rects("[data-chip]").length > 0`, 20_000, `${channel} chips`);
        await sleep(1500); // settle after the rows change
        const dest = join(OUT, density, theme, `${channel}-${theme}-${density}.png`);
        const size = await capture(dest, ASPECT[density]);
        shots.push(dest);
        console.log(`${density}/${theme}/${channel}\t${size}`);
      }
    }
  }
} finally {
  await setPrefs(snapshot.prefs).catch((e) => console.error(`could not restore prefs: ${e.message}`));
  await restoreRows(snapshot.rows);
  console.log(`restored your prefs and ${snapshot.rows.length} widget rows`);
}

if (optimize && shots.length) {
  execFileSync("node", [join(site, "scripts", "optimize-screenshots.mjs")], { stdio: "inherit", cwd: site });
}
console.log(`${shots.length} captures -> ${OUT}`);
