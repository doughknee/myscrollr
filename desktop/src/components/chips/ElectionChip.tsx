import { memo } from "react";
import { clsx } from "clsx";
import { getChipColors, chipShellClasses } from "./chipColors";
import TickerHeadline from "../../datawidgets/elections/TickerHeadline";
import { raceView } from "../../datawidgets/elections/view";
import type { ElectionRace } from "../../datawidgets/elections/view";

const ElectionChip = memo(function ElectionChip({
  race,
  onClick,
}: {
  race: ElectionRace;
  onClick?: () => void;
}) {
  const view = raceView(race);
  const { headline, candidateTotals, reporting, updated } = view;
  const c = getChipColors("elections");
  const detail = [race.delayed ? "Delayed" : "", reporting, updated].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-race-id={race.id}
      onClick={onClick}
      title={[race.name, headline, candidateTotals, detail].filter(Boolean).join(" · ")}
      className={clsx(
        chipShellClasses(c),
        "grid w-[460px] grid-cols-[138px_minmax(0,1fr)] grid-rows-[30px_20px] font-mono",
      )}
    >
      <span
        className={clsx(
          "row-span-full flex items-center border-r px-[9px] text-left text-[11px] font-bold uppercase leading-tight",
          c.divider,
          c.tabBg,
          c.text,
        )}
      >
        <span className="line-clamp-2">{race.name}</span>
      </span>
      <strong className={clsx("self-center truncate px-2.5 text-left text-[13px]", c.text)}>
        <TickerHeadline view={view} />
      </strong>
      <span className={clsx("truncate px-2.5 text-left text-[10px] tabular-nums", c.textDim)}>{detail}</span>
    </button>
  );
});
export default ElectionChip;
