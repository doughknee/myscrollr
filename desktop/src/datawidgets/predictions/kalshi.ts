/**
 * Client-side Kalshi account link — typed bridge to the Tauri backend.
 *
 * ARCHITECTURE (privacy/legal): the user's Kalshi credentials live ONLY on
 * their machine. This module never sees the private key — it passes the
 * dragged-in file's *path* and the Key ID to the Rust backend, which reads,
 * validates, signs, and stores everything locally in the OS keychain. The PEM
 * is never read in JS, never sent to Scrollr servers, never logged. All access
 * is read-only (portfolio reads + read-only WS subscriptions); there is no
 * order-placing path.
 *
 * Every call is desktop-only — guarded by {@link isKalshiAvailable}. In the web
 * build (or vitest) the bridge is absent and the wizard renders a
 * desktop-only notice instead.
 */
import { invoke } from "@tauri-apps/api/core";

// ── Shapes (mirror the Rust serialize structs in src-tauri/kalshi) ──

export interface CredentialStatus {
  connected: boolean;
  key_id: string | null;
}

export interface ConnectResult {
  key_id: string;
  balance_cents: number;
}

export interface KalshiPosition {
  ticker: string;
  /** Net signed contracts: positive = YES, negative = NO. */
  position: number;
  side: "yes" | "no" | "flat";
  count: number;
  exposure_cents: number;
  realized_pnl_cents: number;
  total_traded_cents: number;
  fees_paid_cents: number;
  resting_orders_count: number;
}

export interface KalshiFill {
  ticker: string;
  side: string;
  action: string;
  count: number;
  price_cents: number;
  is_taker: boolean;
  created_time: string;
}

export interface KalshiRestingOrder {
  ticker: string;
  side: string;
  action: string;
  price_cents: number;
  remaining_count: number;
  created_time: string;
}

export interface KalshiPortfolio {
  balance_cents: number;
  positions: KalshiPosition[];
  fills: KalshiFill[];
  resting_orders: KalshiRestingOrder[];
}

/** Tauri events emitted by the authenticated live stream. */
export const KALSHI_USER_EVENT = "kalshi-user-event";
export const KALSHI_STREAM_STATUS = "kalshi-stream-status";

export type KalshiStreamStatus =
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

// ── Availability ─────────────────────────────────────────────────

/**
 * True only inside the Tauri desktop shell, where the keychain-backed
 * commands exist. The account link is a desktop-only feature (the only
 * compliance-safe surface, and the only place an OS keychain exists).
 */
export function isKalshiAvailable(): boolean {
  try {
    return (
      typeof globalThis !== "undefined" &&
      "__TAURI_INTERNALS__" in (globalThis as Record<string, unknown>)
    );
  } catch {
    return false;
  }
}

// ── Commands ─────────────────────────────────────────────────────

export function kalshiStatus(): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("kalshi_status");
}

/**
 * Validate + persist a credential. `pemPath` is the local path of the file the
 * user dragged in; the Rust side reads and validates it. Rejects with
 * plain-language copy on failure (already user-facing — surface it directly).
 */
export function kalshiConnect(args: {
  keyId: string;
  pemPath: string;
}): Promise<ConnectResult> {
  return invoke<ConnectResult>("kalshi_connect", {
    keyId: args.keyId,
    pemPath: args.pemPath,
  });
}

export function kalshiDisconnect(): Promise<void> {
  return invoke<void>("kalshi_disconnect");
}

export function kalshiPortfolio(): Promise<KalshiPortfolio> {
  return invoke<KalshiPortfolio>("kalshi_portfolio");
}

export function kalshiStartUserStream(): Promise<void> {
  return invoke<void>("kalshi_start_user_stream");
}

export function kalshiStopUserStream(): Promise<void> {
  return invoke<void>("kalshi_stop_user_stream");
}
