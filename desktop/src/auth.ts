/**
 * Desktop OAuth authentication via PKCE + localhost callback.
 *
 * Flow:
 * 1. Start a temporary HTTP server on 127.0.0.1:19284 (Rust command)
 * 2. Open Logto authorization URL in the system browser
 * 3. User logs in, Logto redirects to localhost callback
 * 4. Rust server captures the code, emits `auth-callback` event
 * 5. JS exchanges the code for tokens directly with Logto
 *
 * Reuses the extension's Logto app (public PKCE client).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import { open } from "@tauri-apps/plugin-shell";
import {
  getStore,
  setStore,
  removeStore,
  setStorePersisted,
  removeStorePersisted,
} from "./lib/store";

// ── Constants ────────────────────────────────────────────────────

import {
  AUTH_ENDPOINT as LOGTO_ENDPOINT,
  LOGTO_APP_ID,
  API_BASE as API_RESOURCE,
  LOGTO_RESOURCE,
  REDIRECT_URI,
  REFRESH_BUFFER_MS,
} from "./config";

// ── Types ────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface AuthState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  userSub: string | null;
}

function assertAuthConfig(): void {
  if (!LOGTO_ENDPOINT || !LOGTO_APP_ID) {
    throw new Error(
      "Desktop auth is not configured. Set VITE_AUTH_ENDPOINT and VITE_LOGTO_APP_ID before signing in.",
    );
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(LOGTO_ENDPOINT && LOGTO_APP_ID);
}

interface AuthCallbackPayload {
  code?: string | null;
  state?: string | null;
  error?: string | null;
  error_description?: string | null;
}

// ── Storage ──────────────────────────────────────────────────────

const STORAGE_KEY = "scrollr:auth";

function loadAuth(): AuthState | null {
  return getStore<AuthState | null>(STORAGE_KEY, null);
}

/**
 * Persist auth state and schedule the next refresh.
 *
 * Critically: awaits the disk write before returning. Used to be
 * fire-and-forget via setStore, but that opened a window where a
 * refresh response could update the in-memory cache while the disk
 * still held the OLD refresh token. If the OS suspended the app or
 * the process exited inside that window (~100ms autoSave debounce on
 * Tauri's LazyStore), the next launch read the OLD R0 from disk and
 * sent it to Logto — which had ALREADY rotated R0 → R1 in the lost
 * response, so it now treated R0 as "reused" and invalidated the
 * entire token family. Result: user logged out unexpectedly with the
 * `refresh_4xx_no_recovery` diagnostic path firing on a 400
 * `invalid_grant` from Logto.
 *
 * Always await this. Callers MUST handle the promise — silent failure
 * here is exactly what we're trying to prevent.
 */
async function saveAuth(state: AuthState): Promise<void> {
  await setStorePersisted(STORAGE_KEY, state);
  scheduleRefresh();
}

async function clearAuth(): Promise<void> {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  // Persist the removal — fire-and-forget removeStore opened the same
  // disk-write race that caused the original logout bug. Awaiting
  // here means the next process restart definitely doesn't see stale
  // tokens after a logout.
  await removeStorePersisted(STORAGE_KEY);
}

// ── PKCE helpers ─────────────────────────────────────────────────

function generateRandomHex(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Token exchange (via Go API proxy) ────────────────────────────
// Uses the same /extension/token proxy the browser extension uses.
// The proxy makes the Logto request server-side, avoiding the Origin
// header validation that Logto enforces on direct client requests.

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const res = await fetch(`${API_RESOURCE}/extension/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function refreshTokenRequest(
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(`${API_RESOURCE}/extension/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    // Capture Logto's actual error body so the diagnostic events can
    // tell us EXACTLY why the refresh failed. Logto returns standard
    // OAuth error envelopes:
    //   {"error":"invalid_grant","error_description":"refresh token expired"}
    //   {"error":"invalid_grant","error_description":"refresh token has been revoked"}  ← reuse-detection
    //   {"error":"invalid_client","error_description":"..."}
    // The error code is the diagnostic gold — `invalid_grant` with
    // a reuse-related description is the smoking gun for the
    // disk-write-loss → reuse-detection class of bugs.
    let errorBody = "";
    try {
      errorBody = await res.text();
    } catch {
      // body unreadable (network drop mid-read) — fine, status alone
    }
    // Cap at 400 chars to avoid runaway log sizes if Logto ever
    // returns a huge HTML error page.
    if (errorBody.length > 400) {
      errorBody = errorBody.slice(0, 400) + "…";
    }
    throw new Error(
      errorBody
        ? `Token refresh failed: ${res.status} ${errorBody}`
        : `Token refresh failed: ${res.status}`,
    );
  }

  return res.json();
}

