/**
 * Which window is allowed to touch a process-wide singleton.
 *
 * `App.tsx` renders once per ticker window (`ticker`, `ticker-2`, … — one
 * per monitor since v1.6.0), so anything it does that is not per-window
 * happens N times. For the SSE stream that is not merely wasteful: Rust
 * keeps ONE task (`start_sse` cancels the previous one, `stop_sse` kills it
 * and broadcasts `disconnected` to every window), so N windows racing the
 * same connection means N logins on the server and a banner that flaps.
 *
 * Exactly one window is elected owner:
 *   - the primary ticker window (`ticker`) whenever it exists — it outlives
 *     the main window, which closes to the tray under
 *     `startup.startInBackground` while the bar keeps streaming;
 *   - the main window when there is no ticker window at all (the webview
 *     failed to build — see "continuing without it" in `lib.rs`).
 */
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";

/** `ticker`, `ticker-2`, … — mirrors `is_ticker_label` in commands/window.rs. */
export function isTickerLabel(label: string): boolean {
  return label === "ticker" || label.startsWith("ticker-");
}

/**
 * The first ticker window. `sync_ticker_windows` labels monitor index 0
 * `ticker` and never destroys it, so this is a stable single winner among
 * the ticker windows — no election round-trip needed.
 */
export function isPrimaryTicker(): boolean {
  return getCurrentWindow().label === "ticker";
}

/** True in the one window that may start/stop the shared SSE connection. */
export async function ownsSharedConnection(): Promise<boolean> {
  const label = getCurrentWindow().label;
  if (isTickerLabel(label)) return label === "ticker";
  return !(await getAllWindows()).some((w) => isTickerLabel(w.label));
}
