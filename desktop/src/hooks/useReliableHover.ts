/**
 * useReliableHover — robust hover state for the always-on-top ticker
 * window.
 *
 * The bug this fixes:
 *   The ticker is a borderless, always-on-top Tauri window. Naïve
 *   `onMouseEnter` / `onMouseLeave` handlers stick in the "hovered"
 *   state when the user:
 *     - Alt-Tabs to another app while the cursor is over the ticker
 *     - Switches desktops / Spaces (macOS)
 *     - Minimizes the ticker via tray
 *     - Clicks through to a window behind the ticker
 *     - The OS dispatches mouseleave only on cursor MOVEMENT past the
 *       window boundary; focus changes don't trigger it.
 *
 *   Result: the `TickerToolbar` stays visible forever, the persistent
 *   right-click hint stays hidden, and the user has to nudge the
 *   mouse over the ticker again to "wake it up".
 *
 * The fix is a layered cancellation strategy:
 *
 *   1. **Standard `pointerleave`** on the bound element — most
 *      reliable boundary-exit signal in modern browsers.
 *   2. **`window.blur`** — fires when the OS gives focus to another
 *      window or desktop. The ticker can technically receive focus on
 *      click; blur tells us the cursor is "elsewhere".
 *   3. **`document.visibilitychange`** — covers minimize and Space
 *      switches where blur sometimes doesn't fire.
 *   4. **Grace-poll fallback** — every 500ms while "hovered", check
 *      `document.hasFocus()` AND that we've seen a `pointermove` in
 *      the last 750ms. If both fail, force-clear. This is the
 *      backstop for any path the explicit listeners miss.
 *
 *   Crucially, we DON'T use `mouseleave` because Tauri/WebKit on macOS
 *   has flaky behavior with always-on-top windows and that event.
 *
 * Returned API:
 *   `bind` — props to spread on the element you want to track.
 *   `hovered` — current state.
 *   `forceClear` — manually reset (e.g. after an action moves focus
 *     to the main window programmatically).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface ReliableHoverBind {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerMove: () => void;
}

interface UseReliableHoverResult {
  hovered: boolean;
  bind: ReliableHoverBind;
  forceClear: () => void;
}

/**
 * Tunable: how recently a `pointermove` must have happened for the
 * grace-poll to consider the cursor still inside. 750ms is generous
 * enough to handle a user reading a single ticker chip without moving
 * the mouse, but tight enough to clear within a second of leaving.
 */
const POINTERMOVE_GRACE_MS = 750;

/** How often the grace-poll runs while hovered. */
const GRACE_POLL_INTERVAL_MS = 500;

export function useReliableHover(): UseReliableHoverResult {
  const [hovered, setHovered] = useState(false);
  const lastMoveAt = useRef<number>(0);
  // Mirror `hovered` in a ref so the grace-poll's interval callback
  // doesn't need to be re-created (and have its timer reset) every
  // time the state flips. Otherwise rapid hover toggles would lose
  // the polling backstop.
  const hoveredRef = useRef(false);
  hoveredRef.current = hovered;

  const forceClear = useCallback(() => {
    setHovered(false);
  }, []);

  const bind: ReliableHoverBind = {
    onPointerEnter: useCallback(() => {
      lastMoveAt.current = Date.now();
      setHovered(true);
    }, []),
    onPointerLeave: useCallback(() => {
      setHovered(false);
    }, []),
    onPointerMove: useCallback(() => {
      lastMoveAt.current = Date.now();
      // Re-arm the hovered state if the grace-poll cleared it but
      // the user is actually still moving — handles the rare race
      // where focus blurred for a frame.
      if (!hoveredRef.current) setHovered(true);
    }, []),
  };

  // Layer 2 + 3: window blur + visibility change. These fire on
  // alt-tab, Space switch, OS-level focus loss. We always clear on
  // these regardless of where the cursor "physically" is, because
  // even if the user's cursor sits on top of the ticker pixel-wise,
  // their *attention* is elsewhere — keeping the toolbar open would
  // be visually noisy.
  useEffect(() => {
    function onBlur() {
      setHovered(false);
    }
    function onVisibility() {
      if (document.hidden) setHovered(false);
    }
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Layer 4: grace-poll backstop. Only runs while hovered to avoid
  // burning a timer when there's nothing to monitor.
  useEffect(() => {
    if (!hovered) return;
    const id = setInterval(() => {
      const stale = Date.now() - lastMoveAt.current > POINTERMOVE_GRACE_MS;
      const unfocused = !document.hasFocus();
      if (stale && unfocused) {
        // Both signals say "user isn't here". Clear.
        setHovered(false);
      }
    }, GRACE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hovered]);

  return { hovered, bind, forceClear };
}
