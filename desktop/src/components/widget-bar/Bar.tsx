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
import { useEffect, useState } from "react";
import { clsx } from "clsx";

/** Sticky control-bar shell with pinned-state elevation. */
export function WidgetBar({ children }: { children: React.ReactNode }) {
  // Sticky-bar elevation: a 1px sentinel above the bar leaves view exactly
  // when the bar pins. Default (viewport) root — intersection is clipped
  // through whichever ancestor actually scrolls, so this works without
  // knowing the scroller. The sentinel is tracked as STATE via callback
  // ref, not a plain ref: if the bar's tree unmounts (a view switch), an
  // observer left watching the detached node would freeze `stuck` at its
  // last value and the bar would come back pre-shadowed.
  const [stuck, setStuck] = useState(false);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelEl) {
      setStuck(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(sentinelEl);
    return () => io.disconnect();
  }, [sentinelEl]);

  return (
    <>
      <div ref={setSentinelEl} aria-hidden className="h-px shrink-0" />
      {/* rounded-t-xl matches the app shell's inset content panel: the
          pinned bar's surface/backdrop-blur layer escapes the ancestor's
          border-radius clip in Chromium/WebView2 and would paint a square
          corner over the panel curve while scrolled. */}
      <div
        className={clsx(
          "@container sticky top-0 z-20 -mt-px flex items-center gap-2 rounded-t-xl border-b bg-surface px-3 py-1.5 transition-shadow duration-200",
          stuck
            ? "border-edge/50 bg-surface/95 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.35)] backdrop-blur-sm"
            : "border-edge/30",
        )}
      >
        {children}
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
