/**
 * SCROLLR-448 (RC-1) and SCROLLR-406: what the dashboard query does when the
 * API fails.
 *
 * Before: `fetchDashboard` caught EVERY failure of the signed-in call and
 * answered with /public/feed, which has no widgets. That counted as success,
 * replaced the cached dashboard, was broadcast to every ticker window, and
 * every signed-in bar said "no sources yet" for as long as the incident ran.
 * Now only a session that is really over falls back; anything else throws, so
 * TanStack keeps the last good dashboard and reports the error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const authFetch = vi.fn();
const request = vi.fn();
const auth = { isAuthenticated: vi.fn(), hasRefreshToken: vi.fn(), isSignedOut: vi.fn() };
const store = new Map<string, unknown>();

vi.mock("../auth", () => ({
  isAuthenticated: () => auth.isAuthenticated(),
  hasRefreshToken: () => auth.hasRefreshToken(),
  isSignedOut: () => auth.isSignedOut(),
}));
vi.mock("./client", async (orig) => ({
  ...(await orig<typeof import("./client")>()),
  authFetch: (...a: unknown[]) => authFetch(...a),
  request: (...a: unknown[]) => request(...a),
}));
vi.mock("../lib/store", () => ({
  getStore: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
}));
vi.mock("./pinnedSubjects", () => ({ pinnedSubjectsQuery: () => "" }));

const { ApiError } = await import("./client");
const { dashboardQueryOptions, dashboardState } = await import("./queries");

const prefs = { default_widgets_applied: true };
const good = { data: { rss: [{ title: "a" }] }, widgets: [{ widget_type: "news_npr", enabled: true }], preferences: prefs };
const publicFeed = { data: { finance: [] } };

beforeEach(() => {
  authFetch.mockReset();
  request.mockReset().mockResolvedValue(publicFeed);
  auth.isAuthenticated.mockReturnValue(true);
  auth.hasRefreshToken.mockReturnValue(true);
  auth.isSignedOut.mockReturnValue(false);
  store.clear();
});

const fetchOnce = () => dashboardQueryOptions().queryFn!({} as never);

describe("fetchDashboard", () => {
  it("falls back to the public feed only when the session is over (401, nothing stored)", async () => {
    authFetch.mockRejectedValue(new ApiError(401, "expired"));
    auth.isSignedOut.mockReturnValue(true);
    await expect(fetchOnce()).resolves.toEqual({ data: publicFeed.data });
    expect(request).toHaveBeenCalledWith("/public/feed");
  });

  it.each([
    ["500", new ApiError(500, "db read failed")],
    ["429", new ApiError(429, "slow down")],
    ["a timeout", new DOMException("aborted", "AbortError")],
    ["a 401 whose refresh only lost the network (session kept)", new ApiError(401, "expired")],
  ])("throws on %s instead of answering with an empty account", async (_, err) => {
    authFetch.mockRejectedValue(err);
    await expect(fetchOnce()).rejects.toBe(err);
    expect(request).not.toHaveBeenCalled();
  });

  it("a failed refresh keeps the last good dashboard on screen and reports the error", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    authFetch.mockResolvedValueOnce(good);
    const observer = new QueryObserver(client, { ...dashboardQueryOptions(), staleTime: 0 });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(good));

    authFetch.mockRejectedValueOnce(new ApiError(500, "db read failed"));
    await observer.refetch();
    const result = observer.getCurrentResult();
    expect(result.data).toEqual(good);
    expect(result.isError).toBe(true);
    expect(dashboardState(result)).toBe("ready");
    unsubscribe();
  });
});

describe("the saved dashboard (a restart during an outage)", () => {
  it("opens on the last good dashboard, stale so it is refetched at once", () => {
    store.set("scrollr:dashboard", good);
    const options = dashboardQueryOptions();
    expect((options.initialData as () => unknown)()).toEqual(good);
    expect(options.initialDataUpdatedAt).toBe(0);
  });

  it("never opens on another session's copy", () => {
    store.set("scrollr:dashboard", publicFeed); // saved while signed out
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
    store.set("scrollr:dashboard", good);
    auth.isSignedOut.mockReturnValue(true); // signed-in copy, now signed out
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
  });
});

describe("dashboardState", () => {
  it("separates loading, failed and ready", () => {
    expect(dashboardState({ data: undefined, isError: false })).toBe("pending");
    expect(dashboardState({ data: undefined, isError: true })).toBe("failed");
    expect(dashboardState({ data: good, isError: true })).toBe("ready");
  });
});
