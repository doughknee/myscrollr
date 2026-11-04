import type { ElectionResult as ElectionRace } from "../../types/api.generated";
export type {
  ElectionResult as ElectionRace,
  ElectionRace as RaceDescriptor,
} from "../../types/api.generated";

const numbers = new Intl.NumberFormat(undefined);
const percentages = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const sourceDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export const votes = (value: number | bigint) => numbers.format(value);
export const percent = (value: number) => percentages.format(value) + "%";

export function followedRaceIds(config: unknown): number[] {
  const ids = (config as { race_ids?: unknown } | undefined)?.race_ids;
  return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0) : [];
}

export function raceView(race: ElectionRace) {
  // Before national discovery this beta supported only Tennessee Governor.
  const singleSeat = race.result_mode === "single_seat" || (!race.result_mode && race.id === 87476);
  const nationwide = race.snapshot_kind === "directory_live";
  const directoryOnly = nationwide || race.snapshot_kind === "directory";
  const countsOnly = !singleSeat || directoryOnly;
  const byVotes = [...race.candidates].sort((a, b) => b.votes - a.votes || a.id - b.id);
  const candidates = countsOnly
    ? [...byVotes].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    : byVotes;
  const candidateTotals = byVotes.slice(0, 2)
    .map((c) => c.name + " " + votes(c.votes) + (c.votes === 1 ? " vote" : " votes"))
    .join(" · ");
  const [first, second] = candidates;
  const winners = candidates.filter((c) => c.winner);
  const hasObservation = race.source_updated_at || (directoryOnly && race.observed_at);
  let headline = !hasObservation && race.delayed ? "Waiting for source data" : "Awaiting votes";
  if (countsOnly) {
    const total = candidates.reduce((sum, c) => sum + BigInt(c.votes), 0n);
    if (total > 0n) headline = votes(total) + (total === 1n ? " candidate vote" : " candidate votes");
    if (race.disputed) headline = "Disputed · " + headline;
  } else if (race.disputed || winners.length > 1) headline = "Result disputed";
  else if (winners.length === 1) headline = "civicAPI calls it for " + winners[0].name;
  else if (first && first.votes > 0) {
    if (!second) headline = first.name + " leads";
    else if (first.votes === second.votes) headline = "Tied for the lead";
    else {
      const margin = first.votes - second.votes;
      headline = first.name + " leads by " + votes(margin) + (margin === 1 ? " vote" : " votes");
    }
  }
  const reporting = countsOnly
    ? null
    : race.percent_reporting == null
      ? "Reporting unavailable"
      : percent(race.percent_reporting) + " reporting";
  const time = Date.parse(race.source_updated_at ?? "");
  const observed = Date.parse(race.observed_at ?? "");
  const directoryLabel = nationwide
    ? (race.delayed ? "Last nationwide returns" : "Nationwide returns")
    : "Directory snapshot";
  const updated = directoryOnly
    ? directoryLabel +
      (Number.isFinite(observed) ? " · checked " + sourceDate.format(observed) : " · check time unknown")
    : Number.isFinite(time)
      ? sourceDate.format(time)
      : "No source update yet";
  const tickerCounts = nationwide && !race.disputed ? byVotes.slice(0, 2) : [];
  return { candidates, candidateTotals, headline, tickerCounts, reporting, updated, countsOnly, directoryOnly, nationwide };
}
