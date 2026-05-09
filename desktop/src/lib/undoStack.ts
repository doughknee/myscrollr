/**
 * undoStack — module-level snapshot ring buffer for undoable actions.
 *
 * Why this exists:
 *   Pre-Phase-1 the desktop app had no undo affordance anywhere.
 *   Deleting a ticker row, removing a widget, setting a source to Off,
 *   resetting a category — all permanent the moment you clicked. Users
 *   reported (and we observed) that the cost of "did I just lose my
 *   careful 3-row setup?" anxiety was higher than the cost of building
 *   a real undo system.
 *
 * Design:
 *   - Snapshots are full `AppPreferences` blobs, deep-cloned via
 *     `structuredClone`. Cheaper to reason about than per-field diffs;
 *     each snapshot is ~50KB of RAM, so the 20-entry cap costs about
 *     1MB worst case. Acceptable for the recoverability win.
 *   - Pure module state, no React. Hooks (`useUndoableAction`) wrap
 *     this module to integrate with sonner toasts.
 *   - Snapshots auto-expire after 60s. The toast itself only stays on
 *     screen for 5s, but the underlying snapshot lives longer so a
 *     fast user clicking Undo right as the toast fades doesn't get a
 *     stale-snapshot error.
 *   - Cap of 20 snapshots prevents unbounded growth if a user
 *     rapid-fires destructive actions (e.g. clearing 30 widgets).
 *     Oldest entries are evicted FIFO once the cap is hit.
 *   - GC is *opt-in* — the consumer (`__root.tsx`) calls `gcExpired`
 *     on a timer. We don't run a per-module timer here so tests stay
 *     deterministic and the module stays import-cheap.
 *
 * Threading model:
 *   This is single-threaded JS state. Both desktop windows (ticker +
 *   main) load this module independently — they each maintain their
 *   own snapshot stack. A snapshot pushed in the main window is NOT
 *   visible to the ticker window. That's intentional: undo affordances
 *   live in the main window's UI; the ticker window mutates prefs but
 *   doesn't surface undo toasts (it's 228px tall, no room).
 */

import type { AppPreferences } from "../preferences";

/** Single snapshot entry held in the ring buffer. */
export interface Snapshot {
  /** Opaque id used by callers to restore a specific snapshot. */
  id: string;
  /** Human-readable label shown in the undo toast (e.g. "Removed Row 2"). */
  label: string;
  /** Deep-cloned AppPreferences as of the moment before the mutation. */
  prefs: AppPreferences;
  /** Push time (ms since epoch), used by `gcExpired`. */
  timestamp: number;
}

/** Hard cap on stack size. Oldest entries are evicted FIFO past this. */
export const MAX_SNAPSHOTS = 20;

/**
 * How long a snapshot remains restorable after creation.
 *
 * The visible undo toast only lasts 5s, but we keep the snapshot
 * around longer so a user who mouse-hovers the toast (sonner pauses
 * the dismiss timer on hover) and clicks Undo right as it fades still
 * gets a successful restore.
 */
export const GC_AGE_MS = 60_000;

const stack: Snapshot[] = [];

let idCounter = 0;
function newId(): string {
  // Tiny monotonic id — uniqueness is per-process; the snapshot stack
  // is module-scoped so collisions across processes don't matter. We
  // avoid `crypto.randomUUID` to keep this importable in test environments
  // that don't polyfill crypto. The counter resets per page load,
  // which is fine because the stack also resets per page load.
  idCounter += 1;
  return `snap-${idCounter}-${Date.now().toString(36)}`;
}

/**
 * Push a snapshot of `prefs` onto the stack with the given user-facing
 * label. Returns the snapshot id, which the caller passes to
 * `restoreSnapshot` if the user clicks Undo.
 *
 * Deep-clones via `structuredClone` so subsequent mutations to the
 * caller's prefs object don't affect the snapshot.
 */
export function pushSnapshot(label: string, prefs: AppPreferences): string {
  const snapshot: Snapshot = {
    id: newId(),
    label,
    prefs: structuredClone(prefs),
    timestamp: Date.now(),
  };
  stack.push(snapshot);
  // Evict oldest entries past the cap. Splice from the front so we
  // keep the most recent MAX_SNAPSHOTS entries.
  while (stack.length > MAX_SNAPSHOTS) {
    stack.shift();
  }
  return snapshot.id;
}

/**
 * Look up a snapshot by id and return a fresh deep clone of its prefs.
 *
 * Returns `null` if the snapshot has been GC'd or was never pushed.
 * Callers should treat this defensively — show a small "Couldn't undo"
 * toast rather than crashing.
 *
 * Note: restoring does NOT remove the snapshot from the stack. A user
 * could theoretically click Undo, then click Undo again on a fresh
 * toast and get the same restore. In practice toasts are
 * one-shot-per-action so this doesn't matter; if it ever does we can
 * add a `consumeSnapshot` variant.
 */
export function restoreSnapshot(id: string): AppPreferences | null {
  const snapshot = stack.find((s) => s.id === id);
  if (!snapshot) return null;
  return structuredClone(snapshot.prefs);
}

/** Return the most recently pushed snapshot, or null if the stack is empty. */
export function getLatest(): Snapshot | null {
  return stack[stack.length - 1] ?? null;
}

/**
 * Drop snapshots older than `GC_AGE_MS`. Called periodically by the
 * shell (`__root.tsx`); also called by tests when they advance time.
 */
export function gcExpired(now: number = Date.now()): void {
  const cutoff = now - GC_AGE_MS;
  // Remove from the front while head is expired. Stack is push-only
  // append, so timestamps are monotonically non-decreasing → walking
  // from the front is correct.
  while (stack.length > 0 && stack[0].timestamp < cutoff) {
    stack.shift();
  }
}

/**
 * Clear the entire stack. Intended for tests; production code never
 * needs this (snapshots GC themselves and reset on page reload).
 */
export function clearAll(): void {
  stack.length = 0;
  idCounter = 0;
}

/** Test-only accessor — returns the current stack length. */
export function _getStackSize(): number {
  return stack.length;
}
