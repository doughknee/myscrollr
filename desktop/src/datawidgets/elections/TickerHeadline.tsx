import { votes } from "./view";
import type { raceView } from "./view";

export default function TickerHeadline({ view }: { view: ReturnType<typeof raceView> }) {
  if (!view.tickerCounts.length) return view.headline;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {view.tickerCounts.map((candidate) => (
        <span key={candidate.id} className="flex min-w-0 flex-1 items-baseline gap-1">
          <span className="truncate">{candidate.name}</span>{" "}
          <span className="shrink-0 tabular-nums">{votes(candidate.votes)}<span className="sr-only"> votes</span></span>
        </span>
      ))}
    </span>
  );
}
