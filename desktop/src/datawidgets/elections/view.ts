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

export const votes = (value: number) => numbers.format(value);
export const percent = (value: number) => percentages.format(value) + "%";

export function followedRaceIds(config: unknown): number[] {
  const ids = (config as { race_ids?: unknown } | undefined)?.race_ids;
  return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0) : [];
}

export function raceView(race: ElectionRace) {
  const candidates = [...race.candidates].sort((a, b) => b.votes - a.votes || a.id - b.id);
  const [first, second] = candidates;
  const winners = candidates.filter((c) => c.winner);
  let headline = !race.source_updated_at && race.delayed ? "Waiting for source data" : "Awaiting votes";
  if (race.disputed || winners.length > 1) headline = "Result disputed";
  else if (winners.length === 1) headline = "civicAPI calls it for " + winners[0].name;
  else if (first && first.votes > 0) {
    if (!second) headline = first.name + " leads";
    else if (first.votes === second.votes) headline = "Tied for the lead";
    else {
      const margin = first.votes - second.votes;
      headline = first.name + " leads by " + votes(margin) + (margin === 1 ? " vote" : " votes");
    }
  }
  const reporting =
    race.percent_reporting == null ? "Reporting unavailable" : percent(race.percent_reporting) + " reporting";
  const time = Date.parse(race.source_updated_at ?? "");
  const updated = Number.isFinite(time) ? sourceDate.format(time) : "No source update yet";
  return { candidates, headline, reporting, updated };
}
