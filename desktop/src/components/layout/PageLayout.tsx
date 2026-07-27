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
 * Tab band hoisted into the TopBar on 2026-05-11 to reclaim vertical
 * space and consolidate page chrome.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
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

  // Reset the scroll container when the visible page identity changes.
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
      {/* ── Content stack ──────────────────────────────────── */}
      {fillHeight ? (
        // Fill-height mode: content area is a flex column with no
        // outer scroll. Children manage their own scrollable panel.
        // Used by Configure routes that have a long inner list.
        <div className="flex-1 min-h-0 flex flex-col">
          <div
            className={clsx(
              "mx-auto px-5 pt-5 pb-0 w-full flex-1 min-h-0 flex flex-col",
              widthClass,
            )}
          >
            {children}
          </div>
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
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin [scrollbar-gutter:stable]">
          <div
            className={clsx(
              noContentPadding ? "w-full" : "mx-auto px-5 py-5",
              !noContentPadding && widthClass,
            )}
          >
            {children}
          </div>
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
