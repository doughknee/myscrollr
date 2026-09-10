/**
 * REL-271 — the app has to say which build it is.
 *
 * Until this landed, core-api discarded the user agent on every request, so
 * "the ticker never scrolls on 1.4.0 and 1.5.0" could not be scoped: nobody
 * could say how many installs were still on those builds. The server counts
 * per-day totals keyed by app version and OS, which only works if the client
 * actually sends `Scrollr/<version> (<os>)`.
 *
 * These assert the client half: the header is set on API calls, it does not
 * trample what callers already send, and it never leaks onto non-API fetches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tauriFetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

vi.stubGlobal("__APP_VERSION__", "1.6.1");

const nativeFetch = vi.fn();
window.fetch = nativeFetch as unknown as typeof window.fetch;

const { API_BASE } = await import("../config");
await import("./fetchOverride");

/** The headers the override actually handed to plugin-http. */
function sentHeaders(): Headers {
  const init = tauriFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe("fetchOverride user agent", () => {
  beforeEach(() => {
    tauriFetchMock.mockReset();
    nativeFetch.mockReset();
  });

  it("sends Scrollr/<version> (<os>) on API calls", async () => {
    await window.fetch(`${API_BASE}/dashboard`);
    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    // jsdom reports a Linux-ish platform; the OS token is whichever of the
    // three the server knows, and the shape is what matters here.
    expect(sentHeaders().get("User-Agent")).toMatch(
      /^Scrollr\/1\.6\.1 \((windows|macos|linux)\)$/,
    );
  });

  it("keeps the caller's own headers", async () => {
    await window.fetch(`${API_BASE}/users/me/widgets`, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    });
    const headers = sentHeaders();
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("User-Agent")).toContain("Scrollr/1.6.1");
  });

  it("does not overwrite a User-Agent the caller set", async () => {
    await window.fetch(`${API_BASE}/dashboard`, {
      headers: { "User-Agent": "Scrollr-Updater/1.0" },
    });
    expect(sentHeaders().get("User-Agent")).toBe("Scrollr-Updater/1.0");
  });

  it("leaves non-API fetches on the native path, with no header added", async () => {
    await window.fetch("https://example.com/somewhere");
    expect(tauriFetchMock).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const init = nativeFetch.mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).has("User-Agent")).toBe(false);
  });
});
