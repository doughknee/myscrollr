/**
 * BarChassis — the persistent shell for widget bars.
 *
 * The shell (background, padding, bottom separator, elevation shadow)
 * mounts ONCE in the app frame, above the routed page, so it never
 * participates in page transitions: the bar/feed separator line is
 * physically incapable of animating on source swaps. Each FeedTab's
 * WidgetBar portals its control ROW into the chassis host; during a
 * swap the outgoing and incoming rows briefly coexist, grid-stacked in
 * the same cell, and roll past each other via the hidden/show/out
 * variant labels their own page containers broadcast (portals preserve
 * React context, so each row answers to its OWN page's presence).
 *
 * Without a provider (preview harnesses mount FeedTabs bare), WidgetBar
 * renders its standalone sticky shell exactly as before — the verify
 * suites exercise that path unchanged.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { clsx } from "clsx";

interface BarChassisValue {
  /** DOM node WidgetBar portals its row into (null for a beat on boot
   *  while the slot's ref settles — render nothing, not a local shell). */
  host: HTMLElement | null;
  /** Row mount bookkeeping — the shell hides itself at zero rows so
   *  barless pages (e.g. widget info) don't show an empty chrome band. */
  report: (delta: 1 | -1) => void;
  /** Pinned-state elevation, reported by the sentinel that still lives
   *  in the page's scroll flow. */
  setStuck: (stuck: boolean) => void;
}

interface BarChassisInternal extends BarChassisValue {
  setHost: (el: HTMLElement | null) => void;
  rowCount: number;
  stuck: boolean;
}

const Ctx = createContext<BarChassisInternal | null>(null);

/** Consumed by WidgetBar. Null = no chassis (harnesses, non-source
 *  routes) → render the standalone shell. */
export function useBarChassis(): BarChassisValue | null {
  return useContext(Ctx);
}

export function BarChassisProvider({
  active,
  children,
}: {
  /** True on source routes (widget feeds). When false the
   *  context is null and any WidgetBar renders standalone. */
  active: boolean;
  children: React.ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [stuck, setStuck] = useState(false);

  const report = useCallback((delta: 1 | -1) => {
    setRowCount((c) => Math.max(0, c + delta));
  }, []);

  // No bars mounted → nothing can be pinned. Clears any elevation a
  // dying bar's last observer report left behind, so the next page's
  // bar never inherits a resting shadow.
  useEffect(() => {
    if (rowCount === 0) setStuck(false);
  }, [rowCount]);

  const value = useMemo<BarChassisInternal>(
    () => ({ host, setHost, report, setStuck, rowCount, stuck }),
    [host, report, rowCount, stuck],
  );

  return <Ctx.Provider value={active ? value : null}>{children}</Ctx.Provider>;
}

/** The shell itself — place between the app banners and the routed
 *  content. Renders only under an active provider; collapses (hidden,
 *  not unmounted — the host node must survive) while no row is portaled
 *  in. */
export function BarChassisSlot() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    // Same anatomy as WidgetBar's standalone shell (rounded-t-xl seats
    // the bar against the content panel's top radius; @container drives
    // the rows' collapse-before-clip variants). backdrop-blur is gone:
    // nothing ever renders behind a non-overlapping chassis row.
    <div
      className={clsx(
        "@container relative z-20 shrink-0 rounded-t-xl border-b bg-surface px-3 py-1.5 transition-shadow duration-200",
        ctx.stuck
          ? "border-edge/50 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.35)]"
          : "border-edge/30",
        ctx.rowCount === 0 && "hidden",
      )}
    >
      {/* Grid-stacked host: outgoing + incoming rows occupy the same
          cell during a swap so they overlap instead of stacking. */}
      <div
        ref={ctx.setHost}
        className="grid items-center [&>*]:col-start-1 [&>*]:row-start-1"
      />
    </div>
  );
}
