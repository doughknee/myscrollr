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
const auth = { isAuthenticated: vi.fn(), hasRefreshToken: vi.fn(), isSignedOut: vi.fn(), currentUserSub: vi.fn() };
const store = new Map<string, unknown>();

vi.mock("../auth", () => ({
  isAuthenticated: () => auth.isAuthenticated(),
  hasRefreshToken: () => auth.hasRefreshToken(),
  isSignedOut: () => auth.isSignedOut(),
  currentUserSub: () => auth.currentUserSub(),
}));
vi.mock("./client", async (orig) => ({
  ...(await orig<typeof import("./client")>()),
  authFetch: (...a: unknown[]) => authFetch(...a),
  request: (...a: unknown[]) => request(...a),
}));
vi.mock("../lib/store", () => ({
  getStore: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  removeStore: (key: string) => store.delete(key),
}));
vi.mock("./pinnedSubjects", () => ({ pinnedSubjectsQuery: () => "" }));

const { ApiError } = await import("./client");
const { dashboardQueryOptions, dashboardState, dashboardToSave, forgetAccountData, queryKeys } = await import("./queries");

const prefs = { default_widgets_applied: true };
const good = { data: { rss: [{ title: "a" }] }, widgets: [{ widget_type: "news_npr", enabled: true }], preferences: prefs };
const publicFeed = { data: { finance: [] } };

beforeEach(() => {
  authFetch.mockReset();
  request.mockReset().mockResolvedValue(publicFeed);
  auth.isAuthenticated.mockReturnValue(true);
  auth.hasRefreshToken.mockReturnValue(true);
  auth.isSignedOut.mockReturnValue(false);
  auth.currentUserSub.mockReturnValue("user-a");
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
    store.set("scrollr:dashboard", dashboardToSave(good as never));
    const options = dashboardQueryOptions();
    expect((options.initialData as () => unknown)()).toEqual({ ...good, userSub: "user-a" });
    expect(options.initialDataUpdatedAt).toBe(0);
  });

  it("never opens on another session's copy", () => {
    store.set("scrollr:dashboard", publicFeed); // saved while signed out
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
    store.set("scrollr:dashboard", dashboardToSave(good as never));
    auth.isSignedOut.mockReturnValue(true); // signed-in copy, now signed out
    auth.currentUserSub.mockReturnValue(null);
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
  });

  // SCROLLR-470 (D2-4)
  it("never opens on another account's copy, or on one that names no account", () => {
    store.set("scrollr:dashboard", dashboardToSave(good as never)); // saved by user-a
    auth.currentUserSub.mockReturnValue("user-b");
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
    store.set("scrollr:dashboard", good); // saved by a version before the tag
    auth.currentUserSub.mockReturnValue("user-a");
    expect((dashboardQueryOptions().initialData as () => unknown)()).toBeUndefined();
  });
});

describe("forgetAccountData (sign-out or sign-in)", () => {
  it("leaves nothing of the previous account in cache or store, even when the API is down", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    authFetch.mockResolvedValueOnce(good);
    store.set("scrollr:dashboard", dashboardToSave(good as never));
    const observer = new QueryObserver(client, { ...dashboardQueryOptions(), staleTime: 0 });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(good));
    client.setQueryData(queryKeys.userOverview, { email: "a@example.com" });
    client.setQueryData(["github-status"], { connected: true });
    client.setQueryData(queryKeys.catalogs.rss, ["shared"]);

    // Sign out during an outage: the refetch fails.
    auth.isSignedOut.mockReturnValue(true);
    auth.isAuthenticated.mockReturnValue(false);
    auth.hasRefreshToken.mockReturnValue(false);
    auth.currentUserSub.mockReturnValue(null);
    request.mockRejectedValue(new ApiError(503, "down"));
    await forgetAccountData(client);

    expect(store.has("scrollr:dashboard")).toBe(false);
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(client.getQueryData(queryKeys.dashboard)).toBeUndefined();
    expect(client.getQueryData(queryKeys.userOverview)).toBeUndefined();
    expect(client.getQueryData(["github-status"])).toBeUndefined();
    expect(client.getQueryData(queryKeys.catalogs.rss)).toEqual(["shared"]); // not per account
    unsubscribe();
  });

  // SCROLLR-472: after a sign-in a GitHub chip must not wait for its next poll.
  it("on a sign-in, refetches the emptied GitHub query that is in use at once", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const github = vi.fn().mockResolvedValueOnce({ owner: "a" }).mockResolvedValue({ owner: "b" });
    const observer = new QueryObserver(client, { queryKey: ["github-board"], queryFn: github, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ owner: "a" }));
    authFetch.mockResolvedValue(good);

    await forgetAccountData(client, { refetch: true });

    expect(github).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual({ owner: "b" });
    unsubscribe();
  });
});

describe("dashboardState", () => {
  it("separates loading, failed and ready", () => {
    expect(dashboardState({ data: undefined, isError: false })).toBe("pending");
    expect(dashboardState({ data: undefined, isError: true })).toBe("failed");
    expect(dashboardState({ data: good, isError: true })).toBe("ready");
  });
});
