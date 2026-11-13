/**
 * The ticker's empty states, shared by both bars (SCROLLR-274):
 *  - sourceless:   signed in, no widgets installed at all -> browse the catalog
 *  - installedOff: widgets installed, none showing -> open one to turn it on
 *  - failed:       no dashboard at all and the last load failed -> try again
 *                  (SCROLLR-406: never dressed up as an empty account)
 *
 * The continuous bar draws them as one centred row. The pages bar draws
 * the same row beside a label block in the theme accent, so the bar keeps
 * its pages look (label, then content) instead of changing shape.
 * Deciding WHEN to show them stays in App.tsx.
 */
import type { ComponentType, ReactNode } from "react";
import clsx from "clsx";
import { Plus, RotateCw } from "lucide-react";
import { BAND_W, DISPLAY_HEADER_H } from "./pages/pagePlan";
import { accentStyle, mix } from "./pages/cells/parts";

export interface InstalledWidgetMeta {
  id: string;
  name: string;
  hex: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  kind: "sourceless" | "installedOff" | "failed";
  /** Draw the pages-look label block ahead of the message. */
  pages?: boolean;
  /** Shared Fill-grid canvas height; docked/strip keep their compact row. */
  fillHeight?: number;
  installedWidgets?: InstalledWidgetMeta[];
  onAddSources?: () => void;
  onOpenWidget?: (widgetId: string) => void;
  onRetry?: () => void;
}

const BUTTON = clsx(
  "inline-flex shrink-0 items-center gap-1.5 rounded-md",
  "px-2.5 py-1 text-ui-meta font-semibold",
  "bg-accent/10 text-accent hover:bg-accent/15",
  "border border-accent/25 hover:border-accent/40",
  "transition-colors active:scale-[0.97]",
  "disabled:pointer-events-none disabled:opacity-50",
);

const LABEL = { sourceless: ["EMPTY", "no sources"], installedOff: ["EMPTY", "all off"], failed: ["NO DATA", "couldn’t load"] } as const;

/** Accent hairline + centred stack, with an optional teaching tip beneath. */
function Row({ tip, children, expanded }: { tip?: ReactNode; children: ReactNode; expanded?: boolean }) {
  return (
    <div className={clsx("flex w-full min-w-0 flex-col items-center justify-center px-4", expanded ? "min-h-full gap-4 py-6" : "h-full gap-0.5")}>
      <div className={clsx("flex min-w-0 items-center justify-center", expanded ? "w-full max-w-xl flex-col gap-3 text-center" : "gap-2")}>{children}</div>
      {tip && (
        <p className={clsx("shrink-0 items-center gap-1 text-[10px] leading-tight text-fg-4/80", expanded ? "flex max-w-sm flex-wrap justify-center text-center" : "hidden md:inline-flex")}>
          <span className="text-fg-4">Tip:</span>
          {tip}
        </p>
      )}
    </div>
  );
}

export default function EmptyBar({ kind, pages = false, fillHeight, installedWidgets = [], onAddSources, onOpenWidget, onRetry }: Props) {
  const expanded = fillHeight !== undefined;
  // The secondary line drops below 1024px so the button is never cut off on a
  // narrow or portrait display (UD-13): the first line and the button say it.
  const secondary = clsx("text-ui-meta text-fg-4", expanded ? "max-w-full" : "hidden shrink-0 lg:inline");
  const body =
    kind === "failed" ? (
      <Row expanded={expanded}>
        <span className={clsx("text-ui-meta font-medium text-fg-2", expanded ? "max-w-full" : "shrink-0")}>Couldn&rsquo;t load your sources.</span>
        <span className={secondary}>Scrollr will keep trying.</span>
        <button type="button" onClick={onRetry} disabled={!onRetry} className={BUTTON}>
          <RotateCw size={11} strokeWidth={2.5} aria-hidden="true" />
          Try again
        </button>
      </Row>
    ) : kind === "sourceless" ? (
      <Row
        expanded={expanded}
        tip={
          <>
            <span>use</span>
            <span className="inline-flex items-center gap-0.5 rounded bg-fg-4/10 px-1 py-px align-baseline font-semibold text-fg-2">
              + Add source
            </span>
            <span>in the sidebar to do this yourself next time.</span>
          </>
        }
      >
        <span className={clsx("text-ui-meta font-medium text-fg-2", expanded ? "max-w-full" : "shrink-0")}>You haven&rsquo;t added any sources yet.</span>
        <span className={secondary}>Browse the catalog to add one:</span>
        <button
          type="button"
          onClick={onAddSources}
          disabled={!onAddSources}
          className={BUTTON}
        >
          <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
          Browse the catalog
        </button>
      </Row>
    ) : (
      <Row expanded={expanded} tip={<span>every widget&rsquo;s settings live in the bar at the top of its page.</span>}>
        <span className={clsx("text-ui-meta font-medium text-fg-2", expanded ? "max-w-full" : "shrink-0")}>Your ticker is empty right now.</span>
        <span className={secondary}>Open a source to pick what shows up here:</span>
        <div className={clsx("flex min-w-0 items-center gap-1.5", expanded ? "max-w-full flex-wrap justify-center" : "scrollbar-none overflow-x-auto")}>
          {installedWidgets.map((ch) => {
            const WidgetGlyphIcon = ch.icon;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onOpenWidget?.(ch.id)}
                disabled={!onOpenWidget}
                className={clsx(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md max-w-full",
                  "px-2 py-1 text-ui-meta font-semibold",
                  "border transition-colors active:scale-[0.97]",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
                style={{
                  color: ch.hex,
                  backgroundColor: `${ch.hex}14`, // ~8% alpha
                  borderColor: `${ch.hex}3D`, // ~24% alpha
                }}
                title={`Open ${ch.name}`}
              >
                <WidgetGlyphIcon size={12} className="shrink-0" />
                <span className="truncate">{ch.name}</span>
              </button>
            );
          })}
        </div>
      </Row>
    );

  return (
    <div
      data-pages={pages ? "" : undefined}
      data-empty={kind}
      className={clsx("ticker-container relative flex w-full shrink-0 items-stretch overflow-hidden border-b border-edge/50 bg-base-150", expanded ? "flex-col" : "h-16")}
      style={expanded ? { height: fillHeight } : undefined}
    >
      <div className="absolute left-0 right-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      {pages && (
        <div
          data-label="empty"
          className="flex shrink-0 flex-col justify-center gap-[3px] pl-3.5 pr-2"
          style={{
            ...accentStyle("var(--color-primary)", "color-mix(in srgb, var(--color-primary) 50%, var(--color-fg))"),
            width: expanded ? undefined : BAND_W,
            height: expanded ? DISPLAY_HEADER_H : undefined,
            background: mix(16),
            borderRight: expanded ? undefined : `1px solid ${mix(40)}`,
            borderBottom: expanded ? `1px solid ${mix(40)}` : undefined,
          }}
        >
          <span className="font-sans text-[19px] font-extrabold leading-none tracking-[0.04em]" style={{ color: "var(--accent-ink)" }}>
            {LABEL[kind][0]}
          </span>
          <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-2">
            {LABEL[kind][1]}
          </span>
        </div>
      )}
      <div className={clsx("min-w-0 flex-1", expanded && "min-h-0 overflow-y-auto")}>{body}</div>
    </div>
  );
}
