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
import { BarChassisProvider, BarChassisSlot, useBarChassis } from "./BarChassis";
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

/** The chassis shell — the element carrying `hidden` and the elevation.
 *
 *  Selected via the grid-stacked host, which ONLY BarChassisSlot renders.
 *  `@container` alone is ambiguous — WidgetBar's standalone shell carries
 *  it too, so matching on that silently reads the wrong element in the
 *  no-provider case. */
const shell = () =>
  (document.querySelector(".grid.items-center")?.parentElement ?? null) as
    | HTMLElement
    | null;

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
    // bar's portal has nowhere to land.
    expect(shell()).toBeTruthy();
    expect(shell()).toHaveClass("hidden");

    rerender(<Frame bars={1} />);
    expect(shell()).not.toHaveClass("hidden");
  });

  it("stays visible through a swap, then hides once the last row leaves", () => {
    // Two bars coexist mid-swap (outgoing + incoming, grid-stacked).
    const { rerender } = render(<Frame bars={2} />);
    expect(shell()).not.toHaveClass("hidden");

    rerender(<Frame bars={1} />);   // outgoing finishes exiting
    expect(shell()).not.toHaveClass("hidden");

    rerender(<Frame bars={0} />);   // barless page
    expect(shell()).toHaveClass("hidden");
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

describe("BarChassis row bookkeeping", () => {
  // report() fires from a layout effect on every bar mount/unmount, so an
  // unbalanced -1 is reachable (double cleanup, StrictMode double-invoke).
  // It must clamp at zero, because the shell hides on `rowCount === 0`
  // exactly — a count of -1 is not 0, so the shell would render VISIBLE
  // with no row portaled into it: an empty chrome band, the precise thing
  // hiding-at-zero exists to prevent.
  function Reporter({ onReady }: { onReady: (r: (d: 1 | -1) => void) => void }) {
    const ctx = useBarChassis();
    if (ctx) onReady(ctx.report);
    return null;
  }

  it("clamps at zero so a stray unmount can't leave an empty band showing", () => {
    let report!: (d: 1 | -1) => void;
    render(
      <BarChassisProvider active>
        <BarChassisSlot />
        <Reporter onReady={(r) => (report = r)} />
      </BarChassisProvider>,
    );
    expect(shell()).toHaveClass("hidden");

    // Stray cleanups with nothing mounted. Unclamped this reaches -2, and
    // `rowCount === 0` is then false — the shell would un-hide itself.
    act(() => { report(-1); report(-1); });
    expect(shell()).toHaveClass("hidden");

    // And the count must still be at zero, not -2: one real bar mounting
    // has to be enough to show the shell.
    act(() => { report(1); });
    expect(shell()).not.toHaveClass("hidden");
  });
});
