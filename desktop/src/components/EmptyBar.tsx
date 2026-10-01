/**
 * The ticker's two empty states, shared by both bars (SCROLLR-274):
 *  - sourceless:   signed in, no widgets installed at all -> browse the catalog
 *  - installedOff: widgets installed, none showing -> open one to turn it on
 *
 * The continuous bar draws them as one centred row. The pages bar draws
 * the same row beside a label block in the theme accent, so the bar keeps
 * its pages look (label, then content) instead of changing shape.
 * Deciding WHEN to show them stays in App.tsx.
 */
import type { ComponentType, ReactNode } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { LABEL_W } from "./pages/pagePlan";
import { accentStyle, mix } from "./pages/cells/parts";

export interface InstalledWidgetMeta {
  id: string;
  name: string;
  hex: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  kind: "sourceless" | "installedOff";
  /** Draw the pages-look label block ahead of the message. */
  pages?: boolean;
  installedWidgets?: InstalledWidgetMeta[];
  onAddSources?: () => void;
  onOpenWidget?: (widgetId: string) => void;
}

/** Accent hairline + centred stack, with an optional teaching tip beneath. */
function Row({ tip, children }: { tip?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center justify-center gap-0.5 px-4">
      <div className="flex min-w-0 items-center justify-center gap-2">{children}</div>
      {tip && (
        <p className="hidden shrink-0 items-center gap-1 text-[10px] leading-tight text-fg-4/80 md:inline-flex">
          <span className="text-fg-4">Tip:</span>
          {tip}
        </p>
      )}
    </div>
  );
}

export default function EmptyBar({ kind, pages = false, installedWidgets = [], onAddSources, onOpenWidget }: Props) {
  const body =
    kind === "sourceless" ? (
      <Row
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
        <span className="shrink-0 text-ui-meta font-medium text-fg-2">You haven&rsquo;t added any sources yet.</span>
        <span className="hidden shrink-0 text-ui-meta text-fg-4 sm:inline">Browse the catalog to add one:</span>
        <button
          type="button"
          onClick={onAddSources}
          disabled={!onAddSources}
          className={clsx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md",
            "px-2.5 py-1 text-ui-meta font-semibold",
            "bg-accent/10 text-accent hover:bg-accent/15",
            "border border-accent/25 hover:border-accent/40",
            "transition-colors active:scale-[0.97]",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
          Browse the catalog
        </button>
      </Row>
    ) : (
      <Row tip={<span>every widget&rsquo;s settings live in the bar at the top of its page.</span>}>
        <span className="shrink-0 text-ui-meta font-medium text-fg-2">Your ticker is empty right now.</span>
        <span className="hidden shrink-0 text-ui-meta text-fg-4 sm:inline">Open a source to pick what shows up here:</span>
        <div className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {installedWidgets.map((ch) => {
            const WidgetGlyphIcon = ch.icon;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => onOpenWidget?.(ch.id)}
                disabled={!onOpenWidget}
                className={clsx(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md",
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
      className="ticker-container relative flex h-16 w-full shrink-0 items-stretch overflow-hidden border-b border-edge/50 bg-base-150"
    >
      <div className="absolute left-0 right-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      {pages && (
        <div
          data-label="empty"
          className="flex shrink-0 flex-col justify-center gap-[3px] pl-3.5 pr-2"
          style={{
            ...accentStyle("var(--color-primary)", "color-mix(in srgb, var(--color-primary) 50%, var(--color-fg))"),
            width: LABEL_W,
            background: mix(16),
            borderRight: `1px solid ${mix(40)}`,
          }}
        >
          <span className="font-sans text-[19px] font-extrabold leading-none tracking-[0.04em]" style={{ color: "var(--accent-ink)" }}>
            EMPTY
          </span>
          <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-2">
            {kind === "sourceless" ? "no sources" : "all off"}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}
