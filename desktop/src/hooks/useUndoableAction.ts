/**
 * useUndoableAction — wrap a destructive prefs mutation with undo.
 *
 * Usage:
 *
 *   const undoable = useUndoableAction();
 *
 *   undoable(
 *     { label: "Removed Row 2" },
 *     (prefs) => removeTickerRow(prefs, 1),
 *   );
 *
 * The hook reads `prefs` and `onPrefsChange` from `useShell()`, takes
 * a snapshot of the current prefs, applies your mutator, and shows a
 * sonner toast with an Undo button. Clicking Undo restores the prefs
 * blob from the snapshot via `onPrefsChange` (which also broadcasts
 * to the ticker window via the existing store sync, so undo works
 * cross-window).
 *
 * Behavior contract:
 *   - Toast lives 5 seconds. Snapshot lives 60 seconds. Click Undo
 *     within 60s and it works even if the toast already faded.
 *   - Successive undoable actions REPLACE the previous toast (sonner's
 *     `id` parameter forces this). Only the latest action is undoable
 *     via the visible toast — older snapshots remain in the stack but
 *     have no UI surface.
 *   - If the mutator returns the same prefs reference (no-op), we
 *     skip the snapshot AND the toast. Prevents noise like "Removed
 *     Row 1" after a click that didn't actually delete anything (e.g.
 *     out-of-bounds index).
 *   - No keyboard shortcut. Per the Phase 1 brainstorm, Cmd+Z would
 *     conflict with text-input undo in places like ProfileField and
 *     RSS-feed-name inputs, and the smart-conflict-resolution path
 *     wasn't worth the complexity for the first cut.
 */

import { useCallback } from "react";
import { toast } from "sonner";
import { useShell } from "../shell-context";
import { pushSnapshot, restoreSnapshot } from "../lib/undoStack";
import type { AppPreferences } from "../preferences";

/** Single, replaceable toast id so successive actions don't stack. */
const UNDO_TOAST_ID = "scrollr-undo";

/** How long the toast stays on screen before auto-dismissing. */
const TOAST_DURATION_MS = 5_000;

interface UndoableActionOptions {
  /**
   * Headline label shown in the toast (e.g. "Removed Row 2",
   * "Reset ticker style"). Keep it short — the toast is single-line.
   */
  label: string;
  /**
   * Optional secondary line shown beneath the label. Use sparingly;
   * sonner truncates long descriptions.
   */
  description?: string;
}

type Mutator = (current: AppPreferences) => AppPreferences;

/**
 * Returns a function `(opts, mutator) => void` that executes the
 * mutation and shows an undo toast. The function identity is stable
 * across renders (useCallback) so it's safe to put in dependency
 * arrays.
 */
export function useUndoableAction(): (
  opts: UndoableActionOptions,
  mutator: Mutator,
) => void {
  const { prefs, onPrefsChange } = useShell();

  return useCallback(
    (opts: UndoableActionOptions, mutator: Mutator) => {
      const before = prefs;
      const after = mutator(before);

      // No-op guard: if the mutator returned the same reference, the
      // action did nothing meaningful. Don't snapshot, don't toast,
      // don't call onPrefsChange — it would just trigger a no-op
      // store write and confuse the user with a phantom undo toast.
      if (after === before) return;

      const snapshotId = pushSnapshot(opts.label, before);
      onPrefsChange(after);

      toast.message(opts.label, {
        id: UNDO_TOAST_ID,
        description: opts.description,
        duration: TOAST_DURATION_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const restored = restoreSnapshot(snapshotId);
            if (restored) {
              onPrefsChange(restored);
              toast.success("Restored", {
                id: UNDO_TOAST_ID,
                duration: 1_500,
              });
            } else {
              // Snapshot was GC'd or otherwise vanished. Surface a
              // friendly error instead of silently doing nothing —
              // the user clicked Undo expecting feedback.
              toast.error("Couldn't undo — too much time passed", {
                id: UNDO_TOAST_ID,
                duration: 2_000,
              });
            }
          },
        },
      });
    },
    [prefs, onPrefsChange],
  );
}
