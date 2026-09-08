/**
 * REL-238 — the other half of the fix.
 *
 * `authFetch` fires notifySessionExpired() when a 401 outlives the
 * refresh; this is the subscription that turns it into the banner
 * `__root.tsx` already renders ("Your session has expired. Sign in
 * again…"). Before it existed, the only thing that could set
 * `sessionExpired` was `syncAuthFromDashboard` — and that never ran,
 * because `fetchDashboard` catches its own 401 and serves /public/feed
 * instead. Result: cached reads looked fine, every write toasted, and
 * reinstalling the app was the only known way out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const authed = vi.fn(() => true);

vi.mock("../auth", async () => {
  const listeners = new Set<() => void>();
  return {
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    isAuthenticated: () => authed(),
    isAuthConfigured: () => true,
    getLastLoginError: () => null,
    getTier: () => "uplink_pro",
    onSessionExpired: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    // Test-only handle on the module-level signal authFetch calls.
    __fire: () => {
      for (const l of [...listeners]) l();
    },
  };
});

const { useAuthState } = await import("./useAuthState");
const auth = (await import("../auth")) as unknown as { __fire: () => void };

beforeEach(() => authed.mockReturnValue(true));

describe("useAuthState", () => {
  it("raises the session-expired banner when a 401 outlives the refresh", () => {
    const { result } = renderHook(() => useAuthState());

    expect(result.current.authenticated).toBe(true);
    expect(result.current.sessionExpired).toBe(false);

    act(() => auth.__fire());

    expect(result.current.sessionExpired).toBe(true);
    expect(result.current.authenticated).toBe(false);
    // Tier drops with the session so gated UI stops promising paid features.
    expect(result.current.tier).toBe("free");
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useAuthState());
    unmount();
    // No act(): if the listener survived, React warns about setting state
    // on an unmounted tree and the assertion below would read stale state.
    expect(() => auth.__fire()).not.toThrow();
    expect(result.current.sessionExpired).toBe(false);
  });
});
