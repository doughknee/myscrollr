import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether a single-line copy of some text fits inside a container, latched.
 *
 * The headline chip's detailed row is "whatever the headline still needs":
 * the rest of the headline if it wrapped, the summary if it did not. That
 * is a real measurement, not a character count -- in a proportional face
 * eighty characters can be anywhere from 470 to 560px -- so the chip
 * renders a hidden single-line copy of the title and compares its
 * scrollWidth to the column it sits in.
 *
 * Latched once webfonts are in: a title never changes and the column is
 * settled at first render, so the answer cannot change afterwards, and a
 * flip mid-scroll would move the summary between lines. Before fonts
 * resolve the measurement is provisional and may be re-taken once.
 *
 * `null` until measured; callers treat it as "not yet known".
 */
export function useFitsOneLine(
  sizer: RefObject<HTMLElement | null>,
  cell: RefObject<HTMLElement | null>,
): boolean | null {
  const [fits, setFits] = useState<boolean | null>(null);
  const latched = useRef(false);

  useLayoutEffect(() => {
    if (latched.current) return;
    const measure = () => {
      const s = sizer.current, c = cell.current;
      if (!s || !c) return;
      // jsdom reports 0 for both; a zero-width cell means "not laid out"
      // and is left as unknown rather than guessed.
      if (c.clientWidth === 0) return;
      setFits(s.scrollWidth <= c.clientWidth + 0.5);
    };
    measure();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) {
      let live = true;
      fonts.ready.then(() => {
        if (!live) return;
        measure();
        latched.current = true;
      });
      return () => { live = false; };
    }
    latched.current = true;
    return undefined;
  }, [sizer, cell]);

  return fits;
}
