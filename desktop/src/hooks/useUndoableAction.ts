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
 * The hook reads `prefs` and `onPrefsChange` from `useShell()`, deep-
 * clones the current prefs into the toast's Undo closure, applies your
 * mutator, and shows a sonner toast with an Undo button. Clicking Undo
 * restores the captured blob via `onPrefsChange` (which also broadcasts
 * to the ticker window via the existing store sync, so undo works
 * cross-window).
 *
 * Behavior contract:
 *   - The snapshot lives in the Undo callback's closure, so it is
 *     restorable exactly as long as the toast can fire (sonner pauses
 *     the dismiss timer on hover). No stack, no expiry, no GC.
 *   - Successive undoable actions REPLACE the previous toast (sonner's
 *     `id` parameter forces this). Only the latest action is undoable
 *     — which was always the case; earlier revisions kept a 20-entry
 *     ring buffer whose older snapshots had no UI surface.
 *   - If the mutator returns the same prefs reference (no-op), we
 *     skip the snapshot AND the toast. Prevents noise like "Removed
 *     Row 1" after a click that didn't actually delete anything (e.g.
 *     out-of-bounds index).
 *   - No keyboard shortcut. Per the Phase 1 brainstorm, Cmd+Z would
 *     conflict with text-input undo in places like ProfileField and
 *     RSS-feed-name inputs, and the smart-conflict-resolution path
 *     wasn't worth the complexity for the first cut.
 */

import { useCallback, useContext } from "react";
import { toast } from "sonner";
import { ShellContext } from "../shell-context";
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
 * Explicit prefs plumbing for callers that sit OUTSIDE the shell
 * provider. RootLayout itself is the component that *renders*
 * ShellContext.Provider, so hooks called in its body can't read the
 * context — the v1.1.2 sidebar remove flow passes RootLayout's own
 * `prefs` + `persistPrefs` here instead. Inside the provider, omit.
 */
export interface UndoShellPlumbing {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

/**
 * Returns a function `(opts, mutator) => void` that executes the
 * mutation and shows an undo toast. The function identity is stable
 * across renders (useCallback) so it's safe to put in dependency
 * arrays.
 */
export function useUndoableAction(external?: UndoShellPlumbing): (
  opts: UndoableActionOptions,
  mutator: Mutator,
) => void {
  const ctx = useContext(ShellContext);
  const resolved = external ?? ctx;
  if (!resolved) {
    throw new Error(
      "useUndoableAction must be used within RootLayout or given explicit prefs plumbing",
    );
  }
  const { prefs, onPrefsChange } = resolved;

  return useCallback(
    (opts: UndoableActionOptions, mutator: Mutator) => {
      const before = prefs;
      const after = mutator(before);

      // No-op guard: if the mutator returned the same reference, the
      // action did nothing meaningful. Don't snapshot, don't toast,
      // don't call onPrefsChange — it would just trigger a no-op
      // store write and confuse the user with a phantom undo toast.
      if (after === before) return;

      // Deep-clone into the closure so later mutations to the live
      // prefs object can't corrupt the restore point.
      const snapshot = structuredClone(before);
      onPrefsChange(after);

      toast.message(opts.label, {
        id: UNDO_TOAST_ID,
        description: opts.description,
        duration: TOAST_DURATION_MS,
        action: {
          label: "Undo",
          onClick: () => {
            onPrefsChange(snapshot);
            toast.success("Restored", {
              id: UNDO_TOAST_ID,
              duration: 1_500,
            });
          },
        },
      });
    },
    [prefs, onPrefsChange],
  );
}
