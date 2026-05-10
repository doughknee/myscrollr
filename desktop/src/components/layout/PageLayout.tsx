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
import { useRegisterPageIdentity } from "./page-context";

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

  /**
   * Destructive or contextual action tied to the page entity. Rendered
   * in the TopBar on the right side of the breadcrumb. Source pages
   * use this for Trash; most pages omit it.
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
}

// ── Component ───────────────────────────────────────────────────

export default function PageLayout({
  title,
  subtitle,
  parentLabel,
  onParentClick,
  entityAction,
  tabs,
  children,
  footer,
  width = "narrow",
}: PageLayoutProps) {
  // Publish this page's identity to the TopBar.
  useRegisterPageIdentity({
    title,
    subtitle,
    parentLabel,
    onParentClick,
    entityAction,
  });

  const widthClass = width === "wide" ? "max-w-6xl" : "max-w-3xl";

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
                      "px-3 py-2.5 text-[12px] font-medium transition-colors border-b-2 -mb-px",
                      isActive
                        ? "text-accent border-accent"
                        : "text-fg-3 border-transparent hover:text-fg-2",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* ── Content stack ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className={clsx("mx-auto px-5 py-5", widthClass)}>
          {children}
        </div>

        {/* ── Footer band (optional) ──────────────────────── */}
        {footer && (
          <div className="border-t border-edge/40">
            <div className={clsx("mx-auto px-5 py-4", widthClass)}>
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
