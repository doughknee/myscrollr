/**
 * When a rotating slot may change what it shows.
 *
 * The rule: never while it is on screen. A marquee chip is read as it
 * passes, and a swap mid-pass loses the reader the game they were
 * looking at. So a slot's content advances once per LAP -- the moment
 * it has fully left the viewport -- and the count of those moments is
 * the slot's cycle number, which the source turns into "which game".
 *
 * motion-plus renders each item twice, an original (`.ticker-item`) and
 * a clone (`.clone-item`) one track-length apart, so "off screen" means
 * EVERY instance of the slot is outside the container. The track is
 * always longer than the viewport, so there is always a stretch where
 * that is true, and always exactly one visible->hidden transition per
 * lap. It has no loop callback, hence the polling in ScrollrTicker; this
 * module is the pure part of that, so the arithmetic is testable without
 * a DOM.
 */

/** Which slots are visible right now, from the DOM. */
export function visibleSlots(container: HTMLElement): Set<string> {
  const box = container.getBoundingClientRect();
  const seen = new Set<string>();
  const nodes = container.querySelectorAll<HTMLElement>("[data-rotate-slot]");
  for (const node of nodes) {
    const slot = node.dataset.rotateSlot;
    if (!slot || seen.has(slot)) continue;
    const r = node.getBoundingClientRect();
    // Any overlap counts; a chip half off the edge is still being read.
    if (r.right > box.left && r.left < box.right) seen.add(slot);
  }
  return seen;
}

/**
 * Advance the cycle of every slot that was visible last tick and is not
 * now. Returns the same object when nothing changed, so callers can use
 * it as a state setter without spurious re-renders.
 */
export function advanceCycles(
  cycles: Readonly<Record<string, number>>,
  wasVisible: ReadonlySet<string>,
  nowVisible: ReadonlySet<string>,
): Readonly<Record<string, number>> {
  let next: Record<string, number> | null = null;
  for (const slot of wasVisible) {
    if (nowVisible.has(slot)) continue;
    next ??= { ...cycles };
    next[slot] = (next[slot] ?? 0) + 1;
  }
  return next ?? cycles;
}
