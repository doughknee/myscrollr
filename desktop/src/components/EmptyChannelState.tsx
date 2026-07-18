/**
 * EmptyChannelState — shared empty-state placeholder for channel FeedTabs.
 *
 * Replaces the repeated empty-state pattern in finance, sports, rss, and
 * fantasy feeds.
 *
 * Since the configure-page teardown, every widget's settings live in
 * its bar; the CTA (when a channel passes one) opens the relevant
 * in-feed view, and the tip points at the bar.
 */
import { clsx } from "clsx";

interface EmptyChannelStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** What hasn't been added yet (e.g. "stocks or crypto", "leagues", "feeds"). */
  noun: string;
  /** Whether the channel has config (i.e. user has picked items to track). */
  hasConfig: boolean;
  /** Whether the dashboard has loaded. */
  dashboardLoaded?: boolean;
  /** True while the dashboard query is refetching — right after adding a
   *  widget the row exists optimistically but its data hasn't landed yet;
   *  showing the Configure CTA in that window (v1.1.0 bug) told users to
   *  configure a widget that was simply still loading. */
  refreshing?: boolean;
  /** Verb for the loading state (e.g. "prices", "scores", "articles"). */
  loadingNoun?: string;
  /** Hint text for the action (e.g. "choose what to track", "pick your leagues"). */
  actionHint?: string;
  /**
   * Full button label override. Widgets whose config lives in-widget
   * (post configure-page) pass this so the CTA doesn't say "Open
   * Configure" while actually opening an in-feed view.
   */
  actionLabel?: string;
  /**
   * The CTA action. Historically "navigate to the Configure sub-tab";
   * in-widget-config channels pass their own in-feed action (with
   * `actionLabel`). When provided, the hint becomes a one-tap button.
   */
  onConfigure?: () => void;
}

export default function EmptyChannelState({
  icon: Icon,
  noun,
  hasConfig,
  dashboardLoaded,
  refreshing,
  loadingNoun,
  actionHint,
  actionLabel,
  onConfigure,
}: EmptyChannelStateProps) {
  return (
    <div
      className={clsx(
        "col-span-full flex flex-col items-center justify-center gap-3 py-12 px-6 bg-surface",
      )}
    >
      <Icon size={28} className="text-fg-4/40" />
      {dashboardLoaded === false || refreshing ? (
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
              {actionLabel ?? actionHint ?? `Add ${noun}`}
            </button>
          ) : null}
          <p className="text-[11px] text-fg-4/80 text-center max-w-sm leading-relaxed">
            Tip: every widget's settings live in the bar at the top of the
            widget.
          </p>
          <p className="text-[11px] text-fg-4/70 text-center max-w-sm leading-relaxed">
            Looking for a different widget? Use{" "}
            <span className="text-fg-3 font-semibold">+ Add widget</span> in the
            sidebar to browse the catalog.
          </p>
        </>
      )}
    </div>
  );
}
