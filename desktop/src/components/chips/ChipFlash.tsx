/**
 * ChipFlash — a one-shot highlight when a chip's number actually moves.
 *
 * NOT the same thing as `.pts-flash`, which is a 6s ambient loop meaning
 * "this player is live". This fires once, on change, and says "that
 * number just changed" — the difference between a heartbeat and an
 * event. A live chip that never scores should never flash.
 *
 * Motion policy is inherited rather than re-decided: this is a CSS
 * `animation`, so the `#app-shell` blanket rule stills it inside the app
 * (the calm surface keeps its stillness) while the ticker window, which
 * has no such rule, flashes. Same markup, correct in both.
 */
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

/**
 * Counts changes to `value`. Returns a token that increments on each
 * one, for use as a `key`.
 *
 * The token exists because CSS animations only replay on a fresh
 * element. Keying the flash overlay on it remounts just that overlay —
 * deliberately NOT the number itself, since remounting the score would
 * destroy the digit roll mid-flight, which is the very thing the flash
 * is meant to draw attention to.
 *
 * Starts at 0 and the first render never counts: a chip scrolling onto
 * the rail has "changed" from nothing, and flashing every chip on mount
 * would make the whole bar strobe.
 */
export function useChangeFlash(value: number | null | undefined): number {
  const [token, setToken] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      if (previous.current !== undefined && previous.current !== null) {
        setToken((n) => n + 1);
      }
      previous.current = value;
    }
  }, [value]);

  return token;
}

export function ChipFlash({
  token,
  tone = "up",
}: {
  /** From `useChangeFlash`. Zero means it has never changed. */
  token: number;
  /** Direction of the change — a score going down shouldn't read green. */
  tone?: "up" | "down";
}) {
  // Nothing has moved yet, so there is nothing to announce.
  if (token === 0) return null;

  return (
    <span
      key={token}
      aria-hidden="true"
      className={clsx("chip-flash", tone === "down" && "chip-flash-down")}
    />
  );
}
