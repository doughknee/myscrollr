import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Vote } from "lucide-react";
import PinSubjectButton from "../../components/PinSubjectButton";
import { authFetch } from "../../api/client";
import { dashboardQueryOptions } from "../../api/queries";
import { useDataWidgetConfig } from "../../hooks/useDataWidgetConfig";
import { followedRaceIds, percent, raceView, votes } from "./view";
import type { DataWidgetManifest, HomeRowsProps } from "../../types";
import type { ElectionRace, RaceDescriptor } from "./view";

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
          {view.reporting} · {view.updated}
        </span>
      </button>
    );
  });
}

function ResultCard({ race }: { race: ElectionRace }) {
  const { candidates, headline, reporting, updated } = raceView(race);
  return (
    <article className="rounded-lg border border-edge bg-surface p-4" aria-label={race.name}>
      <div className="text-xs text-fg-3">
        {race.state} · {race.election_date}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-fg">{race.name}</h3>
        <PinSubjectButton widget="elections" subject={String(race.id)} label={race.name} />
      </div>
      <p className="mt-1 font-semibold text-fg">{headline}</p>
      <p className="mt-1 text-xs text-fg-2">
        {reporting} · {race.source_updated_at ? "Source updated " : ""}
        {updated}
      </p>
      {race.delayed && (
        <p role="status" className="mt-2 text-xs text-warning">
          Updates delayed{race.source_updated_at ? " · showing the last available count" : ""}
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
              <th scope="col" className="text-right">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-t border-edge">
                <th scope="row" className="py-2 font-medium">
                  {c.name} <span className="text-xs text-fg-3">{c.party}</span>
                </th>
                <td className="text-right">{votes(c.votes)}</td>
                <td className="text-right">{c.percent == null ? "—" : percent(c.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <a
        href={`https://civicapi.org/results/elections/${race.id}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void invoke("open_external", { url: event.currentTarget.href }).catch(() =>
            toast.error("Couldn’t open civicAPI in your browser."),
          );
        }}
        className="text-xs text-primary underline"
      >
        Results from civicAPI
      </a>
    </article>
  );
}

function ElectionsFeedTab() {
  const [search, setSearch] = useState("");
  const dashboard = useQuery(dashboardQueryOptions());
  const row = dashboard.data?.widgets?.find((w) => w.widget_type === "elections");
  const ids = followedRaceIds(row?.config);
  const choices = useQuery({
    queryKey: ["elections", "races"],
    queryFn: () => authFetch<RaceDescriptor[]>("/elections/races"),
    enabled: !!row && row.id > 0,
    staleTime: 60_000,
  });
  const { error, saving, updateItems } = useDataWidgetConfig<number[]>("elections", "race_ids");
  const raw = dashboard.data?.data?.elections;
  const races = raw ?? [];
  const missingResults = ids.length > 0 && !raw && !!dashboard.data && !dashboard.isFetching;
  const matching = (choices.data ?? []).filter((r) =>
    (r.name + " " + r.state).toLowerCase().includes(search.trim().toLowerCase()),
  );
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
      <header>
        <h2 className="text-lg font-semibold">Follow races</h2>
        <p className="text-sm text-fg-2">Choose a supported race to see its returns on your ticker.</p>
      </header>
      <input
        aria-label="Search supported races"
        placeholder="Search supported races"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm"
      />
      {choices.isFetching && !choices.data && <p role="status">Loading supported races…</p>}
      {choices.isError && (
        <p role="alert">
          Couldn’t refresh supported races.{" "}
          <button onClick={() => void choices.refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
      {choices.data && !matching.length && (
        <p className="text-sm text-fg-2">No supported races match your search.</p>
      )}
      <ul className="divide-y divide-edge">
        {matching.map((r) => {
          const following = ids.includes(r.id);
          const label = following ? "Unfollow" : "Follow";
          return (
            <li key={r.id} className="flex items-center justify-between gap-4 py-2">
              <div>
                <strong className="text-sm">{r.name}</strong>
                <p className="text-xs text-fg-3">
                  {r.state} · {r.election_date}
                </p>
              </div>
              <button
                type="button"
                disabled={saving || !row || row.id < 0}
                aria-label={label + " " + r.name}
                onClick={() => updateItems(following ? ids.filter((id) => id !== r.id) : [...ids, r.id])}
                className="rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
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
        return race ? (
          <ResultCard key={id} race={race} />
        ) : (
          <p key={id} role="status" className="text-sm text-fg-2">
            Waiting for results for {choices.data?.find((r) => r.id === id)?.name ?? "your followed race"}.
          </p>
        );
      })}
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
