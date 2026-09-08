/**
 * Resolve the chip under the cursor to a pinnable subject.
 *
 * The ticker tags every chip wrapper (the existing `data-chip` element)
 * with `data-pin-subject`, a JSON `{widget, subject, label}`. One
 * attribute rather than three because the three parts are only ever
 * useful together, and a chip with no pinnable subject then simply has
 * no attribute rather than a half-filled set.
 *
 * Written as a module, not inline in the context-menu handler, because
 * the parse has to survive whatever is on the wrapper: a chip from an
 * older render, a hand-edited DOM, a subject that is the empty string.
 * Anything it cannot vouch for returns null and the menu just omits the
 * item (REL-239).
 */
export interface PinTarget {
  /** Widget id that owns the subject (sports_mlb, finance_stocks, clock…). */
  widget: string;
  /** The durable thing the pin follows (team name, symbol, feed url…). */
  subject: string;
  /** How to name it in the menu. */
  label: string;
}

/** Parse one `data-pin-subject` value. Null for anything malformed. */
export function parsePinTarget(raw: string | null | undefined): PinTarget | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const { widget, subject, label } = parsed as Record<string, unknown>;
  if (typeof widget !== "string" || widget === "") return null;
  if (typeof subject !== "string" || subject === "") return null;
  return {
    widget,
    subject,
    label: typeof label === "string" && label !== "" ? label : subject,
  };
}

/** Walk up from an event target to the nearest pinnable chip. */
export function pinTargetAt(node: EventTarget | null): PinTarget | null {
  const el = node instanceof Element ? node.closest("[data-pin-subject]") : null;
  return parsePinTarget(el?.getAttribute("data-pin-subject"));
}
