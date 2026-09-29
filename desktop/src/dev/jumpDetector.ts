/**
 * Ticker jump detector (SCROLLR-255). Dev builds only.
 *
 * "The bar jumps on its own": something moves or resizes an on-screen chip
 * that is not the scroll. Web mode cannot exercise the Rust window layer or
 * production CDC pushes, so this runs inside the real ticker window and
 * writes one JSON line per detected jump to Scrollr.log, with the last 5 s
 * of things that could have caused it (invokes, SSE, store updates, resize,
 * visibility, font loads).
 *
 * Every 100 ms (a timer, not rAF, so an unfocused window keeps checking)
 * it snapshots the chips on screen, pairs them with the previous snapshot
 * by identity key + nearest position, and flags any chip whose move differs
 * from the median move by > 2 px, whose width changed by > 0.5 px, or that
 * appeared/vanished while fully on screen. Nothing here fixes anything.
 *
 * Reached only through a dynamic import behind `import.meta.env.DEV` in
 * main.tsx, so Vite drops the whole module from a release build.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getStore, onStoreChange } from "../lib/store";
import { identity } from "./tickerIdentity";

export interface Snap { key: string; x: number; w: number }
export interface Bounds { left: number; right: number }
export interface Flag {
  key: string;
  jumpPx: number;
  widthBefore: number;
  widthAfter: number;
  swapped: "appeared" | "disappeared" | null;
}

const TICK_MS = 100;
const MOVE_PX = 2;
const WIDTH_PX = 0.5;
const INSIDE_PX = 60;
const MATCH_PX = 500; // covers a Page-mode step (~270 px) landing inside one tick
const CONTEXT_MS = 5000;
const CONTEXT_MAX = 80;
const COOLDOWN_MS = 1000;
const MAX_LINES_PER_MIN = 10;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fullyInside = (s: Snap, b: Bounds) => s.x >= b.left + INSIDE_PX && s.x + s.w <= b.right - INSIDE_PX;

/**
 * Pure comparison of two snapshots of the on-screen chips. Pairs each chip
 * with the same-key predecessor nearest its old position (loop clones share
 * a key but sit a full pool-width apart), then flags what the scroll cannot
 * explain. ponytail: a lone matched chip has median == its own move, so
 * nothing can be flagged as a move; widths and swaps still are.
 */
export function detect(prev: Snap[], cur: Snap[], bounds: Bounds): Flag[] {
  const free = [...prev];
  const pairs: { p: Snap; c: Snap }[] = [];
  const unmatched: Snap[] = [];
  for (const c of cur) {
    let best = -1;
    for (let i = 0; i < free.length; i++) {
      if (free[i].key !== c.key) continue;
      if (best < 0 || Math.abs(free[i].x - c.x) < Math.abs(free[best].x - c.x)) best = i;
    }
    if (best >= 0 && Math.abs(free[best].x - c.x) <= MATCH_PX) pairs.push({ p: free.splice(best, 1)[0], c });
    else unmatched.push(c);
  }
  const flags: Flag[] = [];
  const med = pairs.length ? median(pairs.map(({ p, c }) => c.x - p.x)) : 0;
  for (const { p, c } of pairs) {
    const jumpPx = c.x - p.x - med;
    if (Math.abs(jumpPx) > MOVE_PX || Math.abs(c.w - p.w) > WIDTH_PX) {
      flags.push({ key: c.key, jumpPx, widthBefore: p.w, widthAfter: c.w, swapped: null });
    }
  }
  for (const c of unmatched) {
    if (fullyInside(c, bounds)) flags.push({ key: c.key, jumpPx: 0, widthBefore: 0, widthAfter: c.w, swapped: "appeared" });
  }
  for (const p of free) {
    if (fullyInside(p, bounds)) flags.push({ key: p.key, jumpPx: 0, widthBefore: p.w, widthAfter: 0, swapped: "disappeared" });
  }
  return flags;
}

const SECRETISH = /token|secret|auth|password|code|verifier|state|header|body/i;

/** Args worth logging: scalars only, secret-looking keys and long strings dropped. */
export function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const out: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (SECRETISH.test(k)) continue;
    if (typeof v === "number" || typeof v === "boolean") out.push(`${k}=${v}`);
    else if (typeof v === "string") out.push(`${k}=${v.length > 32 ? v.slice(0, 32) + "…" : v}`);
    else if (v !== null && v !== undefined) out.push(`${k}=[${Array.isArray(v) ? `${v.length} items` : "object"}]`);
  }
  return out.join(" ");
}

/** Item counts per source in a dashboard payload, for the store-update context. */
export function summarizeDashboard(d: unknown): string {
  const dash = d as { data?: Record<string, unknown>; widgets?: unknown[] } | null;
  const parts = Object.entries(dash?.data ?? {})
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`);
  return `${parts.join(" ")} widgets=${dash?.widgets?.length ?? "?"}`;
}

/** Up to 6 leaf paths that differ between two prefs objects, `a.b: old -> new`. */
export function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (obj(a) && obj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .flatMap((k) => changedPaths(a[k], b[k], path ? `${path}.${k}` : k))
      .slice(0, 6);
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)?.slice(0, 24)} -> ${JSON.stringify(b)?.slice(0, 24)}`];
}

// Chatter that would bury the context: our own log writes, http body chunks.
const IGNORED_INVOKES = /^plugin:(log\||http\|fetch_(read_body|send|cancel))/;

