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
import {
  getStore,
  onStoreChange,
  readStoreShared,
  setStorePersisted,
  removeStorePersisted,
} from "./lib/store";
import { ownsSharedConnection } from "./lib/windowRole";
import { openExternal } from "./lib/openExternal";
import { fetchWithTimeout } from "./api/fetchWithTimeout";

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
  /**
   * When this token was obtained, by the local clock (RC-6). Absent in a
   * session saved before it existed, which then behaves as it always did.
   */
  refreshedAt?: number;
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

/**
 * Moves on every sign-out, in this window or another (D2-6). Anything that
 * awaited across one (a token refresh, a stream start) checks it before
 * acting on the result, so a sign-out is never undone by a late answer.
 */
let signOutGen = 0;
export function signOutGeneration(): number {
  return signOutGen;
}

async function clearAuth(): Promise<void> {
  signOutGen++;
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
  signal?: AbortSignal,
): Promise<TokenResponse> {
  // The whole exchange is under the client's usual deadline (RC-7), and
  // Cancel ends it at once (D3-8).
  return fetchWithTimeout(
    `${API_RESOURCE}/extension/token`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    },
    async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<TokenResponse>;
    },
  );
}

async function refreshTokenRequest(
  refreshToken: string,
): Promise<TokenResponse> {
  // Under the client's usual deadline (RC-7): a timeout is a network
  // failure, which keeps the session and retries.
  return fetchWithTimeout(
    `${API_RESOURCE}/extension/token/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    readRefreshResponse,
  );
}

async function readRefreshResponse(res: Response): Promise<TokenResponse> {
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
 * When the access token actually expires.
 *
 * `expires_in` is a duration measured against OUR clock at the moment the
 * response lands; the JWT's own `exp` is the absolute instant every API
 * replica checks. When the two disagree — a system clock that was wrong at
 * save time and later corrected, a suspended laptop, a slow exchange —
 * `Date.now() + expires_in` can sit comfortably in the future while the
 * token is already dead. getValidToken() then hands that corpse to every
 * request, never refreshes it (it looks fresh), and the server answers 401
 * with "token is expired". That is how a session gets stuck (REL-238).
 * Prefer `exp`; fall back to `expires_in` only when the JWT has none.
 */
function expiryOf(accessToken: string, expiresIn: number): number {
  const exp = decodeJwtPayload(accessToken)?.exp;
  return typeof exp === "number" ? exp * 1000 : Date.now() + expiresIn * 1000;
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
 *
 * Every window (each ticker, the main window) is its own JS context running
 * this module, but a refresh token can be spent once: Logto rotates it and
 * refuses the old one after a grace of a couple of seconds ("refresh token
 * already used"). So only the window that owns the shared connection
 * refreshes on a timer (SCROLLR-248), and it does so a minute BEFORE any
 * window's on-demand threshold in getValidToken(), so the others normally
 * find the new token already stored and never call Logto at all. The old
 * scheme — a timer in every window, staggered by random jitter — is what
 * put a second window on the wire seconds after the first.
 *
 * Self-sustaining: saveAuth() and every cross-window change to the session
 * re-schedule it. On network failure the owner retries every 30s.
 */
const PROACTIVE_LEAD_MS = 2 * REFRESH_BUFFER_MS;

/**
 * A token obtained less than this long ago is not refreshed again, whatever
 * the local clock says about its expiry (RC-6). With a clock running ahead
 * of the server's by more than the token's life, every new token already
 * looks expired, and the timer and every getValidToken() refreshed in a
 * tight loop. A forced refresh (the server refused the token) still runs.
 */
const MIN_REFRESH_INTERVAL_MS = 5 * 60_000;

/** Obtained moments ago by the local clock (a clock that jumped back is not "moments"). */
function justRefreshed(auth: AuthState): boolean {
  if (auth.refreshedAt === undefined) return false;
  const age = Date.now() - auth.refreshedAt;
  return age >= 0 && age < MIN_REFRESH_INTERVAL_MS;
}

/** Good to use without asking Logto: not near expiry, or just obtained. */
function looksFresh(auth: AuthState): boolean {
  return auth.expiresAt - Date.now() > REFRESH_BUFFER_MS || justRefreshed(auth);
}

/**
 * A token the server refused is not refreshed again if it was obtained less
 * than this long ago (D3-6): while core refuses freshly issued tokens, every
 * 401 would otherwise spend a Logto rotation, from every desktop at once.
 */
const FORCED_REFRESH_FLOOR_MS = 60_000;

/**
 * Exported as `rearmRefresh` for the election: a window that just BECAME the
 * owner still holds the spent, non-null timer of its non-owner days, so
 * nothing else would re-arm it.
 */
export { scheduleRefresh as rearmRefresh };

function scheduleRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const auth = loadAuth();
  if (!auth || !auth.refreshToken) return;

  const performRefresh = async () => {
    const current = loadAuth();
    if (!current?.refreshToken) return;
    // A non-owner leaves its spent timer in place so getValidToken does not
    // re-arm it; the owner's refresh reaches us as a store change, which does.
    if (!(await ownsSharedConnection())) return;
    refreshTimer = null;
    const token = await refresh(current.refreshToken);
    // If refresh failed but we still have a refresh token (network
    // error), retry in 30s.
    if (!token && loadAuth()?.refreshToken && refreshTimer === null) {
      refreshTimer = setTimeout(performRefresh, 30_000);
    }
    // If it succeeded, saveAuth() or the store change already re-scheduled.
  };

  const untilFloor = justRefreshed(auth)
    ? auth.refreshedAt! + MIN_REFRESH_INTERVAL_MS - Date.now()
    : 0;
  refreshTimer = setTimeout(
    performRefresh,
    Math.max(0, untilFloor, auth.expiresAt - Date.now() - PROACTIVE_LEAD_MS),
  );
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
 *
 * `onAuthUrl`, if given, is called with the one-time Logto authorization
 * URL right before it's opened — the caller uses it to power the "copy
 * the sign-in link" fallback (SCROLLR-8) for when the opener silently
 * fails to launch a browser (the AppImage env-injection trap).
 *
 * `signal`, when aborted (Cancel on the sign-in overlay), ends the attempt:
 * the callback listener and the 5-minute timer go, the callback server
 * stops, and nothing is saved (D2-11).
 */
export async function login(
  onAuthUrl?: (url: string) => void,
  signal?: AbortSignal,
): Promise<AuthState | null> {
  let cleanupPendingAuth = () => {};
  let hasPendingAuthCleanup = false;
  let authServerStarted = false;

  lastLoginError = null;

  const cancelled = () => new Error("Sign-in cancelled");
  const throwIfCancelled = () => {
    if (signal?.aborted) throw cancelled();
  };
  const state = generateRandomHex(16);

  try {
    assertAuthConfig();

    const codeVerifier = generateRandomHex(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    throwIfCancelled();

    // Start the callback server (returns immediately, listens in background).
    // It only answers a callback carrying this attempt's state (D2-12).
    const startArgs = { expectedState: state };
    try {
      await invoke("start_auth_server", startArgs);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("already running")) {
        // Previous login attempt didn't clean up — stop and retry once
        await invoke("stop_auth_server").catch(() => {});
        await invoke("start_auth_server", startArgs);
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
    throwIfCancelled();

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
    onAuthUrl?.(authUrl);

    let resolveListenerReady: () => void = () => {};
    const listenerReadyPromise = new Promise<void>((resolve) => {
      resolveListenerReady = resolve;
    });

    const payloadPromise = new Promise<AuthCallbackPayload>(
      (resolve, reject) => {
        let unlisten: (() => void) | null = null;
        let settled = false;

        const dispose = () => {
          settled = true;
          clearTimeout(timer);
          unlisten?.();
          signal?.removeEventListener("abort", onAbort);
          hasPendingAuthCleanup = false;
        };
        const onAbort = () => {
          dispose();
          reject(cancelled());
        };

        cleanupPendingAuth = dispose;
        hasPendingAuthCleanup = true;

        const timer = setTimeout(() => {
          dispose();
          reject(new Error("Login timed out after 5 minutes"));
        }, 300_000);
        signal?.addEventListener("abort", onAbort, { once: true });

        listen<AuthCallbackPayload>("auth-callback", (event) => {
          // Only this attempt's callback counts, checked before anything
          // in it is read: another local page can request /callback with
          // an `error` of its choosing (D2-12). Keep waiting for the real one.
          if (event.payload.state !== state) return;
          dispose();
          resolve(event.payload);
        })
          .then((fn) => {
            if (settled) {
              fn(); // already resolved/rejected — clean up immediately
            } else {
              unlisten = fn;
              resolveListenerReady();
            }
          })
          .catch((err) => {
            dispose();
            reject(err);
          });
      },
    );

    // Open in system browser after the callback listener is ready (CN-8):
    // a callback that arrived before it would be lost. A listener that
    // failed rejects payloadPromise, which the race surfaces.
    // Routed through the Rust `open_external` command (not
    // `@tauri-apps/plugin-shell`'s `open`) so Linux gets a cleaned
    // environment — inside an AppImage, `xdg-open` run with the
    // AppRun-injected env silently fails to launch a browser
    // (SCROLLR-8). Windows/macOS still delegate to plugin-shell there.
    await Promise.race([listenerReadyPromise, payloadPromise]);
    await openExternal(authUrl);

    // Wait for the callback event from Rust.
    const payload = await payloadPromise;

    if (payload.error || !payload.code) {
      const detail = payload.error_description || payload.error;
      throw new Error(detail ?? "No authorization code received");
    }

    // Exchange code for tokens
    const tokenRes = await exchangeCode(payload.code, codeVerifier, signal);
    throwIfCancelled(); // Cancel while the code was being exchanged

    const authState: AuthState = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? null,
      expiresAt: expiryOf(tokenRes.access_token, tokenRes.expires_in),
      userSub: extractSub(tokenRes.access_token),
      refreshedAt: Date.now(),
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

    // Only this attempt's server: a cancelled attempt can end after the
    // user has started the next one (D3-8).
    if (authServerStarted) {
      await invoke("stop_auth_server", { expectedState: state }).catch((stopErr) => {
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
 *
 * `refused`, with `forceRefresh`, is the token the server just answered 401
 * to (D3-6). If another token is stored by now, someone already refreshed:
 * it is used as is unless it is near expiry. If the refused one is stored
 * and under a minute old, it is returned without spending a refresh.
 */
export async function getValidToken(
  forceRefresh = false,
  refused?: string,
): Promise<string | null> {
  const auth = loadAuth();
  if (!auth) return null;

  if (forceRefresh && refused !== undefined) {
    if (auth.accessToken !== refused) forceRefresh = false;
    else if (auth.refreshedAt !== undefined) {
      const age = Date.now() - auth.refreshedAt;
      if (age >= 0 && age < FORCED_REFRESH_FLOOR_MS) return auth.accessToken;
    }
  }

  // Token still valid (with buffer), or just obtained — skip if forced
  if (!forceRefresh && looksFresh(auth)) {
    // After a restart the store loads after this module, so the first
    // token read is where the proactive timer gets armed.
    if (refreshTimer === null) scheduleRefresh();
    return auth.accessToken;
  }

  // Need to refresh
  if (!auth.refreshToken) {
    await clearAuth();
    return null;
  }

  return refresh(auth.refreshToken);
}

/** One refresh at a time within this window. */
function refresh(refreshToken: string): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh(refreshToken).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(refreshToken: string): Promise<string | null> {
  // ── Pre-send check against the SHARED store ─────────────────────
  // This window's cache can lag the store every window shares (it only
  // moves on our own writes and on change events), and until SCROLLR-248
  // the main window's never moved at all. Sending a token another window
  // has already rotated is exactly the "refresh token already used" in
  // Logto's audit log. So ask the shared store what the session is now.
  const stored = await readStoreShared<AuthState>(STORAGE_KEY);
  if (!stored?.refreshToken) return null; // signed out elsewhere
  if (stored.refreshToken !== refreshToken) {
    // Another window already rotated: use its token, and only spend the
    // current refresh token if even that access token is near expiry.
    if (looksFresh(stored)) {
      return stored.accessToken;
    }
    refreshToken = stored.refreshToken;
  }

  const gen = signOutGen;
  try {
    const tokenRes = await refreshTokenRequest(refreshToken);
    // Signed out while the answer was on its way: writing it back would
    // sign the user in again (D2-6).
    if (gen !== signOutGen) return null;
    // Another window signed out, or someone signed in, while the answer was
    // on its way, and this window has not heard yet (D3-9): keep what the
    // shared store holds unless it still has the token that was sent.
    const now = await readStoreShared<AuthState>(STORAGE_KEY);
    if (now?.refreshToken !== refreshToken) {
      return now?.refreshToken ? now.accessToken : null;
    }

    const authState: AuthState = {
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token ?? null,
      expiresAt: expiryOf(tokenRes.access_token, tokenRes.expires_in),
      userSub: extractSub(tokenRes.access_token),
      refreshedAt: Date.now(),
    };

    // CRITICAL: await the persistence. Pre-fix this was fire-and-
    // forget, which meant if the OS suspended the app inside Tauri's
    // ~100ms LazyStore autoSave debounce window, the disk would still
    // hold the OLD refresh token while in-memory had the new one. On
    // next launch the stale on-disk token would be sent to Logto,
    // tripping refresh-token reuse detection → 400 → forced logout.
    await saveAuth(authState);
    return authState.accessToken;
  } catch (err) {
    // Only clear auth if Logto said the refresh token is dead: a 400/401
    // naming `invalid_grant` (expired, revoked, already used; matched
    // anywhere in the body, so `"error"` or Logto's `"code":"oidc.…"` both
    // count). Any other failure, a 429, a 408, a proxy's 403, a timeout,
    // keeps the session so the proactive timer can retry (RC-12).
    const message = (err as Error).message ?? "";
    if (/^Token refresh failed: 40[01] .*invalid_grant/s.test(message)) {
      // A refusal ends the session only if the refused token is the one
      // the shared store still holds. If another window rotated while
      // ours was in flight we merely lost a race — clearing here would
      // sign every window out of a session that is fine.
      const now = await readStoreShared<AuthState>(STORAGE_KEY);
      if (now?.refreshToken && now.refreshToken !== refreshToken) {
        return now.expiresAt > Date.now() ? now.accessToken : null;
      }
      if (now) await clearAuth();
    }
    return null;
  }
}

/**
 * Check if the user has valid stored auth tokens. A token obtained moments
 * ago counts whatever its expiry says by the local clock: with a clock
 * running fast every new token looks expired, and the bar tore itself down
 * at each refresh (D3-10).
 */
export function isAuthenticated(): boolean {
  const auth = loadAuth();
  return auth !== null && (auth.expiresAt > Date.now() || justRefreshed(auth));
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

/**
 * True when nothing usable is stored at all — never signed in, or signed
 * out by `clearAuth()` after a refresh the server refused. Distinct from
 * `!isAuthenticated()`, which is also true while a refresh token could
 * still restore the session.
 */
export function isSignedOut(): boolean {
  return loadAuth() === null;
}

/** The signed-in account's id (the token's `sub`), or null. */
export function currentUserSub(): string | null {
  return loadAuth()?.userSub ?? null;
}

// ── Session-expired signal ───────────────────────────────────────
//
// A 401 nobody can refresh past means the session is over, but until
// REL-238 nothing in the UI said so. `fetchDashboard` catches the 401
// and falls back to /public/feed, so reads kept rendering and the app
// looked healthy; only writes failed, one per-action toast at a time
// ("Couldn't hide Crypto"). With no way back to a sign-in prompt, the
// only escape anyone found was reinstalling — which works solely
// because it deletes scrollr.json.
//
// A plain module-level listener set rather than the store: this is a
// per-window signal about the here and now, not state to persist, and
// each window's React tree wants it immediately.

const sessionExpiredListeners = new Set<() => void>();

/** Subscribe to the signal. Returns an unsubscribe fn. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/** Announce that the stored session is gone and cannot be refreshed. */
export function notifySessionExpired(): void {
  // Copy first: a listener may unsubscribe itself while we iterate.
  for (const listener of [...sessionExpiredListeners]) listener();
}

// ── Initialize proactive refresh on module load ──────────────────
// If the app restarts with existing auth, this ensures the refresh
// timer is set up immediately rather than waiting for the first API call.
scheduleRefresh();

// Another window signed in, refreshed or signed out: this window's cache
// has already moved (lib/store), so re-arm the timer against the new expiry.
onStoreChange<AuthState | null | undefined>(STORAGE_KEY, (value) => {
  if (!value) signOutGen++; // signed out in another window (D2-6)
  scheduleRefresh();
});
