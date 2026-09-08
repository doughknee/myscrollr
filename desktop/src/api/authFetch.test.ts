/**
 * REL-238 — a stale session must announce itself, not fail one write at a time.
 *
 * On production 1.6.1 every server-backed widget toggle answered
 * "Couldn't hide Crypto" while the app looked perfectly healthy: reads
 * came from `fetchDashboard`, which catches its own 401 and falls back to
 * /public/feed. Both core-api replicas logged `[SSE] Auth failed: token is
 * expired` for the account. The only escape anyone found was uninstalling
 * Scrollr — which "works" purely because it deletes scrollr.json, and with
 * it `scrollr:auth`.
 *
 * Two defects fed that:
 *   1. the 401 retry only fired when the refreshed token differed from the
 *      one that failed, so a refresh returning the same string fell through
 *      to the throw;
 *   2. when no token could be obtained at all, nothing set session-expired,
 *      so the already-built "Your session has expired — Sign in" banner
 *      never appeared.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const getValidToken = vi.fn();
const isSignedOut = vi.fn();

vi.mock("../auth", async () => {
  // Keep the real listener set so the test asserts the actual wiring
  // useAuthState subscribes through, not a stub of it.
  const listeners = new Set<() => void>();
  return {
    getValidToken: (...a: unknown[]) => getValidToken(...a),
    isSignedOut: () => isSignedOut(),
    notifySessionExpired: () => {
      for (const l of [...listeners]) l();
    },
    onSessionExpired: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

const { authFetch } = await import("./client");
const { onSessionExpired } = await import("../auth");

const unauthorized = () => ({
  ok: false,
  status: 401,
  json: async () => ({ error: "Invalid or expired token" }),
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let expired: Mock<() => void>;
let unsubscribe: () => void;

beforeEach(() => {
  fetchMock.mockReset();
  getValidToken.mockReset();
  isSignedOut.mockReset();
  expired = vi.fn<() => void>();
  unsubscribe = onSessionExpired(expired);
});

afterEach(() => unsubscribe());

describe("authFetch on 401", () => {
  it("retries with a refreshed token even when it is byte-identical", async () => {
    // doRefresh short-circuits to the STORED access token on both of its
    // cross-window race checks, so "same string back" is a normal outcome
    // of a successful refresh — not a reason to give up.
    getValidToken.mockResolvedValueOnce("T").mockResolvedValueOnce("T");
    isSignedOut.mockReturnValue(false);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({ status: "ok" }));

    await expect(authFetch("/users/me/widgets/finance_btc", { method: "PUT" }))
      .resolves.toEqual({ status: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getValidToken).toHaveBeenLastCalledWith(true);
    expect(expired).not.toHaveBeenCalled();
  });

  it("retries with a rotated token and succeeds", async () => {
    getValidToken.mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    isSignedOut.mockReturnValue(false);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({ status: "ok" }));

    await authFetch("/users/me/widgets");

    const retryHeaders = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer fresh");
  });

  it("announces the expired session when the refresh is refused", async () => {
    // getValidToken(true) → doRefresh → Logto 4xx → clearAuth() → null.
    // Auth is gone; nothing but this signal can tell the UI.
    getValidToken.mockResolvedValueOnce("expired").mockResolvedValueOnce(null);
    isSignedOut.mockReturnValue(true);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(
      authFetch("/users/me/widgets/finance_btc", { method: "PUT" }),
    ).rejects.toMatchObject({ status: 401 });

    expect(expired).toHaveBeenCalledTimes(1);
    // Exactly one attempt: no token to retry with.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the refresh merely failed on the network", async () => {
    // doRefresh keeps the refresh token on a network error and the
    // proactive timer retries every 30s — that is not a dead session, and
    // declaring one would push a signed-in user at a sign-in banner.
    getValidToken.mockResolvedValueOnce("valid").mockResolvedValueOnce(null);
    isSignedOut.mockReturnValue(false);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(authFetch("/users/me/widgets")).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).not.toHaveBeenCalled();
  });

  it("announces when the retry itself comes back 401 and auth is gone", async () => {
    getValidToken.mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    isSignedOut.mockReturnValue(true);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(authFetch("/users/me/widgets")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("carries the server's error string onto the thrown ApiError", async () => {
    // The toggle's onError prints this; before REL-238 it printed only
    // "ApiError" and the server logged nothing, so neither end said why.
    getValidToken.mockResolvedValueOnce(null);
    isSignedOut.mockReturnValue(false);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Widget not found" }),
    });

    await expect(authFetch("/users/me/widgets/nope")).rejects.toMatchObject({
      status: 404,
      message: "Widget not found",
    });
  });
});