/** Start the detector in this window; returns a stop function (tests). */
export function startJumpDetector(win: string): () => void {
  if (!import.meta.env.DEV) return () => {};

  const t0 = performance.now();
  let ring: { at: number; e: string }[] = [];
  const note = (e: string) => {
    const at = performance.now();
    ring = ring.filter((r) => at - r.at <= CONTEXT_MS).slice(-(CONTEXT_MAX - 1));
    ring.push({ at, e });
  };
  const chipCount = () => document.querySelectorAll(".ticker-scroll-wrapper ul > li").length;
  const offs: (() => void)[] = [];

  // invoke: patched on the runtime object, which core.invoke reads per call.
  try {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => unknown } }).__TAURI_INTERNALS__;
    const orig = internals.invoke;
    internals.invoke = (cmd: unknown, args: unknown, opts: unknown) => {
      if (typeof cmd === "string" && !IGNORED_INVOKES.test(cmd)) note(`invoke ${cmd} ${summarizeArgs(args)}`.trim());
      return orig.call(internals, cmd, args, opts);
    };
    offs.push(() => { internals.invoke = orig; });
  } catch (err) {
    note(`invoke hook failed: ${String(err)}`);
  }

  void listen<{ data?: { metadata?: { table_name?: string } }[] }>("sse-event", (ev) => {
    const tables = new Map<string, number>();
    for (const r of ev.payload?.data ?? []) {
      const t = r.metadata?.table_name ?? "?";
      tables.set(t, (tables.get(t) ?? 0) + 1);
    }
    note(`sse-event ${[...tables].map(([t, n]) => `${t}x${n}`).join(" ") || "empty"}`);
  }).then((u) => offs.push(u), () => {});
  void listen<{ status?: string }>("sse-status", (ev) => note(`sse-status ${ev.payload?.status ?? "?"}`))
    .then((u) => offs.push(u), () => {});
  offs.push(onStoreChange("scrollr:dashboard", (d) => note(`store scrollr:dashboard ${summarizeDashboard(d)} chips=${chipCount()}`)));

  let prefs = getStore<unknown>("scrollr:settings", null);
  offs.push(onStoreChange("scrollr:settings", (next) => {
    note(`store scrollr:settings ${changedPaths(prefs, next).join("; ") || "no diff"} chips=${chipCount()}`);
    prefs = next;
  }));

  const on = (t: EventTarget, name: string, fn: (e: Event) => void) => {
    t.addEventListener(name, fn);
    offs.push(() => t.removeEventListener(name, fn));
  };
  on(window, "resize", () => note(`resize ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`));
  on(document, "visibilitychange", () => note(`visibility ${document.visibilityState}`));
  if (document.fonts) {
    on(document.fonts, "loadingdone", (e) => note(`fonts loadingdone ${(e as Event & { fontfaces?: unknown[] }).fontfaces?.length ?? "?"}`));
  }

  // ── the tracker ──
  let prev: Snap[] | null = null;
  let prevAt = 0;
  let lastLine = -Infinity;
  let suppressed = 0;
  let lines: number[] = [];

  const snapshot = (): { snaps: Snap[]; bounds: Bounds } | null => {
    const wrap = document.querySelector(".ticker-scroll-wrapper");
    if (!wrap) return null;
    const wr = wrap.getBoundingClientRect();
    const snaps: Snap[] = [];
    for (const li of wrap.querySelectorAll("ul > li")) {
      const r = li.getBoundingClientRect();
      if (r.right <= wr.left || r.left >= wr.right || r.width === 0) continue;
      const chip = li.querySelector<HTMLElement>("[data-chip]");
      const key = `${chip?.dataset.widget ?? "?"}|${chip?.dataset.rotateSlot ?? ""}|${identity(li.textContent).slice(0, 60)}`;
      snaps.push({ key, x: r.left, w: r.width });
    }
    return { snaps, bounds: { left: wr.left, right: wr.right } };
  };

  const tick = () => {
    const s = snapshot();
    const now = performance.now();
    if (!s) { prev = null; return; }
    // A throttled or resumed timer makes the scroll delta huge; re-baseline.
    const flags = prev && now - prevAt <= 3 * TICK_MS ? detect(prev, s.snaps, s.bounds) : [];
    prev = s.snaps;
    prevAt = now;
    if (!flags.length) return;
    // ponytail: a transition spans several ticks; the first flag speaks for
    // it and the rest are counted, not logged. Rate limit is a hard backstop.
    if (now - lastLine < COOLDOWN_MS) { suppressed += flags.length; return; }
    lines = lines.filter((l) => now - l < 60_000);
    if (lines.length >= MAX_LINES_PER_MIN) return;
    lines.push(now);
    lastLine = now;
    const size = (f: Flag) => Math.abs(f.jumpPx) + Math.abs(f.widthAfter - f.widthBefore);
    const top = flags.reduce((a, b) => (size(b) > size(a) ? b : a));
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const line = JSON.stringify({
      kind: "ticker-jump",
      t: new Date().toISOString(),
      window: win,
      chip: top.key,
      jumpPx: r2(top.jumpPx),
      widthBefore: r2(top.widthBefore),
      widthAfter: r2(top.widthAfter),
      swapped: top.swapped,
      otherChips: flags.filter((f) => f !== top).slice(0, 5).map((f) => f.key),
      suppressedSince: suppressed,
      upMs: Math.round(now - t0),
      context: ring.filter((r) => now - r.at <= CONTEXT_MS).map((r) => `-${Math.round(now - r.at)}ms ${r.e}`),
    });
    suppressed = 0;
    console.debug(line);
    invoke("plugin:log|log", { level: 3, message: line, location: "jumpDetector" }).catch(() => {});
  };

  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearInterval(timer);
    offs.forEach((f) => f());
  };
}
