/**
 * PageLayout — universal page chassis.
 *
 * Page identity (title, subtitle, parent breadcrumb, entity action)
 * is published to the TopBar via PageContext, NOT rendered here. The
 * old in-page header band is gone — the status bar is the single
 * canonical home for "where am I" identity across the whole app.
 *
 * What stays inside the route's content area:
 *   1. Tab band — sub-navigation within this page (Feed / Configure)
 *   2. Content stack — children
 *   3. Footer — optional destructive/peripheral page-level actions
 *
 * IA refactor 2026-05-09 polish pass — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { useRegisterPageIdentity } from "./page-context";
import type { OverflowMenuItem } from "../OverflowMenu";

// ── Tab type ────────────────────────────────────────────────────

export interface PageTab {
  /** URL-like identifier for the tab. */
  key: string;
  /** Human label rendered in the tab button. */
  label: string;
  /** Optional tooltip / aria description. */
  description?: string;
}

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
   * Contextual menu items for this page. When present, the last
   * breadcrumb segment in the TopBar (subtitle if any, otherwise
   * title) becomes the menu trigger.
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

  /** Optional tab band rendered at the top of the content area. */
  tabs?: {
    items: PageTab[];
    activeKey: string;
    onChange: (key: string) => void;
  };

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
  tabs,
  children,
  footer,
  width = "narrow",
  fillHeight = false,
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
  //  - Settings/Catalog animate when switching tabs (activeKey
  //    changes) even though title+subtitle stay the same.
  const contentKey = `${title}::${subtitle ?? ""}::${tabs?.activeKey ?? ""}`;

  return (
    <div className="flex flex-col h-full">
      {/* ── Tab band (only when route has sub-tabs) ────────── */}
      {tabs && (
        <div className="shrink-0 border-b border-edge/30 bg-surface">
          <div className={clsx("mx-auto px-5", widthClass)}>
            <nav
              className="flex flex-wrap gap-0 -mb-px"
              aria-label="Page sections"
            >
              {tabs.items.map((tab) => {
                const isActive = tab.key === tabs.activeKey;
                return (
                  <button
                    key={tab.key}
                    onClick={() => tabs.onChange(tab.key)}
                    aria-current={isActive ? "page" : undefined}
                    title={tab.description}
                    className={clsx(
                      "relative px-3 py-2.5 text-[12px] font-medium transition-colors -mb-px",
                      isActive
                        ? "text-accent"
                        : "text-fg-3 hover:text-fg-2",
                    )}
                  >
                    {tab.label}
                    {/* Animated underline — slides between tabs via
                        layoutId instead of disappearing/reappearing. */}
                    {isActive && (
                      <motion.span
                        layoutId="page-tab-underline"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent rounded-full"
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* ── Content stack ────────────────────────────────────
          Children are wrapped in an AnimatePresence + motion.div
          keyed on title+subtitle so navigating between sub-routes
          (e.g. Feed → Configure → Display on a source page) cross-
          fades the content while the TopBar chrome and tab band
          stay stable. The cross-fade uses 'wait' mode for a clean
          one-at-a-time transition without overlap during route
          changes. */}
      {fillHeight ? (
        // Fill-height mode: content area is a flex column with no
        // outer scroll. Children manage their own scrollable panel.
        // Used by Configure routes that have a long inner list.
        <div className="flex-1 min-h-0 flex flex-col">
          <AnimatePresence mode="wait" initial={false}>
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
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentKey}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              className={clsx("mx-auto px-5 py-5", widthClass)}
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
