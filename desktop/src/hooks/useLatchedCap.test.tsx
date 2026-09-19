/**
 * The latch's one job is to survive the shrink it causes.
 *
 * GameChip releases ~53px of reservations when this hook says "capped".
 * Any pairing whose reserved width lands in (cap, cap + released] measures
 * UNDER the cap once released -- 660px reserved, 618px released, on the
 * NCAAF slot that found SCROLLR-229. If that second measurement could
 * clear the flag the chip would oscillate across the boundary, so the
 * latch is one-way and the observer is dropped the moment it fires.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useLatchedCap } from "./useLatchedCap";

const CAP = 640;
/** What GameChip hands back at the cap: 2ch × 2 score, 7ch status, 8px padding. */
const RELEASED = 53;

const real = globalThis.ResizeObserver;
afterEach(() => { globalThis.ResizeObserver = real; });

/** A ResizeObserver that replays `widths` on observe, in order. */
function replay(widths: number[]) {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      for (const width of widths) {
        this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
    }
    disconnect() {}
    unobserve() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const capped = useLatchedCap(ref, CAP);
  return <div ref={ref} data-testid="probe" data-capped={capped} />;
}

const capped = (c: HTMLElement) => c.querySelector("[data-testid=probe]")!.getAttribute("data-capped");

describe("useLatchedCap", () => {
  it("stays latched when the release drops the element back into the band", () => {
    // Every width the released chip can land on inside (640, 640+released].
    for (const reserved of [CAP + 0.5, CAP + 20, CAP + RELEASED]) {
      replay([reserved, reserved - RELEASED]);
      const { container, unmount } = render(<Probe />);
      expect(capped(container), `reserved ${reserved} → released ${reserved - RELEASED}`).toBe("true");
      unmount();
    }
  });

  it("does not latch below the cap", () => {
    replay([CAP - 1]);
    const { container } = render(<Probe />);
    expect(capped(container)).toBe("false");
  });
});
