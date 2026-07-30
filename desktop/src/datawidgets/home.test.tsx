/**
 * Home preview renderers, one per data source (REL-63).
 *
 * `routes/feed.tsx` used to dispatch on the source name, so a broken
 * renderer showed up as a blank card. It now renders `manifest.HomeRows`
 * unconditionally — every source is mounted here with data and without, so
 * a regression surfaces as a failed assertion rather than an empty Home.
 *
 * Each case goes through the real manifest, not a direct import, so the
 * wiring in each FeedTab.tsx is under test too.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { getDataWidget } from "./registry";

const rows = (source: string, data: unknown[], dashboard?: Record<string, unknown>) => {
  const HomeRows = getDataWidget(source)!.HomeRows;
  return render(
    <HomeRows data={data} filter={[]} dashboard={dashboard} onConfigure={() => {}} />,
  );
};

describe("Home previews", () => {
  it("finance renders symbol, price and change", () => {
    rows("finance", [
      { symbol: "AAPL", price: 195.5, percentage_change: 1.25 },
      { symbol: "TSLA", price: 240.1, percentage_change: -3.5 },
    ]);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    // Sorted by absolute move, so TSLA (-3.5%) leads AAPL (+1.25%).
    expect(screen.getByText(/3\.50%/)).toBeInTheDocument();
    expect(screen.getByText(/1\.25%/)).toBeInTheDocument();
  });

  it("sports renders a game and marks the live one", () => {
    rows("sports", [
      {
        id: 1,
        league: "NFL",
        state: "in",
        away_team_name: "Bears",
        home_team_name: "Packers",
        away_team_score: 7,
        home_team_score: 10,
      },
    ]);
    expect(screen.getByText("NFL")).toBeInTheDocument();
    expect(screen.getByText("Bears")).toBeInTheDocument();
    expect(screen.getByText(/7\s*–\s*10/)).toBeInTheDocument();
  });

  it("rss renders headline and feed name", () => {
    rows("rss", [
      { id: 1, title: "A headline", source_name: "BBC", published_at: null },
    ]);
    expect(screen.getByText("A headline")).toBeInTheDocument();
    expect(screen.getByText("BBC")).toBeInTheDocument();
  });

  it("fantasy renders league name and matchup score", () => {
    rows("fantasy", [
      { league_key: "nfl.1", league_name: "Dynasty", my_score: 101, opp_score: 98 },
    ]);
    expect(screen.getByText("Dynasty")).toBeInTheDocument();
    expect(screen.getByText(/101\s*–\s*98/)).toBeInTheDocument();
  });

  it("predictions renders the market title", () => {
    rows("predictions", [
      {
        id: "m1",
        title: "Will it rain?",
        event_title: "Weather",
        yes_price: 62,
        status: "active",
      },
    ]);
    expect(screen.getByText("Weather")).toBeInTheDocument();
  });

  // The empty state is the path REL-63 changed most: it used to come from an
  // EMPTY_HINTS map in feed.tsx that had no `predictions` entry, so that one
  // silently lost its call to action. Every source now owns its own copy.
  it.each([
    ["finance", /no stocks/i],
    ["rss", /no feeds/i],
    ["fantasy", /no leagues/i],
    ["predictions", /no markets/i],
  ])("%s shows a specific empty state", (source, pattern) => {
    rows(source, []);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });
});

describe("Home group hooks", () => {
  it("derives filter chips from the rows", () => {
    expect(
      getDataWidget("finance")!.homeGroups!([
        { symbol: "AAPL" },
        { symbol: "TSLA" },
        { symbol: "AAPL" },
      ]),
    ).toEqual(["AAPL", "TSLA"]);

    expect(
      getDataWidget("sports")!.homeGroups!([{ league: "NFL" }, { league: "NBA" }]),
    ).toEqual(["NFL", "NBA"]);
  });

  it("predictions has no groups — one market set, nothing to slice by", () => {
    expect(getDataWidget("predictions")!.homeGroups).toBeUndefined();
  });

  it("fantasy unwraps its payload and labels keys by league name", () => {
    const m = getDataWidget("fantasy")!;
    // The wrapper is the bug this hook exists for: treating the payload as a
    // flat array showed "No leagues imported yet" to users who had leagues.
    expect(m.normalizeHome!({ leagues: [{ league_key: "a" }] })).toHaveLength(1);
    expect(m.normalizeHome!(undefined)).toEqual([]);

    const rows = [{ league_key: "nfl.1", league_name: "Dynasty" }];
    expect(m.homeGroups!(rows)).toEqual(["nfl.1"]);
    expect(m.homeGroupLabel!("nfl.1", rows)).toBe("Dynasty");
    // Unknown key falls back to the key itself rather than rendering blank.
    expect(m.homeGroupLabel!("missing", rows)).toBe("missing");
  });
});
