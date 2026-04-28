import type { UserOverview } from "../../api/client";

interface AccountStatsRowProps {
  channelsTotal: number;
  channelsEnabled: number;
  fantasy: UserOverview["fantasy"];
}

export default function AccountStatsRow({
  channelsTotal,
  channelsEnabled,
  fantasy,
}: AccountStatsRowProps) {
  if (channelsTotal === 0) return null;

  const showFantasy =
    fantasy !== null && fantasy.yahoo_connected && fantasy.league_count > 0;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-base-200 border border-edge">
      <div className="text-xs text-fg-3 uppercase tracking-wider">
        Quick stats
      </div>
      <div className="text-sm text-fg-2">
        <span className="font-medium text-fg">{channelsEnabled}</span>
        <span className="text-fg-3"> of </span>
        <span className="font-medium text-fg">{channelsTotal}</span>
        <span className="text-fg-3"> channels enabled</span>
      </div>
      {showFantasy && (
        <div className="text-sm text-fg-2">
          <span className="font-medium text-fg">{fantasy!.league_count}</span>
          <span className="text-fg-3">
            {" "}fantasy league{fantasy!.league_count !== 1 ? "s" : ""} imported
          </span>
        </div>
      )}
    </div>
  );
}
