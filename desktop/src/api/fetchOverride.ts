/**
 * Selective fetch override: route API calls through Tauri's plugin-http
 * (bypasses browser CORS via Rust's reqwest), but leave all other fetches
 * (Vite HMR, webview internals, local resources) on the native path.
 *
 * Import this module for its side effect in every window entry point.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { API_HOST } from "../config";

const nativeFetch = window.fetch.bind(window);

/**
 * The user agent every API call carries: `Scrollr/1.6.1 (windows)`.
 *
 * This is the only thing the app tells us about itself, and until REL-271 it
 * told us nothing: the API discarded the user agent on every request, so a
 * report like "the ticker never scrolls on 1.5.0" could not be scoped to how
 * many installs were still on that build. The server parses exactly this
 * shape into per-day counters — app version, platform, endpoint, status class
 * — and stores nothing else. Nothing about what is on the ticker is sent.
 *
 * Version is the build-time constant (same one Sentry releases use), so there
 * is no async lookup on the request path. Platform comes from the webview's
 * own UA data, which is what WindowControls already reads to decide whether
 * to draw window buttons. Keep the three platform names in step with the
 * server's `clientUARe` in api/internal/platform/usage.go — anything else it
 * does not recognise is counted as "unknown".
 */
const UA_PLATFORM =
  (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform ?? navigator.platform;
const OS = /Mac/.test(UA_PLATFORM)
  ? "macos"
  : /Win/.test(UA_PLATFORM)
    ? "windows"
    : "linux";
export const CLIENT_USER_AGENT = `Scrollr/${__APP_VERSION__} (${OS})`;

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url: string;
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  try {
    if (new URL(url).host === API_HOST) {
      // Merge rather than replace. Passing a fresh header set alongside a
      // Request would drop that Request's own Authorization, so seed from
      // whichever the caller used, then let init override it — the same
      // precedence fetch itself applies. An explicit User-Agent wins.
      const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
      if (!headers.has("User-Agent")) {
        headers.set("User-Agent", CLIENT_USER_AGENT);
      }
      return tauriFetch(input, { ...init, headers });
    }
  } catch {
    // Invalid URL — fall through to native fetch
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;
