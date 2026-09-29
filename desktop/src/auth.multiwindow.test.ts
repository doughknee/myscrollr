/**
 * SCROLLR-248 — forced sign-outs from the refresh-token rotation race.
 *
 * Production evidence (Logto audit logs, desktop app, 1–28 Sep 2026): 131
 * failed refreshes, 105 of them `refresh token already used`. The typical
 * user trace is `… -3552S -8S 0Eu`: one window rotated the token 3–30 s
 * earlier, then ANOTHER window sent the token that had just been consumed,
 * Logto refused it, and that window cleared `scrollr:auth` for every window.
 *
 * Every window is its own JS context with its own copy of the store cache.
 * The ticker windows kept theirs current through App.tsx's subscription;
 * the main window had none, so its session froze at the last token IT
 * wrote. Its next refresh (its own timer, a poll, or Rust presence asking
 * it to force one after a resume) sent a dead token, and its "did I lose a
 * race?" check read the same frozen cache, concluded it had not, and
 * signed the user out everywhere.
 *
 * This harness runs the real `auth.ts` + `lib/store.ts` once per window
 * (fresh module instances = separate webviews) over one shared fake Rust
 * store, against a fake Logto that rotates refresh tokens the way the audit
 * log shows: a consumed token is honoured again only within a short grace.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const HOUR = 3_600_000;
const GRACE_MS = 2_000; // concurrent reuse Logto tolerates (734 pairs ≤2 s, 3 errors)
const LOGTO_LATENCY_MS = 300;
const IPC_EVENT_MS = 5;

const h = vi.hoisted(() => {
  const disk = new Map<string, unknown>();
  const changeListeners = new Set<{ key: string; cb: (v: unknown) => void }>();
  const logto = {
    tokens: new Map<string, { usedAt?: number }>(),
    issued: 0,
    errors: [] as string[],
    successes: 0,
  };
  return { disk, changeListeners, logto, labels: [] as string[] };
});

vi.mock("@tauri-apps/plugin-store", () => {
  const emit = (key: string, value: unknown) =>
    setTimeout(() => {
      for (const l of [...h.changeListeners]) if (l.key === key) l.cb(value);
    }, IPC_EVENT_MS);
  class LazyStore {
    constructor(_file: string) {}
    async entries<T>(): Promise<[string, T][]> {
      return [...h.disk.entries()].map(([k, v]) => [k, structuredClone(v) as T]);
    }
    async get<T>(k: string): Promise<T | undefined> {
      const v = h.disk.get(k);
      return v === undefined ? undefined : (structuredClone(v) as T);
    }
    async set(k: string, v: unknown): Promise<void> {
      h.disk.set(k, structuredClone(v));
      emit(k, structuredClone(v));
    }
    async delete(k: string): Promise<boolean> {
      const had = h.disk.delete(k);
      emit(k, undefined);
      return had;
    }
    async save(): Promise<void> {}
    async onKeyChange<T>(key: string, cb: (v: T | undefined) => void): Promise<() => void> {
      const entry = { key, cb: cb as (v: unknown) => void };
      h.changeListeners.add(entry);
      return () => h.changeListeners.delete(entry);
    }
  }
  return { LazyStore };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function issueTokens() {
  const rt = `R${h.logto.issued++}`;
  h.logto.tokens.set(rt, {});
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64url({ alg: "none" })}.${b64url({ sub: "u1", exp })}.sig`,
    refresh_token: rt,
    expires_in: 3600,
    token_type: "Bearer",
  };
}

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (_url: string, init: { body: string }) => {
    const { refresh_token: rt } = JSON.parse(init.body) as { refresh_token: string };
    await new Promise((r) => setTimeout(r, LOGTO_LATENCY_MS / 2));
    const t = h.logto.tokens.get(rt);
    let res: { status: number; body: unknown };
    if (t && (t.usedAt === undefined || Date.now() - t.usedAt <= GRACE_MS)) {
      t.usedAt ??= Date.now();
      h.logto.successes++;
      res = { status: 200, body: issueTokens() };
    } else {
      const detail = t ? "refresh token already used" : "refresh token not found";
      h.logto.errors.push(detail);
      res = {
        status: 400,
        body: { error: "invalid_grant", error_description: "grant request is invalid", error_detail: detail },
      };
    }
    await new Promise((r) => setTimeout(r, LOGTO_LATENCY_MS / 2));
    return {
      ok: res.status === 200,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  },
}));

type AuthModule = typeof import("./auth");
interface Win {
  label: string;
  auth: AuthModule;
}

/** A webview: fresh module instances, loaded in main.tsx's order. */
async function openWindow(label: string): Promise<Win> {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({ label }),
    getAllWindows: async () => h.labels.map((l) => ({ label: l })),
  }));
  const auth = await import("./auth"); // imported (via App) before initStore runs
  const store = await import("./lib/store");
  await store.initStore();
  // App.tsx subscribes every TICKER window to `scrollr:auth`; the main
  // window (__root.tsx) never has.
  if (label.startsWith("ticker")) store.onStoreChange("scrollr:auth", () => {});
  return { label, auth };
}

