/**
 * Home briefing — the bento pieces.
 *
 * Consolidation here is PRESENTATION ONLY. Cards group by source so the
 * page reads as a briefing rather than a stack of per-widget panels, but
 * every link still targets a widget id: the Scores header carries a chip
 * per league, Markets carries one per watchlist, rows deep-link to their
 * owning widget. Nothing ever links to a "group", because a group is not
 * a thing you can open, configure, or remove.
 */
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

// ── Shared chrome ───────────────────────────────────────────────

export function Card({
  title,
  icon,
  meta,
  chips,
  footer,
  children,
}: {
  title: string;
  icon?: ReactNode;
  /** Right-aligned status text, e.g. market hours. */
  meta?: ReactNode;
  /** Per-widget deep links. Never a group link. */
  chips?: { id: string; label: string; onClick: () => void }[];
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-edge/55 bg-surface-raised">
      <header className="flex items-center gap-2 border-b border-fg/7 px-3.5 py-2.5">
        {icon && <span className="shrink-0 text-fg-3">{icon}</span>}
        <h2 className="text-ui-body font-semibold text-fg">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {meta && <span className="text-ui-chip text-fg-4">{meta}</span>}
          {chips?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={c.onClick}
              className="flex cursor-pointer items-center gap-0.5 rounded-md border border-edge/55 px-1.5 py-0.5 text-ui-chip font-medium text-fg-3 hover:border-edge hover:text-fg"
            >
              {c.label}
              <ChevronRight size={10} />
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1">{children}</div>
      {footer && (
        <div className="flex items-center gap-1.5 border-t border-fg/7 px-3.5 py-2">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A row that stands in for a card's body when the widget isn't set up. */
export function SetupBody({
  message,
  cta,
  onCta,
  tone = "accent",
}: {
  message: string;
  cta: string;
  onCta: () => void;
  tone?: "accent" | "brand";
  brandHex?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-3.5 py-4">
      <p className="text-ui-meta text-fg-3">{message}</p>
      <button
        type="button"
        onClick={onCta}
        className={clsx(
          "cursor-pointer rounded-[7px] px-2.5 py-1.5 text-ui-chip font-semibold",
          tone === "accent"
            ? "bg-accent/12 text-accent hover:bg-accent/20"
            : "bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/25",
        )}
      >
        {cta}
      </button>
    </div>
  );
}

export function LiveDot({ label = "LIVE" }: { label?: string }) {
  return (
    // The text is the badge. Colour alone would leave the state invisible
    // to anyone who can't separate red from grey.
    <span className="inline-flex items-center gap-1 rounded bg-error/12 px-1.5 py-0.5 font-mono text-ui-chip font-bold text-error">
      <span className="size-1.5 rounded-full bg-error motion-safe:animate-pulse" />
      {label}
    </span>
  );
}

export function ChangeChip({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-ui-chip font-semibold tabular-nums",
        up ? "bg-success/10 text-success" : "bg-error/8 text-error",
      )}
    >
      {up ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

export function EmptyBody({ children }: { children: ReactNode }) {
  return (
    <p className="px-3.5 py-4 text-ui-meta text-fg-4">{children}</p>
  );
}
