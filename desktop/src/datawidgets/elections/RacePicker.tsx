import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../../api/client";
import { electionPreviewPath } from "../../config";
import { PAGE_SIZE, checkedDate, emptySearch, evidenceLabel, localOfficialResults, offices } from "./discovery";
import SourceLink from "./SourceLink";
import { stateNames } from "./states";
import type { ElectionCoverage, ElectionSearch } from "../../types/api.generated";

const field = "rounded-md border border-edge bg-surface px-3 py-2 text-sm text-fg";

export default function RacePicker({
  ids,
  enabled,
  saving,
  onFollow,
}: {
  ids: number[];
  enabled: boolean;
  saving: boolean;
  onFollow: (id: number) => void;
}) {
  const [state, setState] = useState("");
  const [office, setOffice] = useState("");
  const [activity, setActivity] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (input.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [input, query]);
  const path = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (state) path.set("state", state);
  if (office) path.set("office", office);
  if (query) path.set("q", query);
  if (activity) path.set("activity", activity);
  const choices = useQuery({
    queryKey: ["elections", "search", path.toString()],
    queryFn: ({ signal }) =>
      authFetch<ElectionSearch>(electionPreviewPath("/elections/search?" + path), { signal }),
    enabled,
    staleTime: 60_000,
  });
  const coverage = useQuery({
    queryKey: ["elections", "coverage"],
    queryFn: ({ signal }) => authFetch<ElectionCoverage>(electionPreviewPath("/elections/coverage"), { signal }),
    enabled,
    staleTime: 300_000,
  });
  const changing = input.trim() !== query;
  const results = changing ? undefined : choices.data;
  useEffect(() => {
    if (results && page > 0 && page * PAGE_SIZE >= results.total) setPage(Math.max(0, Math.ceil(results.total / PAGE_SIZE) - 1));
  }, [results, page]);
  const checked = checkedDate(coverage.data?.checked_at);
  const stateCoverage = coverage.data?.states.find((s) => s.state === state);
  const official = results?.total === 0 ? localOfficialResults(state, office, activity) : null;
  const atLimit = ids.length >= 12;
  return (
    <section
      id="race-picker"
      className="space-y-3 rounded-lg border border-edge bg-surface p-4"
      aria-label="Find races"
    >
      <header>
        <h2 className="text-base font-semibold">Find races</h2>
        <p className="mt-1 text-sm text-fg-2">
          Browse by state and office. Local races with observed vote changes or reported votes appear first.
        </p>
      </header>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-fg-2">
          State
          <select
            className={field}
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All states and DC</option>
            {Object.entries(stateNames).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-fg-2">
          Office
          <select
            className={field}
            value={office}
            onChange={(e) => {
              setOffice(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All offices</option>
            {Object.entries(offices).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-fg-2">
          Vote activity
          <select
            className={field}
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Any activity</option>
            <option value="votes_reported">Reported votes</option>
            <option value="changed">Observed count changes</option>
          </select>
        </label>
      </div>
      <input
        aria-label="Search supported races"
        placeholder="Search by city or race name"
        type="search"
        maxLength={100}
        className={field + " w-full"}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <p className="text-xs text-fg-3">
        {checked ? "Directory checked " + checked : "Directory check time unavailable"}
        {stateCoverage?.status === "listed" &&
          " · " + stateCoverage.race_count.toLocaleString() + " listed in " + stateNames[state]}
      </p>
      {choices.isError && (
        <p role="alert" className="text-sm text-warning">
          Couldn’t refresh the race directory.{" "}
          <button type="button" onClick={() => void choices.refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
      {coverage.isError && (
        <p className="text-xs text-warning">
          State coverage could not be refreshed.{" "}
          <button type="button" onClick={() => void coverage.refetch()} className="underline">
            Retry coverage
          </button>
        </p>
      )}
      {!results && !choices.isError && (
        <p role="status" className="text-sm text-fg-2">
          Loading supported races…
        </p>
      )}
      {results?.total === 0 && (
        <p role="status" className="text-sm text-fg-2">
          {emptySearch(state, coverage.data)}
        </p>
      )}
      {official && (
        <p className="text-xs text-fg-2">
          Local coverage is partial.{" "}
          <SourceLink href={official.url}>{official.name}</SourceLink>
        </p>
      )}
      {results && results.total > 0 && (
        <>
          <ul className="divide-y divide-edge">
            {results.races.slice(0, PAGE_SIZE).map((r) => {
              const following = ids.includes(r.id);
              const geography = [r.municipality, stateNames[r.state] ?? r.state].filter(Boolean).join(", ");
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <strong className="text-sm">{r.name}</strong>
                    <p className="text-xs text-fg-3">
                      {geography} · {r.office_label || "Office unspecified"} · {r.election_date}
                    </p>
                    <p
                      className={
                        r.changed_at || r.vote_status === "votes_reported"
                          ? "text-xs font-semibold text-primary"
                          : "text-xs text-fg-2"
                      }
                    >
                      {evidenceLabel(r)}
                    </p>
                  </div>
                  {following ? (
                    <span className="shrink-0 text-xs font-semibold text-fg-3">Following</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={"Follow " + r.name}
                      disabled={saving || !enabled || atLimit}
                      onClick={() => onFollow(r.id)}
                      className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
                    >
                      Follow
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 text-xs text-fg-2">
            <span role="status">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, results.total)} of{" "}
              {results.total.toLocaleString()} races
            </span>
            {results.total > PAGE_SIZE && (
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={page === 0}
                  className="underline disabled:opacity-40"
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={(page + 1) * PAGE_SIZE >= results.total}
                  className="underline disabled:opacity-40"
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {atLimit && (
        <p className="text-xs text-fg-2">You’re following 12 races. Unfollow one to add another.</p>
      )}
    </section>
  );
}
