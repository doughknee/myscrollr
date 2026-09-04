import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * True once the element has been measured at (or beyond) `cap` pixels wide,
 * and stays true for the element's life.
 *
 * Why it exists: a content-sized ticker chip reserves width for anything
 * that changes -- a score slot holds 2ch before kickoff -- so the chip
 * cannot grow mid-game. That reservation is what keeps the rail still. But
 * a chip that has hit its max-width truncates its team names, and there
 * the reservation is pure cost: the chip is pinned at the cap whatever the
 * score slot holds, so giving the empty slot back to the name changes
 * nothing outside the chip and shows more of the name inside it.
 *
 * Why it latches: releasing the reservation shrinks the content, which can
 * drop the chip just under the cap, which would un-cap it, which would
 * restore the reservation and push it back over -- an oscillation across
 * the boundary. Names never change, so a chip that was ever at the cap is
 * treated as capped from then on. Off-cap chips never enter the mode.
 *
 * CSS could not do this: container queries need a container whose inline
 * size does not depend on its contents, and this chip's does.
 */
export function useLatchedCap(ref: RefObject<HTMLElement | null>, cap: number): boolean {
  const [capped, setCapped] = useState(false);
  const latched = useRef(false);

  useLayoutEffect(() => {
    if (latched.current) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const check = (width: number) => {
      if (latched.current || width < cap - 0.5) return;
      latched.current = true;
      setCapped(true);
      ro.disconnect();
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) check(e.contentRect.width);
    });
    check(el.getBoundingClientRect().width);
    if (!latched.current) ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cap]);

  return capped;
}
