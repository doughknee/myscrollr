import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectedView } from "./ConnectedView";
import { loadPrefs } from "../../preferences";
import type { LeagueResponse } from "./types";

vi.mock("../../lib/store", () => ({
  getStore: vi.fn((_key: string, fallback: unknown) => fallback),
  setStore: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../shell-context", () => ({
  useShell: () => ({ prefs: loadPrefs(), onPrefsChange: vi.fn() }),
}));

function league(): LeagueResponse {
  return {
    league_key: "449.l.1",
    name: "Test League",
    game_code: "nfl",
    season: "2025",
    team_key: "449.l.1.t.4",
    team_name: "Mine",
    data: { num_teams: 8, is_finished: false, current_week: 12, scoring_type: "head" },
    standings: null,
    matchups: [],
    rosters: null,
  } as LeagueResponse;
}

describe("ConnectedView ticker section", () => {
  it("offers the one dial and no per-item toggles (REL-208)", () => {
    render(
      <ConnectedView
        leagues={[league()]}
        yahooConnected
        hex="#6366f1"
        noLeaguesFound={false}
        onStartDiscovery={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByText("What shows on the ticker")).toBeTruthy();
    for (const label of ["Essential", "Standard", "Everything"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The preview is the real ticker source's output: one league chip.
    expect(screen.getByText(/^1 chip ·/)).toBeTruthy();

    expect(screen.queryByText(/Advanced/)).toBeNull();
    for (const gone of [
      "Matchup score",
      "Win probability",
      "Projected points",
      "Top 3 scorers",
      "Worst starter",
      "Injury report",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });
});
