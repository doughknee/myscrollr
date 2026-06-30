/**
 * Centralized configuration for the desktop app.
 *
 * Runtime endpoints are configured via Vite env vars in local .env
 * files or injected at build time by CI for release builds.
 */

// ── API ─────────────────────────────────────────────────────────

const DEFAULT_API = "http://localhost:8080";
const EXAMPLE_AUTH_ENDPOINT = "your_local_auth_endpoint";
const EXAMPLE_LOGTO_APP_ID = "your_local_or_dev_logto_app_id";

function readOptionalEnv(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }

  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized === EXAMPLE_AUTH_ENDPOINT ||
    normalized === EXAMPLE_LOGTO_APP_ID
  ) {
    return "";
  }

  return normalized;
}

const configuredApi = readOptionalEnv(import.meta.env.VITE_API_URL);
export const API_BASE = configuredApi || DEFAULT_API;
export const API_HOST = (() => {
  try {
    return new URL(API_BASE).host;
  } catch {
    return new URL(DEFAULT_API).host;
  }
})();

// ── Auth (Logto PKCE) ───────────────────────────────────────────
// VITE_AUTH_ENDPOINT is the Logto base URL, not the full /oidc/auth path.

export const AUTH_ENDPOINT = readOptionalEnv(import.meta.env.VITE_AUTH_ENDPOINT);
export const LOGTO_APP_ID = readOptionalEnv(import.meta.env.VITE_LOGTO_APP_ID);
export const REDIRECT_URI = "http://127.0.0.1:19284/callback";
export const REFRESH_BUFFER_MS = 60_000;

// ── Dev demo mode ───────────────────────────────────────────────
// VITE_DEMO=1 runs the app SIGNED OUT against a no-auth local backend
// (the predictions `serve_bridge`, which ignores Authorization), bypassing
// Logto so the live Kalshi demo works with zero infra. STRICTLY a local
// dev affordance — never set in release/CI builds. See
// channels/predictions/LOCAL_DEV.md.
export const DEMO = import.meta.env.VITE_DEMO === "1";
