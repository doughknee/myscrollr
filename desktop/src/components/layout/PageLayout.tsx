/**
 * PageLayout — universal page chassis used by every main-window route.
 *
 * Provides the four canonical regions every page shares:
 *   1. Header band     — breadcrumb + title + subtitle + entityAction
 *   2. Tab band        — optional sub-navigation
 *   3. Content stack   — children (typically <PageSection> blocks)
 *   4. Footer          — optional destructive/peripheral actions
 *
 * The chassis enforces consistent vertical rhythm, header height,
 * paddings, and action placement across every route. Distinctive
 * content lives inside; the chrome stays the same so users find the
 * same things in the same places on every page.
 *
 * IA refactor 2026-05-09 — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 */
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";

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
  /** Page title — short, lowercased SaaS-y label rendered in mono uppercase. */
  title: string;
  /** Single-line subtitle that explains the page. Optional. */
  subtitle?: string;

  /**
   * Breadcrumb back affordance — when present, renders a left chevron
   * with parent-path label, click navigates back. Source pages use
   * this; top-level pages (Home, Catalog, Settings, Support) don't.
   */
  breadcrumb?: {
    /** Label of the parent (e.g. "Home"). */
    parentLabel: string;
    /** Click handler — typically navigates to the parent route. */
    onBack: () => void;
  };

  /**
   * Destructive or contextual action tied to the page entity.
   * Source pages use this for the Trash button. Most pages omit it.
   */
  entityAction?: ReactNode;

  /** Optional tab band. When omitted, no tab bar renders. */
  tabs?: {
    items: PageTab[];
    activeKey: string;
    onChange: (key: string) => void;
  };

  /** Page content — typically a stack of <PageSection> components. */
  children: ReactNode;

  /** Optional footer band for destructive/peripheral page-level actions. */
  footer?: ReactNode;

  /**
   * Constrain the content width. Defaults to "narrow" (a comfortable
   * reading column for forms / settings). Use "wide" for grids/dashboards.
   */
  width?: "narrow" | "wide";
}

// ── Component ───────────────────────────────────────────────────

export default function PageLayout({
  title,
  subtitle,
  breadcrumb,
  entityAction,
  tabs,
  children,
  footer,
  width = "narrow",
}: PageLayoutProps) {
  const widthClass = width === "wide" ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className="flex flex-col h-full">
      {/* ── Header band ─────────────────────────────────────── */}
      <header
        className={clsx(
          "shrink-0 border-b border-edge/40 bg-surface",
          tabs ? "pb-0" : "pb-3",
        )}
      >
        <div className={clsx("mx-auto px-5 pt-5", widthClass)}>
          {/* Breadcrumb row (when present) */}
          {breadcrumb && (
            <button
              onClick={breadcrumb.onBack}
              aria-label={`Back to ${breadcrumb.parentLabel}`}
              className="flex items-center gap-0.5 text-[11px] text-fg-4 hover:text-fg-2 transition-colors mb-1.5 -ml-1"
            >
              <ChevronLeft size={13} />
              <span>{breadcrumb.parentLabel}</span>
            </button>
          )}

          {/* Title + subtitle + entity action row */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[11px] font-mono font-semibold text-fg-4 uppercase tracking-wider mb-1">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-fg-4">{subtitle}</p>
              )}
            </div>
            {entityAction && (
              <div className="shrink-0 flex items-center gap-1">
                {entityAction}
              </div>
            )}
          </div>

          {/* Tab band (optional) */}
          {tabs && (
            <nav
              className="flex flex-wrap gap-1 mt-4 -mb-px"
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
                      "px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px",
                      isActive
                        ? "text-accent border-accent"
                        : "text-fg-3 border-transparent hover:text-fg-2 hover:border-edge",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </header>

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
