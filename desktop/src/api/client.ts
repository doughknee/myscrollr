/**
 * Desktop API client — uses `fetch` from `@tauri-apps/plugin-http`
 * to bypass browser CORS (Rust reqwest under the hood).
 *
 * Two request helpers:
 *   - `request<T>()` — unauthenticated (public endpoints)
 *   - `authFetch<T>()` — automatically attaches Bearer token via getValidToken()
 */
import { fetch } from "@tauri-apps/plugin-http";
import { getValidToken } from "../auth";

// ── Constants ────────────────────────────────────────────────────

import { API_BASE } from "../config";
export { API_BASE };

// ── Request helpers ─────────────────────────────────────────────

/** Default hard timeout for all outbound requests (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Error thrown by `request()` / `authFetch()` on non-2xx responses.
 * Preserves the HTTP status code so callers can react to specific
 * failures (e.g. 429 rate-limiting) without string-matching on the
 * message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Wrap `fetch` with an AbortController-driven timeout. Prevents hung
 * requests (slow backend, dropped connection, frozen proxy) from
 * stalling the UI indefinitely. Callers may still pass their own
 * `signal`; if both are set, whichever fires first wins.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Honor any caller-provided signal by aborting the controller when it fires.
  const callerSignal = options.signal ?? undefined;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

/** Parse error body and throw — shared by request() and authFetch(). */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new ApiError(
      response.status,
      (error as { error?: string }).error || "Request failed",
    );
  }

  return response.json() as Promise<T>;
}

/** Unauthenticated request — use for public endpoints. */
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...options,
    headers: { ...options.headers },
  });

  return handleResponse<T>(response);
}

/**
 * Authenticated request — resolves a valid token via getValidToken()
 * (handles silent refresh) and attaches it as a Bearer header.
 *
 * On 401, forces a token refresh and retries the request once.
 */
export async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getValidToken();
  const headers: HeadersInit = { ...options.headers };

  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  } else if (import.meta.env.DEV) {
    console.debug(
      "[authFetch] Token unavailable for authed endpoint; proceeding unauthenticated (may 401):",
      path,
    );
  }

  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 401 retry: force a token refresh and retry the request once
  if (response.status === 401 && token) {
    const newToken = await getValidToken(true);
    if (newToken && newToken !== token) {
      const retryResponse = await fetchWithTimeout(`${API_BASE}${path}`, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
      });
      return handleResponse<T>(retryResponse);
    }
  }

  return handleResponse<T>(response);
}

// ── Channel Types ───────────────────────────────────────────────

export type ChannelType = "finance" | "sports" | "fantasy" | "rss";

export interface Channel {
  id: number;
  channel_type: ChannelType;
  enabled: boolean;
  /** Whether this channel's chips appear on the ticker. Server emits both
   * `ticker_enabled` (preferred) and `visible` (legacy alias) — read either
   * via {@link isChannelTickerEnabled}. */
  ticker_enabled: boolean;
  /** @deprecated Use {@link ticker_enabled}. Server still emits this for
   *  v1.0.3 compatibility; will be removed in a future release. */
  visible?: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Read the ticker-enabled flag, tolerant of both the new
 * (`ticker_enabled`) and legacy (`visible`) field names. Returns `true`
 * by default if neither is set so freshly-added channels appear on the
 * ticker.
 */
export function isChannelTickerEnabled(ch: {
  ticker_enabled?: boolean;
  visible?: boolean;
}): boolean {
  if (typeof ch.ticker_enabled === "boolean") return ch.ticker_enabled;
  if (typeof ch.visible === "boolean") return ch.visible;
  return true;
}

export interface RssChannelConfig {
  feeds?: Array<{ name: string; url: string; is_custom?: boolean }>;
}

// ── Channels API ────────────────────────────────────────────────

export const channelsApi = {
  getAll: () =>
    authFetch<{ channels: Array<Channel> }>("/users/me/channels"),

  create: (channelType: ChannelType, config: Record<string, unknown> = {}) =>
    authFetch<Channel>("/users/me/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_type: channelType, config }),
    }),

