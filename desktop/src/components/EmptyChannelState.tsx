/**
 * EmptyChannelState — shared empty-state placeholder for channel FeedTabs.
 *
 * Replaces the repeated empty-state pattern in finance, sports, rss, and
 * fantasy feeds.
 *
 * Copy is pointed at the **"Options" pill in the TopBar** — the
 * Settings2 icon + "Options" label rendered next to the page title.
 * That pill is the canonical menu trigger on source pages (channel +
 * widget). The CTA button still jumps directly to the Configure sub-
 * tab so the one-tap fix is preserved; the surrounding copy teaches
 * the user where the menu lives so they can do it themselves next
 * time.
 *
 * Walkthrough fix 2026-05-11 — previously this tip pointed at a
 * breadcrumb dropdown (channel name + chevron) which no longer exists
 * after the source-page menu was consolidated under the Options pill.
 */
import { clsx } from "clsx";
import { ChevronDown, Settings2 } from "lucide-react";

interface EmptyChannelStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** What hasn't been added yet (e.g. "stocks or crypto", "leagues", "feeds"). */
  noun: string;
  /** Whether the channel has config (i.e. user has picked items to track). */
  hasConfig: boolean;
  /** Whether the dashboard has loaded. */
  dashboardLoaded?: boolean;
  /** Verb for the loading state (e.g. "prices", "scores", "articles"). */
  loadingNoun?: string;
  /** Hint text for the action (e.g. "choose what to track", "pick your leagues"). */
  actionHint?: string;
  /**
   * Navigate to the channel's Configure sub-tab. Wired in
   * `routes/channel.$type.$tab.tsx`. When provided, the hint becomes a
   * one-tap button; the surrounding copy still teaches the user the
   * Options-pill path so they can do it themselves next time.
   */
  onConfigure?: () => void;
}

export default function EmptyChannelState({
  icon: Icon,
  noun,
  hasConfig,
  dashboardLoaded,
  loadingNoun,
  actionHint,
  onConfigure,
}: EmptyChannelStateProps) {
  return (
    <div
      className={clsx(
        "col-span-full flex flex-col items-center justify-center gap-3 py-12 px-6 bg-surface",
      )}
    >
      <Icon size={28} className="text-fg-4/40" />
      {dashboardLoaded === false ? (
        <p className="text-xs text-fg-4">
          Loading {loadingNoun ?? noun}&hellip;
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-fg-3">
            {hasConfig ? `No active ${noun} right now` : `No ${noun} added yet`}
          </p>
          {onConfigure ? (
            <button
              onClick={onConfigure}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md",
                "px-2.5 py-1 text-xs font-medium",
                "text-accent bg-accent/10 hover:bg-accent/15",
                "border border-accent/25 hover:border-accent/40",
                "transition-colors active:scale-[0.97]",
              )}
            >
              Open Configure to {actionHint ?? `add ${noun}`}
            </button>
          ) : null}
          <p className="text-[11px] text-fg-4/80 text-center max-w-sm leading-relaxed">
            Tip: click{" "}
            <span
              className={clsx(
                "inline-flex items-center gap-1 align-baseline",
                "px-1 py-px rounded",
                "bg-fg-4/10 text-fg-2 font-semibold",
              )}
            >
              <Settings2 size={9} strokeWidth={2.5} aria-hidden="true" />
              Options
              <ChevronDown size={9} strokeWidth={2.5} aria-hidden="true" />
            </span>{" "}
            in the title bar to open this menu yourself next time.
          </p>
          <p className="text-[11px] text-fg-4/70 text-center max-w-sm leading-relaxed">
            Looking for a different source? Use{" "}
            <span className="text-fg-3 font-semibold">+ Add source</span> in the
            sidebar to browse the catalog.
          </p>
        </>
      )}
    </div>
  );
}