/** Restart with a stored session whose access token expires in an hour. */
async function restartApp(labels: string[]): Promise<Win[]> {
  h.labels = labels;
  const t = issueTokens();
  h.disk.set("scrollr:store-migrated", true);
  h.disk.set("scrollr:auth", {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + HOUR,
    userSub: "u1",
  });
  const wins: Win[] = [];
  for (const l of labels) wins.push(await openWindow(l));
  return wins;
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** Ask a window for a token, letting fake time run while Logto answers. */
async function token(w: Win, force = false): Promise<string | null> {
  const p = w.auth.getValidToken(force);
  await tick(LOGTO_LATENCY_MS + IPC_EVENT_MS);
  return p;
}

/** Each window asks for a token, `staggerMs` apart — dashboard polls, authFetch. */
async function pollAll(wins: Win[], staggerMs: number, force?: string) {
  const got: (string | null)[] = [];
  for (const w of wins) {
    got.push(await token(w, w.label === force));
    await tick(staggerMs - LOGTO_LATENCY_MS - IPC_EVENT_MS);
  }
  return got;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-28T12:00:00Z") });
  h.disk.clear();
  h.changeListeners.clear();
  h.logto.tokens.clear();
  h.logto.issued = 0;
  h.logto.errors = [];
  h.logto.successes = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SCROLLR-248: the session survives restarts, many windows and sleep", () => {
  it("three windows polling for three hours never sign the user out", async () => {
    const wins = await restartApp(["ticker", "ticker-2", "main"]);

    for (let elapsed = 0; elapsed < 3 * HOUR; elapsed += 30_000) {
      const got = await pollAll(wins, 7_000);
      expect(got).not.toContain(null);
      await tick(30_000 - 3 * 7_000);
    }

    expect(h.disk.get("scrollr:auth")).toBeDefined();
    expect(h.logto.errors).toEqual([]);
    expect(h.logto.successes).toBeGreaterThanOrEqual(3);
  });

  it("a resume where the ticker refreshes first and presence forces main 4 s later", async () => {
    const wins = await restartApp(["ticker", "ticker-2", "main"]);
    const [ticker, ticker2, main] = wins;
    expect(await token(main)).not.toBeNull();

    // Sleep overnight: the wall clock jumps, no timer ran in between.
    vi.setSystemTime(Date.now() + 8 * HOUR);

    // Resume. The ticker's poll lands first; Rust presence finds the stored
    // token expired and asks main (and only main) to force a refresh.
    expect(await token(ticker)).not.toBeNull();
    await tick(4_000 - LOGTO_LATENCY_MS - IPC_EVENT_MS);
    expect(await token(main, true)).not.toBeNull();
    await tick(4_000 - LOGTO_LATENCY_MS - IPC_EVENT_MS);
    expect(await token(ticker2)).not.toBeNull();

    // And the session keeps going afterwards.
    for (let elapsed = 0; elapsed < 2 * HOUR; elapsed += 30_000) {
      expect(await pollAll(wins, 5_000)).not.toContain(null);
      await tick(30_000 - 3 * 5_000);
    }

    expect(h.disk.get("scrollr:auth")).toBeDefined();
    expect(h.logto.errors).toEqual([]);
  });

  it("a non-owner's spent timer is re-armed when the window becomes owner (rearmRefresh)", async () => {
    // Only main is open here, but a ticker exists, so main does not own the
    // connection: its proactive timer fires once and must NOT refresh.
    h.labels = ["ticker", "main"];
    const t = issueTokens();
    h.disk.set("scrollr:store-migrated", true);
    h.disk.set("scrollr:auth", {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + HOUR,
      userSub: "u1",
    });
    const main = await openWindow("main");
    await tick(HOUR - 60_000); // past the proactive lead, before expiry
    expect(h.logto.successes).toBe(0);

    // The ticker is destroyed (monitor change); main takes over and the
    // election calls rearmRefresh.
    h.labels = ["main"];
    main.auth.rearmRefresh();
    await tick(LOGTO_LATENCY_MS + IPC_EVENT_MS);
    expect(h.logto.successes).toBe(1);
    expect(h.logto.errors).toEqual([]);
  });

  it("still signs out when Logto refuses the token that is actually stored", async () => {
    const [ticker, , main] = await restartApp(["ticker", "ticker-2", "main"]);
    // The refresh token dies server-side (expired, revoked).
    h.logto.tokens.clear();
    vi.setSystemTime(Date.now() + 2 * HOUR);

    expect(await token(ticker)).toBeNull();
    expect(h.disk.get("scrollr:auth")).toBeUndefined();
    expect(main.auth.isSignedOut()).toBe(true);
  });
});