// ── JWT decode ───────────────────────────────────────────────────

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    // base64url → base64: swap URL-safe chars and restore padding
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSub(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  return (payload?.sub as string) ?? null;
}

/**
 * Extract the subscription tier from the JWT's `roles` claim.
 * Logto injects roles via Custom JWT (e.g. ["uplink_ultimate"]).
 *
 * Tier hierarchy: super_user > uplink_ultimate > uplink_pro > uplink > free
 */
export type SubscriptionTier =
  | "free"
  | "uplink"
  | "uplink_pro"
  | "uplink_ultimate"
  | "super_user";

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  uplink: "Uplink",
  uplink_pro: "Uplink Pro",
  uplink_ultimate: "Uplink Ultimate",
  super_user: "Super User",
};

export function getTier(): SubscriptionTier {
  const auth = loadAuth();
  if (!auth) return "free";

  const payload = decodeJwtPayload(auth.accessToken);
  if (!payload) return "free";

  const roles = Array.isArray(payload.roles)
    ? (payload.roles as string[])
    : [];

  if (roles.includes("super_user")) return "super_user";
  if (roles.includes("uplink_ultimate")) return "uplink_ultimate";
  if (roles.includes("uplink_pro")) return "uplink_pro";
  if (roles.includes("uplink")) return "uplink";
  return "free";
}

// ── Concurrency guard ────────────────────────────────────────────

let refreshPromise: Promise<string | null> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Last login error message — cleared on next attempt. */
let lastLoginError: string | null = null;
export function getLastLoginError(): string | null {
  return lastLoginError;
}

/**
 * Proactively refresh the access token before it expires.
 * Self-sustaining: on success, saveAuth() re-schedules the next refresh.
 * On network failure, retries every 30s until auth is cleared or
 * refresh succeeds.
 *
 * Per-window jitter: the desktop app runs two windows (main + ticker)
 * each with its own JS context. Without jitter, both windows compute
 * the same refresh-target time and fire setTimeout simultaneously,
 * causing a refresh-token rotation race against Logto. Adding 0-15s
 * of random jitter to the refresh moment makes the windows fire
 * staggered, so when window A's refresh saves new tokens to the
 * shared store, window B sees them via onStoreChange + the pre-send
 * race check in doRefresh and skips its own (now-redundant) refresh.
 */
function scheduleRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const auth = loadAuth();
  if (!auth || !auth.refreshToken) return;

  const baseMs = auth.expiresAt - Date.now() - REFRESH_BUFFER_MS;
  // Up to 15s of randomized jitter; keeps the two windows from firing
  // their refresh setTimeout at the exact same wall-clock moment.
  const jitterMs = Math.floor(Math.random() * 15_000);
  const msUntilRefresh = baseMs + jitterMs;

  const performRefresh = async () => {
    const token = await getValidToken();
    // If refresh failed but we still have a refresh token (network
    // error), retry in 30s.
    if (!token && loadAuth()?.refreshToken) {
      refreshTimer = setTimeout(performRefresh, 30_000);
    }
    // If succeeded, saveAuth() → scheduleRefresh() was already
    // called with the new expiry.
  };

  if (msUntilRefresh <= 0) {
    // Already past the refresh point — refresh immediately
    // (no jitter when we're already late).
    performRefresh();
  } else {
    refreshTimer = setTimeout(performRefresh, msUntilRefresh);
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Start the PKCE login flow:
 * 1. Start localhost callback server (Rust)
 * 2. Open Logto login in the system browser
 * 3. Wait for the callback with the auth code
 * 4. Exchange the code for tokens
 *
 * Returns the auth state on success, or null on failure/cancel.
 */
export async function login(): Promise<AuthState | null> {
  let cleanupPendingAuth = () => {};
  let hasPendingAuthCleanup = false;
  let authServerStarted = false;

  lastLoginError = null;

  try {
    assertAuthConfig();

    const codeVerifier = generateRandomHex(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomHex(16);

    // Start the callback server (returns immediately, listens in background)
    try {
      await invoke("start_auth_server");
    } catch (err) {
      const msg = String(err);
      if (msg.includes("already running")) {
        // Previous login attempt didn't clean up — stop and retry once
        await invoke("stop_auth_server").catch(() => {});
        await invoke("start_auth_server");
      } else if (msg.includes("Failed to bind")) {
        throw new Error(
          "Another application is using the sign-in port (19284). " +
            "Close it and try again.",
        );
      } else {
        throw err;
      }
    }
    authServerStarted = true;

    // Build the authorization URL
    const params = new URLSearchParams({
      client_id: LOGTO_APP_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email offline_access",
      resource: LOGTO_RESOURCE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      prompt: "consent",
    });

    const authBase = LOGTO_ENDPOINT.replace(/\/+$/, "");
    const authUrl = `${authBase}/oidc/auth?${params.toString()}`;

    let resolveListenerReady: (() => void) | null = null;
    let rejectListenerReady: ((error: unknown) => void) | null = null;
    const listenerReadyPromise = new Promise<void>((resolve, reject) => {
      resolveListenerReady = resolve;
      rejectListenerReady = reject;
    });

    const payloadPromise = new Promise<AuthCallbackPayload>(
      (resolve, reject) => {
        let unlisten: (() => void) | null = null;
        let settled = false;

        const dispose = () => {
          settled = true;
          clearTimeout(timer);
          unlisten?.();
          hasPendingAuthCleanup = false;
        };

        cleanupPendingAuth = dispose;
        hasPendingAuthCleanup = true;

        const timer = setTimeout(() => {
          dispose();
          reject(new Error("Login timed out after 5 minutes"));
        }, 300_000);

        listen<AuthCallbackPayload>("auth-callback", (event) => {
          dispose();
          resolve(event.payload);
        })
          .then((fn) => {
            if (settled) {
              fn(); // already resolved/rejected — clean up immediately
            } else {
              unlisten = fn;
              resolveListenerReady?.();
            }
          })
          .catch((err) => {
            dispose();
            rejectListenerReady?.(err);
            reject(err);
          });
      },
    );

    // Open in system browser after the callback listener is ready.
    await listenerReadyPromise;
    await open(authUrl);

    // Wait for the callback event from Rust.
    const payload = await payloadPromise;

    if (payload.error || !payload.code) {
      const detail = payload.error_description || payload.error;
      throw new Error(detail ?? "No authorization code received");
    }

    // Validate state to prevent CSRF
    if (payload.state !== state) {
      throw new Error("State mismatch — possible CSRF attack");
    }

    // Exchange code for tokens
    const tokenRes = await exchangeCode(payload.code, codeVerifier);

    const authState: AuthState = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? null,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      userSub: extractSub(tokenRes.access_token),
    };

    // Await the disk write — same rationale as the refresh path.
    // Sign-in tokens MUST be durable before we let the caller assume
    // the user is signed in.
    await saveAuth(authState);
    return authState;
  } catch (err) {
    if (hasPendingAuthCleanup) {
      cleanupPendingAuth();
    }

    if (authServerStarted) {
      await invoke("stop_auth_server").catch((stopErr) => {
        console.warn("[Scrollr] Failed to stop auth server:", stopErr);
      });
    }

    lastLoginError = (err as Error).message ?? "Unknown error";
    console.error("[Scrollr] Login failed:", err);
    return null;
  }
}

/**
 * Get a valid access token, refreshing silently if near expiry.
 * Returns null if not authenticated or refresh fails.
 */
export async function getValidToken(forceRefresh = false): Promise<string | null> {
  const auth = loadAuth();
  if (!auth) return null;

  // Token still valid (with buffer) — skip if forced
  if (!forceRefresh && auth.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return auth.accessToken;
  }

  // Need to refresh
  if (!auth.refreshToken) {
    await clearAuth();
    return null;
  }

  // Mutex: only one refresh at a time
  if (!refreshPromise) {
    refreshPromise = doRefresh(auth.refreshToken).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(refreshToken: string): Promise<string | null> {
  // ── Pre-send race check ─────────────────────────────────────────
  // Multiple Tauri windows share auth state via the store but each
  // window has its own `refreshPromise` mutex. If both windows fire
  // scheduleRefresh() at roughly the same time, they both end up here
  // sending the SAME refresh token to Logto. Logto has
  // rotateRefreshToken=true: the first request rotates, the second
  // arrives with the now-invalidated token and gets 4xx.
  //
  // Before sending, re-read the store. If another window has already
  // rotated to a fresh refresh token (and the access token is still
  // valid for at least the buffer window), short-circuit and return
  // the fresh access token without making the doomed network call.
  const stored = loadAuth();
  if (
    stored &&
    stored.refreshToken &&
    stored.refreshToken !== refreshToken &&
    stored.expiresAt - Date.now() > REFRESH_BUFFER_MS
  ) {
    return stored.accessToken;
  }

  try {
    const tokenRes = await refreshTokenRequest(refreshToken);

    const authState: AuthState = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? null,
      expiresAt: Date.now() + tokenRes.expires_in * 1000,
      userSub: extractSub(tokenRes.access_token),
    };

    // CRITICAL: await the persistence. Pre-fix this was fire-and-
    // forget, which meant if the OS suspended the app inside Tauri's
    // ~100ms LazyStore autoSave debounce window, the disk would still
    // hold the OLD refresh token while in-memory had the new one. On
    // next launch the stale on-disk token would be sent to Logto,
    // tripping refresh-token reuse detection → 400 → forced logout.
    // Awaiting setStorePersisted (inside saveAuth) closes that
    // window: by the time this line returns, the disk fsync has
    // completed and the new token is durably stored.
    await saveAuth(authState);
    return authState.accessToken;
  } catch (err) {
    // Only clear auth if the refresh token was explicitly rejected
    // (4xx). Network errors preserve state so the proactive timer
    // can retry.
    const message = (err as Error).message ?? "";
    if (/Token refresh failed: 4\d\d/.test(message)) {
      // ── Post-failure race check ─────────────────────────────────
      // A 4xx here might mean a real auth failure (refresh token
      // genuinely revoked / expired)... OR it might mean we lost the
      // race against another window. Re-read the store: if a
      // newer-than-ours refresh token exists AND the access token is
      // currently valid, we lost the race and the user is still
      // authenticated. Return the fresh access token instead of
      // clearing auth.
      const fresh = loadAuth();
      if (
        fresh &&
        fresh.refreshToken &&
        fresh.refreshToken !== refreshToken &&
        fresh.expiresAt > Date.now()
      ) {
        return fresh.accessToken;
      }

      await clearAuth();
    }
    return null;
  }
}

/**
 * Check if the user has valid stored auth tokens.
 */
export function isAuthenticated(): boolean {
  const auth = loadAuth();
  return auth !== null && auth.expiresAt > Date.now();
}

/**
 * Extract user identity from the stored access token JWT. Returns null
 * fields if no auth or the claims aren't present.
 *
 * `username` is the handle, not the display name — Logto exposes it as
 * `username`, and OIDC's standard equivalent is `preferred_username`.
 * Either may be absent depending on how the account was created (a
 * social sign-in often has a name and no handle), so callers should be
 * ready to fall back to the email's local part.
 */
export function getUserIdentity(): {
  email: string | null;
  name: string | null;
  username: string | null;
} {
  const auth = loadAuth();
  const empty = { email: null, name: null, username: null };
  if (!auth) return empty;
  const payload = decodeJwtPayload(auth.accessToken);
  if (!payload) return empty;
  return {
    email: (payload.email as string) ?? null,
    name: (payload.name as string) ?? null,
    username:
      (payload.username as string) ??
      (payload.preferred_username as string) ??
      null,
  };
}

/**
 * Clear all auth state (logout). Returns the in-flight clearAuth
 * promise so callers can await disk persistence — important when the
 * UI immediately follows the logout with a sign-in (otherwise the
 * sign-in's saveAuth could race with the logout's removeAuth and
 * leave the disk in an inconsistent state). Existing call sites that
 * don't await are still functionally correct because clearAuth
 * synchronously updates the in-memory cache.
 */
export function logout(): Promise<void> {
  return clearAuth();
}

/**
 * Check if a refresh token exists (even if access token is expired).
 * Used by fetchDashboard to try the authenticated path when a refresh
 * could restore the session.
 */
export function hasRefreshToken(): boolean {
  const auth = loadAuth();
  return auth !== null && auth.refreshToken !== null;
}

// ── Initialize proactive refresh on module load ──────────────────
// If the app restarts with existing auth, this ensures the refresh
// timer is set up immediately rather than waiting for the first API call.
scheduleRefresh();
