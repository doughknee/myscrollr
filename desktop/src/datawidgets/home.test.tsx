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
    <HomeRows data={data} dashboard={dashboard} onConfigure={() => {}} />,
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

  // The empty state is the path REL-63 changed most: it used to come from an
  // EMPTY_HINTS map in feed.tsx that could silently miss an entry, quietly
  // dropping that widget's call to action. Every source now owns its own copy.
  it.each([
    ["finance", /no stocks/i],
    ["rss", /no feeds/i],
  ])("%s shows a specific empty state", (source, pattern) => {
    rows(source, []);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });
});
