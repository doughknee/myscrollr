/**
 * PageSection — content block inside a PageLayout.
 *
 * Two visual treatments via the `variant` prop:
 *   - "card"  (default for forms / settings / config) — bordered
 *     surface with padding. Good for chunky controls and discrete
 *     control surfaces.
 *   - "plain" (used on Home / dashboards) — borderless, looser
 *     vertical rhythm with a subtle divider between sections. Lets
 *     dense data breathe.
 *   - "grid"  (used on Catalog) — no internal padding, content
 *     handles its own grid layout.
 *
 * Every variant shares the same structure:
 *   <header> title + optional badge + optional sectionAction </header>
 *   <body>   children                                          </body>
 *
 * IA refactor 2026-05-09 — same skeleton, appropriate skin.
 */
import type { ReactNode } from "react";
import clsx from "clsx";

// ── Props ───────────────────────────────────────────────────────

interface PageSectionProps {
  /** Section title. Required for visual rhythm; pass empty string only
   *  for borderless sections that need to display title-less content. */
  title?: string;
  /** Optional inline badge beside the title (e.g. count, status). */
  badge?: ReactNode;
  /** Optional small description rendered under the title. */
  description?: string;
  /**
   * Action(s) rendered top-right of the section header. Use for
   * Pencil/Check edit toggles, "+ Add row" buttons, View All links.
   */
  sectionAction?: ReactNode;
  /** Body of the section. */
  children: ReactNode;
  /** Visual treatment. See file header. */
  variant?: "card" | "plain" | "grid";
  /** Extra classes on the outer wrapper (rare; prefer composition). */
  className?: string;
}

// ── Component ───────────────────────────────────────────────────

export default function PageSection({
  title,
  badge,
  description,
  sectionAction,
  children,
  variant = "card",
  className,
}: PageSectionProps) {
  const wrapperClasses = clsx(
    variant === "card" && "rounded-xl border border-edge/30 bg-base-200/30",
    variant === "plain" && "border-b border-edge/20 last:border-b-0 pb-6 last:pb-0",
    variant === "grid" && "",
    "mb-5 last:mb-0",
    className,
  );

  const headerClasses = clsx(
    "flex items-start justify-between gap-3",
    variant === "card" && "px-4 pt-3.5 pb-3",
    variant === "plain" && "mb-3",
    variant === "grid" && "mb-3",
  );

  const bodyClasses = clsx(
    variant === "card" && "px-4 pb-4",
    variant === "plain" && "",
    variant === "grid" && "",
  );

  return (
    <section className={wrapperClasses}>
      {(title || sectionAction) && (
        <div className={headerClasses}>
          <div className="min-w-0 flex-1">
            {title && (
              <div className="flex items-center gap-2">
                <h2 className="text-[12px] font-semibold text-fg uppercase tracking-wide">
                  {title}
                </h2>
                {badge}
              </div>
            )}
            {description && (
              <p className="text-ui-meta text-fg-3 mt-0.5 leading-snug">
                {description}
              </p>
            )}
          </div>
          {sectionAction && (
            <div className="shrink-0 flex items-center gap-1">
              {sectionAction}
            </div>
          )}
        </div>
      )}
      <div className={bodyClasses}>{children}</div>
    </section>
  );
}
