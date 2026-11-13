/**
 * SCROLLR-472: the sign-in attempt itself.
 *
 * D2-11: Cancel on the overlay used to leave the attempt's callback listener
 * and 5-minute timer behind, so a retry failed with "State mismatch" and a
 * "Login timed out" toast appeared minutes later.
 * D2-12: any local page could end a pending sign-in by requesting /callback
 * with an `error` of its choosing; `error` was read before `state`.
 * CN-8: the browser opened before the callback listener was ready.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  listeners: new Set<(e: { payload: unknown }) => void>(),
  invokes: [] as [string, unknown][],
  opened: [] as string[],
  listenReady: null as null | (() => void),
}));

vi.mock("./config", () => ({
  AUTH_ENDPOINT: "https://auth.example",
  LOGTO_APP_ID: "app",
  API_BASE: "https://api.example",
  LOGTO_RESOURCE: "https://api.example",
  REDIRECT_URI: "http://127.0.0.1:19284/callback",
  REFRESH_BUFFER_MS: 60_000,
}));
vi.mock("./lib/store", () => ({
  getStore: () => null,
  onStoreChange: () => () => {},
  readStoreShared: async () => null,
  setStorePersisted: async () => {},
  removeStorePersisted: async () => {},
}));
vi.mock("./lib/windowRole", () => ({ ownsSharedConnection: async () => true }));
vi.mock("./lib/openExternal", () => ({
  openExternal: async (url: string) => {
    h.opened.push(url);
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: unknown) => {
    h.invokes.push([cmd, args]);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.add(cb);
    const unlisten = () => h.listeners.delete(cb);
    if (!h.listenReady) return Promise.resolve(unlisten);
    return new Promise((resolve) => {
      h.listenReady = () => resolve(unlisten);
    });
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: "a.e30.s", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }),
  }),
}));

const auth = await import("./auth");

const callback = (payload: object) => {
  for (const l of [...h.listeners]) l({ payload });
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const stateOf = () => new URL(h.opened.at(-1)!).searchParams.get("state");

beforeEach(() => {
  h.listeners.clear();
  h.invokes = [];
  h.opened = [];
  h.listenReady = null;
});

describe("login", () => {
  it("D2-12: ignores a callback with another state, then accepts the real one", async () => {
    const p = auth.login();
    await flush();
    callback({ state: "forged", error: "x", error_description: "Visit evil.example" });
    await flush();
    expect(h.listeners.size).toBe(1); // still waiting
    callback({ state: stateOf(), code: "c" });
    expect(await p).not.toBeNull();
    expect(auth.getLastLoginError()).toBeNull();
    // The callback server is told which state to answer to.
    expect(h.invokes[0]).toEqual(["start_auth_server", { expectedState: stateOf() }]);
  });

  it("D2-11: Cancel ends the attempt: no listener left, server stopped, no timeout later", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const p = auth.login(undefined, controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.listeners.size).toBe(1);
      controller.abort();
      expect(await p).toBeNull();
      expect(h.listeners.size).toBe(0);
      expect(h.invokes.map(([c]) => c)).toContain("stop_auth_server");
      expect(vi.getTimerCount()).toBe(0); // the 5-minute timer is gone
    } finally {
      vi.useRealTimers();
    }
  });

  it("CN-8: opens the browser only once the callback listener is ready", async () => {
    h.listenReady = () => {};
    const p = auth.login();
    await flush();
    expect(h.opened).toEqual([]);
    h.listenReady!();
    await flush();
    expect(h.opened).toHaveLength(1);
    callback({ state: stateOf(), code: "c" });
    expect(await p).not.toBeNull();
  });
});
