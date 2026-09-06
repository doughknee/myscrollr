/**
 * Window side of the dev command bus (see desktop/scripts/dev-bus.ts).
 *
 * Long-polls the dev server for code to run in this window, runs it with
 * `ctx` in scope, posts the result back. Dev builds only: the whole
 * module is behind `import.meta.env.DEV`, which Vite folds to `false` in
 * a production build, so none of this is in a release.
 *
 * What a command can reach, by name:
 *   prefs()      current AppPreferences          savePrefs(p)  persist + broadcast
 *   store        lib/store (getStore, setStore..) qc            the QueryClient
 *   invoke       Tauri invoke                     router        (main window only)
 *   text(sel?)   innerText of sel or body         html(sel)     outerHTML
 *   rect(sel)    bounding rect                    rects(sel)    every match
 *   sleep(ms)
 * plus anything via `await import("/src/…")`, which Vite serves in dev.
 */
import { invoke } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";
import * as store from "../lib/store";
import { loadPrefs, savePrefs } from "../preferences";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r = (el: Element) => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

/** `win` is the Tauri window label: "main", "ticker", "ticker-2", … */
export function startDevBus(win: string, extra: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  const ctx: Record<string, unknown> = {
    prefs: loadPrefs,
    savePrefs,
    store,
    invoke,
    sleep,
    text: (sel?: string) => (sel ? document.querySelector(sel) : document.body)?.textContent ?? null,
    html: (sel: string) => document.querySelector(sel)?.outerHTML ?? null,
    rect: (sel: string) => { const el = document.querySelector(sel); return el ? r(el) : null; },
    rects: (sel: string) => Array.from(document.querySelectorAll(sel)).map(r),
    ...extra,
  };
  const names = Object.keys(ctx);

  const run = async (code: string): Promise<unknown> => {
    const head = `const {${names.join(",")}} = ctx;`;
    let fn: (ctx: unknown) => Promise<unknown>;
    try {
      fn = new Function("ctx", `${head} return (async () => (${code}))();`) as typeof fn;
    } catch {
      fn = new Function("ctx", `${head} return (async () => { ${code} })();`) as typeof fn;
    }
    return fn(ctx);
  };

  const serialisable = (v: unknown): unknown => {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
  };

  void (async () => {
    for (;;) {
      try {
        const res = await fetch(`/__dev/poll?window=${win}`);
        if (res.status !== 200) continue;
        const { id, code } = (await res.json()) as { id: number; code: string };
        let body: Record<string, unknown>;
        try {
          body = { id, ok: true, value: serialisable(await run(code)) };
        } catch (err) {
          body = { id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        }
        await fetch("/__dev/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch {
        await sleep(1000);
      }
    }
  })();
}
