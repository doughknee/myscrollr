/**
 * tips — first-run discovery hint primitives.
 *
 * Why this exists:
 *   The desktop app has several powerful affordances that brand-new
 *   users have no way to find without prior knowledge — most notably
 *   the ticker's right-click context menu (channels, widgets, position,
 *   "Customize Ticker") and the system-tray icon's role as the only
 *   way back to the app once the main window is closed. Pre-Phase-2
 *   users had to either accidentally discover these or be told. This
 *   module surfaces them via one-time toasts gated on
 *   `prefs.tipsShown`.
 *
 * Contract:
 *   - Each tip has a stable string id (e.g. "ticker-right-click").
 *   - Calling `showTipOnce(id, prefs, onPrefsChange, opts)` either:
 *     (a) does nothing if the id is already in `prefs.tipsShown`, OR
 *     (b) calls sonner's `toast.message` with the tip content, marks
 *         the id as shown via `onPrefsChange`, and returns true.
 *   - Marking-as-shown is durable — it goes through the normal prefs
 *     write path which persists to the Tauri store.
 *   - Tip ids are NEVER reused. If a tip needs different content,
 *     introduce a new id so users who already saw the old version see
 *     the new one. Removing tips is fine; they just never fire again.
 *
 * Why not put this in the toast callsite directly?
 *   We want a single audit point for "what tips exist?" Centralising
 *   the registry here means a future settings UI can list every tip
 *   the user has dismissed and offer a "Show me again" path.
 */

import { toast } from "sonner";
import type { AppPreferences } from "../preferences";

/**
 * Catalog of all known tip ids. Add new ids here so they can be
 * referenced from a future "Show all tips again" settings affordance
 * without grep-trawling the codebase.
 *
 * Stable ids — never rename. New tip content gets a new id.
 */
export const TIP_IDS = {
  /** First time the user opens the main window with the ticker visible. */
  TICKER_RIGHT_CLICK: "ticker-right-click",
  /** First time the user closes the main window while the app is still running. */
  TRAY_STILL_RUNNING: "tray-still-running",
} as const;

export type TipId = (typeof TIP_IDS)[keyof typeof TIP_IDS];

interface ShowTipOpts {
  /** Toast headline. */
  title: string;
  /** Toast secondary line; multi-sentence is fine but keep it short. */
  description?: string;
  /** Toast duration in ms. Default 6 seconds (slightly longer than action toasts). */
  duration?: number;
  /** Optional CTA button text. */
  actionLabel?: string;
  /** Called when the user clicks the CTA button. */
  onAction?: () => void;
}

/**
 * Fire `tipId` as a sonner toast if (and only if) the user has not
 * already seen it. Returns `true` if the tip fired, `false` if it was
 * suppressed because it was already shown.
 *
 * Marks the tip as shown synchronously before the toast renders so
 * rapid double-calls (e.g. effect runs twice in StrictMode) only
 * surface the toast once.
 */
export function showTipOnce(
  tipId: TipId,
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
  opts: ShowTipOpts,
): boolean {
  if (prefs.tipsShown.includes(tipId)) return false;

  // Mark as shown FIRST. If sonner throws or the user dismisses the
  // toast immediately, we still don't want to show it again next
  // session. The cost of a missed read is "user didn't see a hint
  // they would've ignored anyway"; the cost of double-firing is
  // "user thinks the app is buggy".
  onPrefsChange({
    ...prefs,
    tipsShown: [...prefs.tipsShown, tipId],
  });

  const action =
    opts.actionLabel && opts.onAction
      ? { label: opts.actionLabel, onClick: opts.onAction }
      : undefined;

  toast.message(opts.title, {
    id: `scrollr-tip-${tipId}`,
    description: opts.description,
    duration: opts.duration ?? 6_000,
    ...(action ? { action } : {}),
  });

  return true;
}

/**
 * Test/debug helper: imperatively reset all tipsShown so the user
 * sees them again. Wire this up to a Settings affordance later if
 * users ask for "show me the hints again".
 */
export function resetTipsShown(
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
): void {
  onPrefsChange({ ...prefs, tipsShown: [] });
}
