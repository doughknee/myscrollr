/**
 * EmptyChannelState — shared empty-state placeholder for channel FeedTabs.
 *
 * Replaces the repeated empty-state pattern in finance, sports, rss, and
 * fantasy feeds.
 *
 * Copy is pointed at the **breadcrumb dropdown in the TopBar** — the
 * channel name + chevron at the top of the window (e.g. "Sports ▾").
 * That dropdown is the ONLY sub-tab switcher on channel pages; there is
 * no horizontal tab strip and no "Settings" tab in the title bar. The
 * earlier copy said "Open the Settings tab" which was misleading — users
 * looked for a tab that doesn't exist.
 *
 * The CTA button still jumps directly to the Configure sub-tab so the
 * one-tap fix is preserved; the surrounding copy teaches the user where
 * the dropdown lives so they can do it themselves next time.
 */
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

interface EmptyChannelStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** What hasn't been added yet (e.g. "stocks or crypto", "leagues", "feeds"). */
  noun: string;
  /**
   * Display name of the channel itself, e.g. "Finance", "Sports", "RSS",
   * "Fantasy". Used to label the breadcrumb dropdown trigger in the
   * teaching copy. When omitted, the copy falls back to the generic
   * "channel name" phrase.
   */
  channelName?: string;
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
   * dropdown path so they can do it themselves next time.
   */
  onConfigure?: () => void;
}

export default function EmptyChannelState({
  icon: Icon,
  noun,
  channelName,
  hasConfig,
  dashboardLoaded,
  loadingNoun,
  actionHint,
  onConfigure,
}: EmptyChannelStateProps) {
  const breadcrumbLabel = channelName ?? "channel name";

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
                "inline-flex items-center gap-0.5 align-baseline",
                "px-1 py-px rounded",
                "bg-fg-4/10 text-fg-2 font-semibold",
              )}
            >
              {breadcrumbLabel}
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
