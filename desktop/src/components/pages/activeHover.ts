/**
 * "Hover" on the pages bar means an ACTIVE pointer (SCROLLR-291): over the bar and
 * entering or moving within the last HOVER_IDLE_MS. A cursor flung to the screen
 * edge and forgotten no longer freezes the bar for good; moving it again grabs the
 * page back. One timer per window, re-armed lazily, so a stream of mousemoves costs
 * one timestamp write each. `onChange` fires only on a transition.
 */
import { useEffect, useMemo, useRef } from "react";

export const HOVER_IDLE_MS = 5000;

export function createActiveHover(onChange: (active: boolean) => void, idleMs = HOVER_IDLE_MS) {
  let active = false;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (on: boolean) => {
    if (on === active) return;
    active = on;
    onChange(on);
  };
  const check = () => {
    timer = undefined;
    const idle = Date.now() - last;
    if (idle >= idleMs) set(false);
    else timer = setTimeout(check, idleMs - idle);
  };

  return {
    /** The pointer entered or moved inside the bar. */
    move() {
      last = Date.now();
      if (!active) {
        set(true);
        timer = setTimeout(check, idleMs);
      }
    },
    /** The pointer left the bar. */
    leave() {
      clearTimeout(timer);
      timer = undefined;
      set(false);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

/** Handlers for the bar: spread `move` on enter and move, `leave` on leave. */
export function useActiveHover(onChange: (active: boolean) => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const hover = useMemo(() => createActiveHover((a) => cb.current(a)), []);
  useEffect(() => () => hover.dispose(), [hover]);
  return hover;
}
