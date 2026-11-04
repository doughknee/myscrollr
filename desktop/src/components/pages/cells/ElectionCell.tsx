import { memo } from "react";
import { raceView } from "../../../datawidgets/elections/view";
import type { ElectionRace } from "../../../datawidgets/elections/view";

// Reserves all three lines independently when the leader or reporting rate changes.
export const ELECTION_MIN_COL = 310;

const ElectionCell = memo(function ElectionCell({
  race,
  expanded,
  onClick,
}: {
  race: ElectionRace;
  expanded?: boolean;
  onClick?: () => void;
}) {
  const { headline, reporting, updated } = raceView(race);
  return (
    <button
      type="button"
      data-chip=""
      data-item={String(race.id)}
      data-race-id={race.id}
      data-display-cell={expanded ? "elections" : undefined}
      onClick={onClick}
      className="grid h-full w-full min-w-0 content-center grid-rows-[14px_21px_15px] gap-y-px px-4 text-left"
      title={[race.name, headline, race.delayed ? "Updates delayed" : "", reporting, updated]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-fg-2">
        <span className="truncate">{race.name}</span>
        {race.delayed && <span className="shrink-0 text-warning">Delayed</span>}
      </span>
      <strong className="truncate text-[15px] leading-[21px] text-fg">{headline}</strong>
      <span className="truncate font-mono text-[10px] leading-[15px] text-fg-3">
        {reporting} · {updated}
      </span>
    </button>
  );
});
export default ElectionCell;
