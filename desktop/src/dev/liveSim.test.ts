import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game } from "../types";
import fixture from "./__fixtures__/dashboard.pages.json";
import { tickDashboard } from "./liveSim";

describe("tickDashboard", () => {
  it("changes a live score and the clocks, moves prices, keeps every row", () => {
    const d = fixture as unknown as DashboardResponse;
    const next = tickDashboard(d, 0);
    const before = d.data.sports as Game[];
    const after = next.data.sports as Game[];
    expect(after.map((g) => g.id)).toEqual(before.map((g) => g.id));
    expect(after.filter((g, i) => g.away_team_score !== before[i].away_team_score).length).toBe(1);
    expect(after.some((g, i) => g.timer !== before[i].timer)).toBe(true);
    expect(next.data.finance!.some((t, i) => t.price !== d.data.finance![i].price)).toBe(true);
  });
});
