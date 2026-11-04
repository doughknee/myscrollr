import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ElectionCell from "../../components/pages/cells/ElectionCell";
import ElectionChip from "../../components/chips/ElectionChip";
import { describe, expect, it } from "vitest";
import { followedRaceIds, raceView } from "./view";
import { scopeSourceData } from "../../utils/widgetScope";
import { electionsTickerSource } from "./ticker";
import type { ElectionRace } from "./view";
import type { DashboardResponse } from "../../types";

const race: ElectionRace = {
  id: 87476,
  name: "Tennessee Governor",
  state: "TN",
  election_date: "2026-11-03",
  source_updated_at: "2026-11-04T02:06:00Z",
  delayed: false,
  disputed: false,
  percent_reporting: 29,
  candidates: [
    { id: 1, name: "Blackburn", votes: 1000, percent: 40, party: "R", winner: false },
    { id: 2, name: "Green", votes: 1250, percent: 50, party: "D", winner: false },
    { id: 3, name: "Other", votes: 250, percent: 10, party: "I", winner: false },
  ],
};

describe("election results", () => {
  it("ranks all candidates by votes, keeping the source timestamp and reporting independent", () => {
    const v = raceView(race);
    expect(v.headline).toBe("Green leads by 250 votes");
    expect(v.candidates.map((c) => c.id)).toEqual([2, 1, 3]);
    expect(v.reporting).toBe("29% reporting");
    expect(race.candidates[0].id).toBe(1);
    const late = raceView({ ...race, delayed: true, percent_reporting: null });
    expect(late.updated).toBe(v.updated);
    expect(late.reporting).toBe("Reporting unavailable");
  });
  it("distinguishes a tie, pending votes, an explicit call, and a disputed result", () => {
    const tied = race.candidates.map((c) => ({ ...c, votes: 100 }));
    expect(raceView({ ...race, candidates: tied, percent_reporting: 100 }).headline).toBe(
      "Tied for the lead",
    );
    expect(raceView({ ...race, candidates: tied.map((c) => ({ ...c, votes: 0 })) }).headline).toBe(
      "Awaiting votes",
    );
    const failedFirstFetch = raceView({
      ...race,
      delayed: true,
      source_updated_at: null,
      candidates: [],
      percent_reporting: null,
    });
    expect(failedFirstFetch.headline).toBe("Waiting for source data");
    expect(failedFirstFetch.reporting).toBe("Reporting unavailable");
    expect(raceView({ ...race, candidates: [], source_updated_at: null }).updated).toBe(
      "No source update yet",
    );
    const candidates = race.candidates.map((c) => ({ ...c, winner: c.id === 1 }));
    expect(raceView({ ...race, candidates }).headline).toBe("civicAPI calls it for Blackburn");
    expect(raceView({ ...race, candidates, disputed: true }).headline).toBe("Result disputed");
    const beforeVotes = candidates.map((c) => ({ ...c, votes: 0 }));
    expect(raceView({ ...race, candidates: beforeVotes }).headline).toBe("civicAPI calls it for Blackburn");
    expect(raceView({ ...race, candidates: candidates.map((c) => ({ ...c, winner: true })) }).headline).toBe(
      "Result disputed",
    );
  });
  it("shows candidate totals without a lead, margin, share or call when the voting format is unverified", () => {
    const council = {
      ...race,
      id: 918,
      result_mode: "counts_only",
      name: "At-large council",
      candidates: race.candidates.map((c) => ({ ...c, winner: true })),
    };
    const view = raceView(council);
    expect(view.headline).toBe("2,500 candidate votes");
    expect(view.reporting).toBeNull();
    expect(view.countsOnly).toBe(true);
    expect(view.candidateTotals).toBe("Green 1,250 votes · Blackburn 1,000 votes");
    expect(view.candidates.map((c) => c.name)).toEqual(["Blackburn", "Green", "Other"]);
    expect(raceView({ ...council, result_mode: undefined }).headline).toBe(view.headline);
    expect(raceView({ ...council, disputed: true }).headline).toBe("Disputed · 2,500 candidate votes");
  });

  it("labels a directory observation even for an otherwise single-seat race", () => {
    const seed = {
      ...race,
      snapshot_kind: "directory",
      result_mode: "single_seat",
      observed_at: "2026-11-04T03:08:00Z",
    };
    for (const component of [ElectionCell, ElectionChip]) {
      const html = renderToStaticMarkup(createElement(component, { race: seed }));
      const title = html.match(/title="([^"]+)"/)?.[1];
      expect(title).toContain("Green 1,250 votes · Blackburn 1,000 votes");
      expect(title).not.toMatch(/Other|leads|winner|% reporting/);
    }
    expect(raceView(seed).headline).toBe("2,500 candidate votes");
    expect(raceView(seed).updated).toMatch(/^Directory snapshot · checked /);
    expect(raceView({ ...seed, observed_at: undefined }).updated).toBe(
      "Directory snapshot · check time unknown",
    );
  });

  it("never scopes an unfollowed race into a user’s feed", () => {
    expect(followedRaceIds({ race_ids: [87476, "2", null, -1] })).toEqual([87476]);
    expect(scopeSourceData("elections", [race], undefined)).toEqual([]);
    expect(scopeSourceData("elections", [race], { race_ids: [] })).toEqual([]);
    expect(scopeSourceData("elections", [race], { race_ids: [race.id] })).toEqual([race]);
  });
  it("refreshes an on-screen count without changing the rotating slot or duplicating a pin", () => {
    const dashboard: DashboardResponse = {
      data: { elections: [race] },
      widgets: [
        {
          id: 1,
          widget_type: "elections",
          enabled: true,
          ticker_enabled: true,
          config: { race_ids: [race.id] },
          created_at: "",
          updated_at: "",
        },
      ],
    };
    const ctx = { tab: "elections", source: "elections", dashboard, rotationMemo: new Map() };
    const [first] = electionsTickerSource.chips([race], ctx);
    const updated = { ...race, percent_reporting: 55 };
    const [next] = electionsTickerSource.chips([updated], ctx);
    expect(next.key).toBe(first.key);
    expect((next.node as { props: { race: ElectionRace } }).props.race).toBe(updated);
    const pinned = { ...ctx, pinnedSubjects: new Set([String(race.id)]), pinnedSubject: String(race.id) };
    expect(electionsTickerSource.chips([updated], pinned)).toEqual([]);
    expect(electionsTickerSource.pinnedChip?.([updated], pinned)?.subject).toBe(String(race.id));
  });
});
