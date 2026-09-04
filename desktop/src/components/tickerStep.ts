/**
 * Which ticker item the next step should advance by.
 *
 * Step mode scrolls the rail one item at a time, pausing between. It used
 * to measure the FIRST `.ticker-item` in the DOM and advance by that width
 * every time, which is only right when every chip is the same width. Once
 * chips are content-sized -- a Cubs-Tigers chip narrower than a
 * Revolution-Minnesota one -- stepping by the first item's width drifts:
 * after a few steps chips stop landing at the edge and the pause happens
 * mid-chip.
 *
 * motion-plus renders the originals first, in order, then clones, so the
 * item at DOM index `i` (for i < count) is original item i. Scrolling left
 * moves content leftward, so after `step` steps the item at the leading
 * edge is item `step mod count`, and that is the one whose width the next
 * step must travel. Scrolling right, content moves rightward and the item
 * arriving at the leading edge is the one before it in the loop.
 */
export function stepItemIndex(step: number, count: number, direction: "left" | "right"): number {
  if (count <= 0) return 0;
  const k = ((step % count) + count) % count;
  return direction === "left" ? k : (count - 1 - k + count) % count;
}
