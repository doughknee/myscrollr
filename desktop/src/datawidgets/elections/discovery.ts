import { stateNames } from "./states";
import type { ElectionCoverage } from "../../types/api.generated";
import type { RaceDescriptor } from "./view";

export const PAGE_SIZE = 12;
export const offices = {
  governor: "Governor",
  federal: "Congress (House, Senate, delegates)",
  mayor: "Mayor",
  city_council: "City council",
  other: "Other offices",
};

const observationDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export function checkedDate(value: string | null | undefined): string | null {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? observationDate.format(time) : null;
}

export function evidenceLabel(race: RaceDescriptor): string {
  const change = checkedDate(race.changed_at);
  if (change) return "Vote count change observed · " + change;
  const check = checkedDate(race.checked_at);
  const suffix = check ? " · " + check : "";
  switch (race.vote_status) {
    case "votes_reported":
      return "Votes reported" + suffix;
    case "awaiting_votes":
      return "No votes at last check" + suffix;
    case "unavailable":
      return "Vote check unavailable" + suffix;
    default:
      return "Vote totals unverified";
  }
}

export function localOfficialResults(state: string, office: string, activity: string) {
  if (office !== "mayor" && office !== "city_council") return null;
  if (state === "TN") return { name: "Montgomery County results (Clarksville)", url: "https://montgomerytn.gov/election/election-results-november-3-2026" };
  if (state === "NC" && activity) return { name: "North Carolina State Board of Elections results", url: "https://www.ncsbe.gov/results-data/election-results/historical-election-results-data" };
  return null;
}

export function emptySearch(state: string, coverage?: ElectionCoverage): string {
  const status = coverage?.states.find((s) => s.state === state)?.status;
  const place = stateNames[state] ?? state;
  if (status === "unavailable") return "Coverage for " + place + " could not be verified.";
  if (status === "no_listed_races")
    return "civicAPI listed no supported races for " + place + " at the directory check.";
  if (state && !status) return "No matches. Coverage for " + place + " is unverified.";
  return "No races match these filters. Try another office, state, or search term.";
}