  update: (
    channelType: ChannelType,
    data: {
      enabled?: boolean;
      ticker_enabled?: boolean;
      config?: Record<string, unknown>;
    },
  ) =>
    authFetch<Channel>(`/users/me/channels/${channelType}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  delete: (channelType: ChannelType) =>
    authFetch<{ status: string; message: string }>(
      `/users/me/channels/${channelType}`,
      { method: "DELETE" },
    ),
};

// ── Channel ticker toggle ───────────────────────────────────────

/**
 * Toggle whether a channel's chips appear on the ticker (and optionally
 * mark the channel itself enabled). Returns a promise that resolves
 * when the API call completes. Callers are responsible for invalidating
 * queries afterward.
 *
 * The wire field is `ticker_enabled` (v1.0.4+); the server also accepts
 * the legacy `visible` field for older clients.
 */
export async function toggleChannelVisibility(
  channelType: ChannelType,
  tickerEnabled: boolean,
  enabled?: boolean,
): Promise<void> {
  const payload: { ticker_enabled: boolean; enabled?: boolean } = {
    ticker_enabled: tickerEnabled,
  };
  if (enabled !== undefined) payload.enabled = enabled;
  await channelsApi.update(channelType, payload);
}

// ── Subscription Types & API ────────────────────────────────────

export interface SubscriptionInfo {
  plan: string;
  status: "none" | "active" | "trialing" | "canceling" | "canceled" | "past_due";
  current_period_end?: string;
  lifetime: boolean;
  pending_downgrade_plan?: string;
  scheduled_change_at?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  trial_end?: number;
  had_prior_sub: boolean;
}

export async function fetchSubscription(): Promise<SubscriptionInfo> {
  return authFetch<SubscriptionInfo>("/users/me/subscription");
}

// ── User Overview ───────────────────────────────────────────────

/**
 * Aggregated account view returned by `GET /users/me/overview`.
 *
 * The `subscription` field here is DB-only (no live Stripe enrichment) —
 * it carries plan/status/period/lifetime flags but NOT amount/currency/
 * interval/trial_end. Callers needing live billing detail must still hit
 * `fetchSubscription()` against `/users/me/subscription`.
 */
export interface UserOverview {
  identity: {
    sub: string;
    email: string;
    name: string;
    username: string;
  };
  tier: {
    current: string;
    is_super_user: boolean;
    label: string;
    limits: {
      symbols: number;
      feeds: number;
      custom_feeds: number;
      leagues: number;
      fantasy: number;
      max_ticker_rows: number;
      max_ticker_customization: boolean;
    };
  };
  subscription: SubscriptionInfo | null;
  channels: {
    total: number;
    enabled: number;
    by_type: Array<{
      type: string;
      enabled: boolean;
      ticker_enabled: boolean;
    }>;
  };
  fantasy: {
    yahoo_connected: boolean;
    yahoo_synced: boolean;
    league_count: number;
  } | null;
  gdpr: {
    deletion_status: "none" | "pending" | "canceled" | "purged";
    requested_at: string | null;
    purge_at: string | null;
  };
  links: {
    logto_account: string;
  };
}

export async function fetchOverview(): Promise<UserOverview> {
  return authFetch<UserOverview>("/users/me/overview");
}

// ── Account self-service ────────────────────────────────────────
//
// Update display name and/or primary email via Logto Management API
// (proxied through our own `/users/me/profile` so we don't ship the
// M2M secret to the desktop client). Username is intentionally not
// exposed — the server rejects it with 403.

export interface UpdateProfileResponse {
  status: string;
  name?: string;
  email?: string;
}

export async function updateProfile(payload: {
  name?: string;
  email?: string;
}): Promise<UpdateProfileResponse> {
  return authFetch<UpdateProfileResponse>("/users/me/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Trigger a password-reset email. The server emails the user a link
 * to the Logto sign-in page where they can use the standard "Forgot
 * password?" affordance — we don't reveal a token client-side.
 *
 * `authFetch` parses JSON; this endpoint returns 204 No Content, so
 * skip it and use the raw token-aware fetch path.
 */
export async function requestPasswordReset(): Promise<void> {
  const token = await getValidToken();
  const headers: HeadersInit = {};
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetchWithTimeout(
    `${API_BASE}/users/me/password/reset`,
    { method: "POST", headers },
  );
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `password reset failed: ${response.status}`,
    );
  }
}

/**
 * Fetch the GDPR data export ZIP. Bypasses `authFetch` because that helper
 * parses JSON; we need the raw Response to call `.blob()`.
 */
export async function exportUserData(): Promise<Blob> {
  const token = await getValidToken();
  const headers: HeadersInit = {};
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(`${API_BASE}/users/me/export`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new ApiError(response.status, `export failed: ${response.status}`);
  }

  return response.blob();
}

// ── RSS Types & API ─────────────────────────────────────────────

export interface TrackedFeed {
  url: string;
  name: string;
  category: string;
  is_default: boolean;
  consecutive_failures: number;
  last_error?: string;
  last_success_at?: string;
}

export const rssApi = {
  /**
   * Fetch the per-user feed catalog. The catalog returns curated
   * default feeds plus the requesting user's own custom feeds — never
   * other users' custom feeds.
   *
   * Endpoint is now Auth: true on the gateway (was Auth: false before
   * the multi-tenant fix); use authFetch so the X-User-Sub header is
   * applied. Pass includeFailing to see broken feeds (used by My
   * Feeds for health badges on already-subscribed feeds).
   */
  getCatalog: (opts?: { includeFailing?: boolean }) => {
    const params = opts?.includeFailing ? "?include_failing=true" : "";
    return authFetch<Array<TrackedFeed>>(`/rss/feeds${params}`);
  },

  /** Delete a custom (non-default) feed from the catalog */
  deleteFeed: (url: string) =>
    authFetch<{ status: string; message: string }>("/rss/feeds", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
};


