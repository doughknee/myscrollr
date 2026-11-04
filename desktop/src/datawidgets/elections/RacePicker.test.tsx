import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { authFetch } from "../../api/client";
import RacePicker from "./RacePicker";
import { PAGE_SIZE, emptySearch, evidenceLabel, localOfficialResults } from "./discovery";
import type { RaceDescriptor } from "./view";

vi.mock("../../api/client", () => ({ authFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const checked_at = "2026-11-04T02:05:00Z";
const r: RaceDescriptor = {
  id: 123,
  name: "Example Council",
  state: "TN",
  election_date: "2026-11-03",
  office: "city_council",
  office_label: "City council",
  municipality: "Example",
  result_mode: "counts_only",
  vote_status: "votes_reported",
  checked_at,
  changed_at: null,
};

it("keeps directory, positive vote evidence, and observed vote changes distinct", () => {
  expect(evidenceLabel({ ...r, vote_status: "unknown" })).toBe("Vote totals unverified");
  expect(evidenceLabel({ ...r, vote_status: "unavailable" })).toMatch(/^Vote check unavailable/);
  expect(evidenceLabel({ ...r, vote_status: "awaiting_votes" })).toMatch(/^No votes at last check/);
  expect(evidenceLabel(r)).toMatch(/^Votes reported · /);
  expect(evidenceLabel({ ...r, changed_at: checked_at })).toMatch(/^Vote count change observed · /);
  expect(
    emptySearch("TN", { checked_at, states: [{ state: "TN", status: "no_listed_races", race_count: 0 }] }),
  ).toMatch(/listed no supported races for Tennessee/);
  expect(
    emptySearch("TN", { checked_at, states: [{ state: "TN", status: "unavailable", race_count: 0 }] }),
  ).toMatch(/could not be verified/);
  expect(emptySearch("TN")).toMatch(/unverified/);
  expect(localOfficialResults("TN", "mayor", "")?.name).toContain("Montgomery County");
  expect(localOfficialResults("NC", "city_council", "votes_reported")?.url).toMatch(/^https:\/\/www\.ncsbe\.gov\//);
  expect(localOfficialResults("NC", "city_council", "")).toBeNull();
  expect(localOfficialResults("NC", "governor", "changed")).toBeNull();
});

it("browses all states through bounded pages and passes the combined filters to core", async () => {
  vi.stubGlobal("__APP_VERSION__", "1.8.0-beta.3");
  vi.mocked(authFetch).mockImplementation(async (path) => {
    if (path.startsWith("/elections/coverage"))
      return { checked_at, states: [{ state: "TN", status: "listed", race_count: 13 }] };
    const offset = Number(new URL(path, "http://localhost").searchParams.get("offset") ?? 0);
    return {
      total: 80,
      races: Array.from({ length: 25 }, (_, i) => ({
        ...r,
        id: i + offset + 1,
        name: "Council " + (offset + i + 1),
      })),
    };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const follow = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RacePicker ids={[]} enabled saving={false} onFollow={follow} />
    </QueryClientProvider>,
  );
  const state = screen.getByLabelText("State");
  expect(within(state).getAllByRole("option")).toHaveLength(52);
  expect(within(state).getByRole("option", { name: "District of Columbia" })).toHaveValue("DC");
  await screen.findByRole("button", { name: "Follow Council 1" });
  expect(screen.getAllByRole("listitem")).toHaveLength(PAGE_SIZE);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("button", { name: "Follow Council 13" });
  fireEvent.change(state, { target: { value: "TN" } });
  fireEvent.change(screen.getByLabelText("Office"), { target: { value: "city_council" } });
  fireEvent.change(screen.getByLabelText("Vote activity"), { target: { value: "changed" } });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Example town" } });
  await waitFor(() =>
    expect(
      vi.mocked(authFetch).mock.calls.some(([path]) => {
        const q = new URL(path, "http://localhost").searchParams;
        return (
          q.get("preview") === "elections-national" &&
          q.get("state") === "TN" &&
          q.get("office") === "city_council" &&
          q.get("activity") === "changed" &&
          q.get("q") === "Example town" &&
          q.get("limit") === "12" &&
          q.get("offset") === "0"
        );
      }),
    ).toBe(true),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Follow Council 1" }));
  expect(follow).toHaveBeenCalledWith(1);
  expect(vi.mocked(authFetch).mock.calls.every(([path]) => !path.startsWith("/elections/races"))).toBe(true);
  client.clear();
});
