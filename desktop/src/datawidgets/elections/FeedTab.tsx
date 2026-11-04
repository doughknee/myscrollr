import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Vote } from "lucide-react";
import PinSubjectButton from "../../components/PinSubjectButton";
import RacePicker from "./RacePicker";
import SourceLink from "./SourceLink";
import { electionPreviewPath } from "../../config";
import { authFetch } from "../../api/client";
import { dashboardQueryOptions } from "../../api/queries";
import { useDataWidgetConfig } from "../../hooks/useDataWidgetConfig";
import { followedRaceIds, percent, raceView, votes } from "./view";
import type { DataWidgetManifest, HomeRowsProps } from "../../types";
import type { ElectionSearch } from "../../types/api.generated";
import type { ElectionRace } from "./view";

function ElectionHomeRows({ data, onConfigure }: HomeRowsProps) {
  if (!data.length)
    return (
      <button type="button" className="w-full p-3 text-left text-sm text-fg-2" onClick={onConfigure}>
        Choose a race to follow
      </button>
    );
  return (data as ElectionRace[]).map((race) => {
    const view = raceView(race);
    return (
      <button
        key={race.id}
        type="button"
        onClick={onConfigure}
        className="block w-full border-t border-edge px-4 py-3 text-left hover:bg-surface-hover"
      >
        <span className="block text-xs text-fg-3">{race.name}</span>
        <strong className="block text-sm text-fg">{view.headline}</strong>
        <span className="text-xs text-fg-2">
          {race.delayed && "Updates delayed · "}
          {[view.reporting, view.updated].filter(Boolean).join(" · ")}
        </span>
      </button>
    );
  });
}

function ResultCard({
  race,
  onUnfollow,
  saving,
}: {
  race: ElectionRace;
  onUnfollow: () => void;
  saving: boolean;
}) {
  const { candidates, headline, reporting, updated, countsOnly, directoryOnly } = raceView(race);
  return (
    <article className="rounded-lg border border-edge bg-surface p-4" aria-label={race.name}>
      <div className="text-xs text-fg-3">
        {race.state} · {race.election_date}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-fg">{race.name}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <PinSubjectButton widget="elections" subject={String(race.id)} label={race.name} />
          <button
            type="button"
            aria-label={"Unfollow " + race.name}
            onClick={onUnfollow}
            disabled={saving}
            className="text-xs text-fg-2 underline"
          >
            Unfollow
          </button>
        </div>
      </div>
      <p className="mt-1 font-semibold text-fg">{headline}</p>
      <p className="mt-1 text-xs text-fg-2">
        {reporting && reporting + " · "}
        {race.source_updated_at && !directoryOnly ? "Source updated " : ""}
        {updated}
      </p>
      {race.delayed && (
        <p role="status" className="mt-2 text-xs text-warning">
          Updates delayed{race.source_updated_at ? " · showing the last available count" : ""}
        </p>
      )}
      {countsOnly && (
        <p className="mt-2 text-xs text-fg-2">
          {directoryOnly
            ? "These candidate totals were recorded during the directory check."
            : "Candidate totals are shown while this race’s voting rules are unverified."}
        </p>
      )}
      {candidates.length > 0 && (
        <table className="my-3 w-full text-left text-sm tabular-nums">
          <caption className="sr-only">Candidate results for {race.name}</caption>
          <thead className="text-xs text-fg-3">
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col" className="text-right">
                Votes
              </th>
              {!countsOnly && (
                <th scope="col" className="text-right">
                  Share
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-t border-edge">
                <th scope="row" className="py-2 font-medium">
                  {c.name} <span className="text-xs text-fg-3">{c.party}</span>
                </th>
                <td className="text-right">{votes(c.votes)}</td>
                {!countsOnly && (
                  <td className="text-right">{c.percent == null ? "—" : percent(c.percent)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SourceLink href={`https://civicapi.org/results/elections/${race.id}`}>
        Results from civicAPI
      </SourceLink>
    </article>
  );
}

function ElectionsFeedTab() {
  const dashboard = useQuery(dashboardQueryOptions());
  const row = dashboard.data?.widgets?.find((w) => w.widget_type === "elections");
  const ids = followedRaceIds(row?.config);
  const { error, saving, updateItems } = useDataWidgetConfig<number[]>("elections", "race_ids");
  const raw = dashboard.data?.data?.elections;
  const races = raw ?? [];
  const missingResults = ids.length > 0 && !raw && !!dashboard.data && !dashboard.isFetching;
  const missingIds = ids.filter((id) => !races.some((r) => r.id === id)).join(",");
  const missingChoices = useQuery({
    queryKey: ["elections", "followed", missingIds],
    queryFn: ({ signal }) =>
      authFetch<ElectionSearch>(electionPreviewPath("/elections/search?ids=" + encodeURIComponent(missingIds)), {
        signal,
      }),
    enabled: !!row && row.id > 0 && !!missingIds,
    staleTime: 60_000,
  });
  if (dashboard.isSuccess && !row) {
    return (
      <p className="p-4 text-sm text-fg-2">
        Add Election Results from the{" "}
        <Link to="/catalog" className="text-primary underline">
          Widget Library
        </Link>{" "}
        to follow a race.
      </p>
    );
  }
  return (
    <section className="space-y-4 p-4 text-fg">
      {ids.length > 0 && (
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Following ({ids.length})</h2>
          <button
            type="button"
            onClick={() => document.getElementById("race-picker")?.scrollIntoView()}
            className="text-sm underline"
          >
            Find more races
          </button>
        </header>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {(dashboard.isError || dashboard.fetchStatus === "paused" || missingResults) && (
        <p role="alert" className="text-warning">
          Couldn’t refresh results. {races.length ? "Showing the last available update." : ""}{" "}
          <button className="underline" onClick={() => void dashboard.refetch()}>
            Retry
          </button>
        </p>
      )}
      {ids.map((id) => {
        const race = races.find((r) => r.id === id);
        const unfollow = () => updateItems(ids.filter((raceId) => raceId !== id));
        const name = missingChoices.data?.races.find((r) => r.id === id)?.name ?? "race " + id;
        return race ? (
          <ResultCard key={id} race={race} onUnfollow={unfollow} saving={saving} />
        ) : (
          <div key={id} className="flex justify-between gap-2 text-sm text-fg-2">
            <p role="status">Waiting for results for {name}.</p>
            <button
              type="button"
              disabled={saving}
              aria-label={"Unfollow " + name}
              onClick={unfollow}
              className="underline"
            >
              Unfollow
            </button>
          </div>
        );
      })}
      <RacePicker
        ids={ids}
        saving={saving}
        enabled={!!row && row.id > 0}
        onFollow={(id) => updateItems([...ids, id])}
      />
    </section>
  );
}

export const electionsDataWidget: DataWidgetManifest = {
  id: "elections",
  name: "Elections",
  tabLabel: "Elections",
  hex: "#818cf8",
  icon: Vote,
  description: "Follow election returns as votes are counted.",
  info: {
    about: "Track supported elections with results from civicAPI.",
    usage: [
      "Follow a race to add its returns to the ticker.",
      "Open the race to see every candidate and the source update time.",
    ],
  },
  FeedTab: ElectionsFeedTab,
  HomeRows: ElectionHomeRows,
};
