/**
 * BarChassis — the persistent bar shell (REL-79).
 *
 * The chassis exists so the bar/feed separator can't animate during a
 * source swap. Its guarantees are all invisible when they work and ugly
 * when they don't: an empty chrome band on a barless page, a resting
 * shadow inherited from the page you just left, a row rendered into a
 * display:none shell. None of it was covered.
 *
 * These drive the provider through a real WidgetBar rather than poking
 * context directly, so the portal handoff and the mount/unmount
 * bookkeeping are exercised the way the app uses them.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { BarChassisProvider, BarChassisSlot } from "./BarChassis";
import { WidgetBar } from "./Bar";

// jsdom has no IntersectionObserver and WidgetBar constructs one on mount.
// Stubbing it also hands us the callback, which is the only way to drive
// the pinned-state elevation deterministically.
let fireIntersection: ((isIntersecting: boolean) => void) | null = null;

beforeEach(() => {
  fireIntersection = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {
        fireIntersection = (isIntersecting: boolean) =>
          this.cb(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

/** The chassis shell — the grid-stacked portal host, carrying the
 *  elevation and `empty:hidden`. ONLY BarChassisSlot renders a grid:
 *  `@container` alone is ambiguous — WidgetBar's standalone shell carries
 *  it too, so matching on that silently reads the wrong element in the
 *  no-provider case. */
const shell = () =>
  document.querySelector(".grid.items-center") as HTMLElement | null;

/** WidgetBar's own sticky shell, rendered only when there is no chassis. */
const standaloneShell = () =>
  document.querySelector(".sticky.top-0") as HTMLElement | null;

function Frame({
  active = true,
  bars = 1,
}: {
  active?: boolean;
  bars?: number;
}) {
  return (
    <BarChassisProvider active={active}>
      <BarChassisSlot />
      {Array.from({ length: bars }, (_, i) => (
        <WidgetBar key={i}>
          <span>bar-{i}</span>
        </WidgetBar>
      ))}
    </BarChassisProvider>
  );
}

describe("BarChassis", () => {
  it("keeps narrow controls visible by wrapping the shared row", () => {
    render(<Frame />);
    expect(screen.getByText("bar-0").parentElement).toHaveClass(
      "w-full",
      "flex-wrap",
    );
  });

  it("portals the bar row into the shell instead of rendering a standalone one", () => {
    render(<Frame />);
    const row = screen.getByText("bar-0");
    // The row must live INSIDE the chassis shell — that's the whole point.
    expect(shell()).toBeTruthy();
    expect(shell()!.contains(row)).toBe(true);
    // ...and it must NOT also render its standalone shell, or the page
    // would show two stacked chrome bands.
    expect(standaloneShell()).toBeNull();
  });

  it("renders no shell when the provider is inactive, and the bar falls back to standalone", () => {
    render(<Frame active={false} />);
    // Slot returns null off a null context — no chassis in the tree.
    expect(shell()).toBeNull();
    // ...but the bar still renders its OWN sticky shell, so a non-source
    // route (or a bare-mounted FeedTab) is never left without one.
    expect(standaloneShell()).toBeTruthy();
    expect(standaloneShell()!.contains(screen.getByText("bar-0"))).toBe(true);
  });

  it("hides the shell while no row is mounted, without unmounting the host", () => {
    const { rerender } = render(<Frame bars={0} />);
    // Hidden, NOT removed: the host node has to survive or the next
    // bar's portal has nowhere to land. Hiding is `:empty` in CSS so it
    // can never lag the row by a commit (REL-218).
    expect(shell()).toBeTruthy();
    expect(shell()).toHaveClass("empty:hidden");
    expect(shell()).toBeEmptyDOMElement();

    rerender(<Frame bars={1} />);
    expect(shell()).not.toBeEmptyDOMElement();
  });

  it("stays visible through a swap, then hides once the last row leaves", () => {
    // Two bars coexist mid-swap (outgoing + incoming, grid-stacked).
    const { rerender } = render(<Frame bars={2} />);
    expect(shell()!.childElementCount).toBe(2);

    rerender(<Frame bars={1} />);   // outgoing finishes exiting
    expect(shell()!.childElementCount).toBe(1);

    rerender(<Frame bars={0} />);   // barless page
    expect(shell()).toBeEmptyDOMElement();
  });

  it("raises elevation when the bar pins and drops it when it unpins", () => {
    render(<Frame />);
    expect(shell()!.className).not.toMatch(/shadow-/);

    act(() => fireIntersection!(false));   // sentinel left view => pinned
    expect(shell()!.className).toMatch(/shadow-/);

    act(() => fireIntersection!(true));    // scrolled back to the top
    expect(shell()!.className).not.toMatch(/shadow-/);
  });

  // The subtle one. `stuck` is SHARED provider state, so a shadow set by
  // the page you're leaving would otherwise still be on when the next
  // page's bar arrives — a resting shadow with nothing pinned under it.
  it("clears a pinned shadow when the last row unmounts", () => {
    const { rerender } = render(<Frame bars={1} />);
    act(() => fireIntersection!(false));
    expect(shell()!.className).toMatch(/shadow-/);

    rerender(<Frame bars={0} />);          // page with no bar
    expect(shell()!.className).not.toMatch(/shadow-/);

    rerender(<Frame bars={1} />);          // next page's bar arrives
    expect(shell()!.className).not.toMatch(/shadow-/);
  });
});

