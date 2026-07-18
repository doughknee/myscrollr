/**
 * Widget-bar shell primitives — extracted from the predictions/Kalshi
 * FeedTab (v1.1.6), where the anatomy was designed and verified
 * (docs/kalshi-ui-review-notes.md is binding for the details).
 *
 * Host contract:
 * - The FeedTab root must be `flex min-h-full flex-col` with NO inner
 *   `overflow-y-auto` — `sticky` pins against the ancestor that actually
 *   scrolls (the Source page's PageLayout scroller in-app), and an inner
 *   scrollport that never scrolls swallows it silently.
 * - ONE bar per widget. No stacked sticky bands; counts live in menu rows.
 * - The bar is a @container: children collapse via @Nxl: variants BEFORE
 *   they'd clip at narrow widths (collapse-before-clip).
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { motion, useIsPresent } from "motion/react";
import { useBarChassis } from "./BarChassis";

/** The rolling control row — shared by the chassis portal and the
 *  standalone shell. Answers the hidden/show/out variant labels its
 *  page container broadcasts (portals preserve React context, so a
 *  portaled row still follows its OWN page's enter/exit); with no
 *  labels in scope (preview harnesses) it renders static. */
function BarRow({ children }: { children: React.ReactNode }) {
  // Interrupted swaps (A→B→back-to-A before B's exit ends) resurrect
  // A's row at an EARLIER host index than B's dying one — DOM order
  // would paint (and hit-test) the dying row on top. The live row wins
  // both via z-10; the exiting row also stops intercepting clicks.
  // Standalone path unaffected: useIsPresent() is true with no
  // AnimatePresence ancestor.
  const isPresent = useIsPresent();
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -10 },
      }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className={clsx(
        "flex min-w-0 items-center gap-2",
        isPresent ? "z-10" : "pointer-events-none",
      )}
    >
      {children}
    </motion.div>
  );
}

/** Control-bar shell. Inside a BarChassisProvider (the app's source
 *  routes) the row is PORTALED into the persistent chassis so the bar
 *  chrome never animates with the page; standalone (preview harnesses)
 *  it renders its own sticky shell with pinned-state elevation. */
export function WidgetBar({ children }: { children: React.ReactNode }) {
  const chassis = useBarChassis();

  // Sticky-bar elevation: a 1px sentinel above the bar (in the page's
  // scroll flow either way) leaves view exactly when the bar pins.
  // Default (viewport) root — intersection is clipped through whichever
  // ancestor actually scrolls, so this works without knowing the
  // scroller. The sentinel is tracked as STATE via callback ref, not a
  // plain ref: if the bar's tree unmounts (a view switch), an observer
  // left watching the detached node would freeze `stuck` at its last
  // value and the bar would come back pre-shadowed.
  const [stuck, setStuck] = useState(false);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const reportStuck = chassis?.setStuck;
  useEffect(() => {
    if (!sentinelEl) {
      // Standalone only: clear the LOCAL pin state when the bar tree
      // remounts. In chassis mode `stuck` is SHARED provider state —
      // every mounting bar's first pass has a null sentinel, and a
      // forced false here would dip the elevation mid-swap; the fresh
      // observer's guaranteed initial callback reports the real value.
      if (!reportStuck) setStuck(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => (reportStuck ?? setStuck)(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(sentinelEl);
    return () => io.disconnect();
  }, [sentinelEl, reportStuck]);

  // Chassis-visibility bookkeeping (portal mode only). LAYOUT effect,
  // not passive: the portal row enters/leaves the chassis DOM in the
  // commit itself, so the shell's hidden-at-zero-rows class must flip
  // pre-paint too — a passive effect painted one frame of empty band
  // (or of a row inside a display:none shell) on every barless↔bar
  // transition (e.g. predictions Markets↔Positions).
  const report = chassis?.report;
  useLayoutEffect(() => {
    if (!report) return;
    report(1);
    return () => report(-1);
  }, [report]);

  if (chassis) {
    return (
      <>
        <div ref={setSentinelEl} aria-hidden className="h-px shrink-0" />
        {/* host is null for a beat while the slot's ref settles on boot —
            render nothing rather than flashing a local shell. */}
        {chassis.host && createPortal(<BarRow>{children}</BarRow>, chassis.host)}
      </>
    );
  }

  return (
    <>
      <div ref={setSentinelEl} aria-hidden className="h-px shrink-0" />
      {/* rounded-t-xl matches the app shell's inset content panel: the
          pinned bar's surface/backdrop-filter layer escapes the ancestor's
          border-radius clip in Chromium/WebView2 and would paint a square
          corner over the panel curve while scrolled. */}
      <div
        className={clsx(
          "@container sticky top-0 z-20 -mt-px rounded-t-xl border-b bg-surface px-3 py-1.5 transition-shadow duration-200",
          stuck
            ? "border-edge/50 bg-surface/95 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.35)] backdrop-blur-sm"
            : "border-edge/30",
        )}
      >
        <BarRow>{children}</BarRow>
      </div>
    </>
  );
}

/** Hairline separator between control clusters in the bar. */
export function BarDivider() {
  return <div aria-hidden className="h-4 w-px shrink-0 bg-edge/60" />;
}

/** Open pill control (ex-LensPill) — the bar's quiet filter idiom, a
 *  deliberately different shape from the contained Segmented control so
 *  two control levels never read as one row of identical chips. */
export function BarPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        // border-transparent matches the bordered triggers' 28px outer
        // height so pills and menus sit on one optical rule.
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-ui-meta font-medium transition-colors cursor-pointer",
        active
          ? "bg-accent/15 text-accent"
          : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
      )}
    >
      {children}
    </button>
  );
}
