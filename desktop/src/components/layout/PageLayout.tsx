/**
 * PageLayout — universal page chassis.
 *
 * Everything except the content stack itself lives in the TopBar via
 * PageContext: title, parent breadcrumb, sibling-tab strip, entity
 * action, and Options menu. The route just publishes its identity and
 * renders its content.
 *
 * The content area renders:
 *   1. Content stack — children, cross-faded on tab/route changes
 *   2. Footer — optional destructive/peripheral page-level actions
 *
 * IA refactor 2026-05-09 polish pass — see
 * docs/_archive/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 * Tab band hoisted into the TopBar on 2026-05-11 to reclaim vertical
 * space and consolidate page chrome.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { useRegisterPageIdentity } from "./page-context";
import type { OverflowMenuItem } from "../OverflowMenu";

// ── Props ───────────────────────────────────────────────────────

interface PageLayoutProps {
  /** Page title — published to the TopBar. */
  title: string;
  /** Single-line subtitle. Optional. Published to the TopBar. */
  subtitle?: string;
  /** Parent breadcrumb label, e.g. "Home" (source pages only). */
  parentLabel?: string;
  /** Click handler for the parent breadcrumb. */
  onParentClick?: () => void;
  /** Optional click handler for the title (e.g. on sub-routes,
   *  clicking the title returns to the primary route). */
  onTitleClick?: () => void;

  /**
   * Contextual menu items for this page. When present, the TopBar
   * renders an "Options" pill button as the menu trigger.
   */
  menuItems?: OverflowMenuItem[];
  /** Aria label for the menu trigger. Default: 'Page options'. */
  menuLabel?: string;

  /**
   * Fallback non-menu action rendered after the breadcrumb. Use
   * `menuItems` for the standard pattern; this is for pages that
   * need a raw icon button without a menu.
   */
  entityAction?: ReactNode;

  /** Page content. */
  children: ReactNode;

  /** Optional footer band. */
  footer?: ReactNode;

  /** Constrain content width. Defaults to "narrow". */
  width?: "narrow" | "wide";

  /**
   * When true, the content area becomes a flex container that fills
   * the viewport (and does NOT scroll itself). Children are expected
   * to manage their own scrolling region with `min-h-0` + a flex-1
   * scroll panel inside. Used for routes like Configure where a long
   * list should scroll within a fixed pane instead of growing the
   * entire page.
   */
  fillHeight?: boolean;

  /**
   * When true, the inner content wrapper omits the default `px-5 py-5`
   * padding and the `max-w-*` width clamp. The route renders flush to
   * the scroll viewport's edges and is responsible for its own
   * padding. Used by Home (which wants the full content area) and
   * other dashboards that don't want a constrained reading column.
   */
  noContentPadding?: boolean;

  /**
   * Source-page transition mode: an OVERLAPPING crossfade (popLayout,
   * no wait gap) that broadcasts `hidden/show/out` variant LABELS
   * instead of inline values. The widget-bar row (portaled into the
   * persistent BarChassis, which lives OUTSIDE this subtree and never
   * animates) consumes the labels to roll its contents out the top and
   * in from the bottom, while the feed content itself rises in / sinks
   * out here.
   */
  stableChrome?: boolean;
}

// ── Component ───────────────────────────────────────────────────

export default function PageLayout({
  title,
  subtitle,
  parentLabel,
  onParentClick,
  onTitleClick,
  menuItems,
  menuLabel,
  entityAction,
  children,
  footer,
  width = "narrow",
  fillHeight = false,
  noContentPadding = false,
  stableChrome = false,
}: PageLayoutProps) {
  // Publish this page's identity to the TopBar.
  useRegisterPageIdentity({
    title,
    subtitle,
    parentLabel,
    onParentClick,
    onTitleClick,
    menuItems,
    menuLabel,
    entityAction,
  });

  const widthClass = width === "wide" ? "max-w-6xl" : "max-w-3xl";

  // Key the content cross-fade on title+subtitle+active-tab so:
  //  - Source pages animate when switching feed/configure/display
  //    (subtitle changes).
  //  - Settings/Catalog/Support animate when switching tab pills
  //    (activeKey changes) even though title stays the same.
  const contentKey = `${title}::${subtitle ?? ""}`;

  // Each content identity is a fresh page: reset the scroll container.
  // Without this the scroller (which persists across same-route source
  // swaps) carries the previous page's scrollTop, so you could ARRIVE
  // mid-scroll — with the widget bar's pinned shadow already showing.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [contentKey]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Content stack ────────────────────────────────────
          Children are wrapped in an AnimatePresence + motion.div
          keyed on title+subtitle+active-tab so navigating between
          sub-routes (e.g. Feed → Configure → Display on a source
          page) or sibling tabs (Appearance → Ticker → Account in
          Settings) cross-fades the content while the TopBar chrome
          stays stable. The cross-fade uses 'wait' mode for a clean
          one-at-a-time transition without overlap during route
          changes.

          Do NOT pass initial={false} here: AnimatePresence sets
          PresenceContext.initial=false for its first render, which
          silently blocks the mount animation of EVERY nested motion
          component — it killed all page entrance choreography
          (catalog cards, settings sections, support hub) until
          v1.1.1. Initial animations on page arrival are a feature. */}
      {fillHeight ? (
        // Fill-height mode: content area is a flex column with no
        // outer scroll. Children manage their own scrollable panel.
        // Used by Configure routes that have a long inner list.
        <div className="flex-1 min-h-0 flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={contentKey}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              className={clsx(
                "mx-auto px-5 pt-5 pb-0 w-full flex-1 min-h-0 flex flex-col",
                widthClass,
              )}
            >
              {children}
            </motion.div>
          </AnimatePresence>
          {footer && (
            <div className="border-t border-edge/40 shrink-0">
              <div className={clsx("mx-auto px-5 py-4", widthClass)}>
                {footer}
              </div>
            </div>
          )}
        </div>
      ) : (
        // Default mode: content area scrolls; children stack vertically.
        // (`relative` anchors popLayout's absolutely-positioned exits.)
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode={stableChrome ? "popLayout" : "wait"}>
            <motion.div
              key={contentKey}
              initial={stableChrome ? "hidden" : { opacity: 0, y: 4 }}
              animate={stableChrome ? "show" : { opacity: 1, y: 0 }}
              exit={stableChrome ? "out" : { opacity: 0, y: -4 }}
              variants={
                stableChrome
                  ? {
                      // The bar chrome lives outside this subtree now, so
                      // the feed content can drift vertically again.
                      hidden: { opacity: 0, y: 6 },
                      show: { opacity: 1, y: 0 },
                      out: { opacity: 0, y: -6 },
                    }
                  : undefined
              }
              transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              className={clsx(
                noContentPadding ? "w-full" : "mx-auto px-5 py-5",
                !noContentPadding && widthClass,
              )}
            >
              {children}
            </motion.div>
          </AnimatePresence>
          {footer && (
            <div className="border-t border-edge/40">
              <div className={clsx("mx-auto px-5 py-4", widthClass)}>
                {footer}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
