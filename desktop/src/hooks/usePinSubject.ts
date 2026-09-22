/**
 * The one place a pin is written outside the ticker window.
 *
 * The ticker's right-click menu writes prefs directly (it owns its own
 * copy in App.tsx). Every surface inside the main window -- the sidebar
 * row menu, a widget page's item rows -- goes through here, so the cap
 * and the refusal message stay in one place instead of three.
 *
 * REL-239: a pin is on a SUBJECT (a team, a symbol, a feed, a market, a
 * single-chip utility), never on a widget.
 */
import { useCallback } from "react";
import { toast } from "sonner";

import { useShell } from "../shell-context";
import {
  MAX_PINS,
  isPinned as isPinnedIn,
  pinCount,
  togglePin,
} from "../preferences";
import type { AppPreferences } from "../preferences";
import { nothingToShow } from "../lib/pinMessages";

/**
 * Pin or unpin one subject, and say what happened.
 *
 * Exported plain (not just through the hook) because `__root.tsx` OWNS
 * prefs -- it is the provider, so it sits above the context the hook
 * reads. Two call sites, one implementation, so the cap and the refusal
 * message cannot drift between the sidebar and a widget page.
 */
export function applyPinToggle(
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
  widget: string,
  subject: string,
  label: string,
  /** The subject has nothing to show right now (SCROLLR-9): say so at
   *  the moment of pinning, since the fixed zone stays blank by §8.5. */
  empty = false,
): void {
  const wasPinned = isPinnedIn(prefs, widget, subject);
  const next = togglePin(prefs, { widget, subject, side: "right" });
  if (next === prefs) {
    // Refused, not evicted: the zone holds what the user put there.
    toast.error(
      `The ticker already holds ${MAX_PINS} pins — unpin one to pin ${label}`,
    );
    return;
  }
  onPrefsChange(next);
  if (wasPinned) {
    toast.success(`${label} unpinned`);
  } else if (empty) {
    toast.success(`${label} pinned to the ticker`, {
      description: `${nothingToShow(label)} — the chip appears when it does.`,
    });
  } else {
    toast.success(`${label} pinned to the ticker`);
  }
}

export interface PinSubjectApi {
  /** Is this subject in the fixed zone? */
  isPinned: (widget: string, subject: string) => boolean;
  /** Is there room for another pin? */
  hasRoom: boolean;
  /** Pin or unpin. `label` names the subject in the toast; `empty` says
   *  the subject has nothing to show right now. */
  toggle: (widget: string, subject: string, label: string, empty?: boolean) => void;
}

export function usePinSubject(): PinSubjectApi {
  const { prefs, onPrefsChange } = useShell();

  const isPinned = useCallback(
    (widget: string, subject: string) => isPinnedIn(prefs, widget, subject),
    [prefs],
  );

  const toggle = useCallback(
    (widget: string, subject: string, label: string, empty?: boolean) =>
      applyPinToggle(prefs, onPrefsChange, widget, subject, label, empty),
    [prefs, onPrefsChange],
  );

  return {
    isPinned,
    hasRoom: pinCount(prefs) < MAX_PINS,
    toggle,
  };
}
