/**
 * The game cell: nickname when narrow, records beneath, clock on the right,
 * and every part that holds a changing value reserves its width in every
 * state (pre / live one-digit / live two-digit / final). Real layout is
 * measured by e2e/ticker/cells.spec.ts; here the reservations themselves.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GameCell, { cellName, gameMinCol, statusLines, STATUS_WIDTH } from "./GameCell";
import type { Game, TeamStanding } from "../../../types";

const NOW = Date.parse("2026-10-04T18:40:00Z");
const NYJ: TeamStanding = { rank: 3, wins: 1, losses: 2, draws: 0, points: 0, goal_diff: 0, points_for: 60, points_against: 71, otl: 0 };
const CHI: TeamStanding = { rank: 2, wins: 2, losses: 1, draws: 0, points: 0, goal_diff: 0, points_for: 70, points_against: 61, otl: 0 };

function game(over: Partial<Game> = {}): Game {
  return {
    id: 7, league: "NFL", sport: "american-football", external_game_id: "x", link: "",
    away_team_name: "New York Jets", away_team_logo: "", away_team_score: 24, away_team_code: "",
    home_team_name: "Chicago Bears", home_team_logo: "", home_team_score: 20, home_team_code: "",
    start_time: new Date(NOW - 3 * 3_600_000).toISOString(),
    state: "in", status_short: "Q4", timer: "2:14", venue: "Soldier Field",
    away_standing: NYJ, home_standing: CHI,
    ...over,
  };
}

const STATES: [string, Game][] = [
  ["pre", game({ state: "pre", status_short: "NS", timer: "", away_team_score: "", home_team_score: "", start_time: new Date(NOW + 5_400_000).toISOString() })],
  ["live, one digit", game({ status_short: "Q1", timer: "9:12", away_team_score: 7, home_team_score: 3 })],
  ["live, two digits", game({ status_short: "Q4", timer: "12:59", away_team_score: 24, home_team_score: 20 })],
  ["final", game({ state: "final", status_short: "FT", timer: "", away_team_score: 31, home_team_score: 28 })],
];

/** Everything that decides where a part sits: which parts exist, and their reservations. */
function skeleton(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-part]")].map((el) => ({
    part: el.dataset.part,
    minWidth: el.style.minWidth,
    width: el.style.width,
  }));
}

describe("cellName", () => {
  it("shows the nickname in a narrow US-pro cell, the short name when roomy", () => {
    expect(cellName("NFL", "New York Jets", false)).toBe("Jets");
    expect(cellName("MLB", "Boston Red Sox", false)).toBe("Red Sox");
    expect(cellName("NFL", "New York Jets", true)).toBe("New York Jets");
  });

  it("keeps the city where the city is the identity", () => {
    expect(cellName("Premier League", "Manchester City", false)).toBe("Manchester City");
  });

  it("a city or college name asks for a wider column than a nickname", () => {
    expect(gameMinCol("NFL")).toBe(212);
    expect(gameMinCol("NCAA Football")).toBe(244);
  });
});

describe("statusLines", () => {
  it("live: period over clock; baseball: the inning over INN", () => {
    expect(statusLines(game())).toEqual(["Q4", "2:14"]);
    expect(statusLines(game({ league: "MLB", status_short: "IN7", timer: "" }))).toEqual(["7th", "INN"]);
  });

  it("final and postponed say so and nothing else", () => {
    expect(statusLines(game({ state: "final" }))).toEqual(["FINAL", ""]);
    expect(statusLines(game({ state: "postponed" }))).toEqual(["PPD", ""]);
  });

  it("today's kick-off counts down; a later day shows its weekday", () => {
    const [time, inN] = statusLines(STATES[0][1], NOW);
    expect(time).toMatch(/\d/);
    expect(inN).toBe("in 1h30");
    const [day] = statusLines(game({ state: "pre", start_time: new Date(NOW + 3 * 86_400_000).toISOString() }), NOW);
    expect(day).toMatch(/^[A-Z]{2,}/);
  });
});

describe("GameCell", () => {
  it("narrow: nicknames, both scores, the table line beneath", () => {
    const { getByText } = render(<GameCell game={game()} width={240} now={NOW} />);
    expect(getByText("Jets")).toBeTruthy();
    expect(getByText("Bears")).toBeTruthy();
    expect(getByText("24")).toBeTruthy();
    expect(getByText(/1-2\s+·\s+2-1/)).toBeTruthy();
  });

  it("before kick-off: no score digits, the venue beneath", () => {
    const { container, getByText } = render(<GameCell game={STATES[0][1]} width={240} now={NOW} />);
    expect(container.querySelector('[data-part="away-score"]')!.textContent).toBe("");
    expect(getByText("Soldier Field")).toBeTruthy();
  });

  it("wide: one scoreboard line with full short names", () => {
    const { getByText } = render(<GameCell game={game()} width={460} now={NOW} />);
    expect(getByText("New York Jets")).toBeTruthy();
    expect(getByText("Chicago Bears")).toBeTruthy();
  });

  it("the live dot is always mounted, invisible unless live", () => {
    const dot = (g: Game) => render(<GameCell game={g} width={240} now={NOW} />).container.querySelector('[data-part="live-dot"]')!;
    expect(dot(STATES[1][1]).classList.contains("invisible")).toBe(false);
    expect(dot(STATES[3][1]).classList.contains("invisible")).toBe(true);
  });

  it("your team carries the accent line; others keep it transparent", () => {
    const line = (mine: boolean) =>
      (render(<GameCell game={game()} width={240} mine={mine} now={NOW} />).container.querySelector('[data-part="mine"]') as HTMLElement).style.background;
    expect(line(true)).toBe("var(--accent)");
    expect(line(false)).toBe("transparent");
  });

  it.each([240, 460])("width-stable at %ipx: every state reserves the same widths", (width) => {
    const skeletons = STATES.map(([, g]) => skeleton(render(<GameCell game={g} width={width} now={NOW} />).container));
    for (const s of skeletons.slice(1)) expect(s).toEqual(skeletons[0]);
    const byPart = Object.fromEntries(skeletons[0].map((p) => [p.part, p]));
    expect(byPart["away-score"].minWidth).toBe("2ch");
    expect(byPart["home-score"].minWidth).toBe("2ch");
    expect(byPart.status.width).toBe(STATUS_WIDTH);
  });

  it("a league that reaches 100 reserves three characters", () => {
    const { container } = render(<GameCell game={game({ league: "NBA", away_team_score: 9, home_team_score: 101 })} width={240} now={NOW} />);
    expect((container.querySelector('[data-part="away-score"]') as HTMLElement).style.minWidth).toBe("3ch");
  });
});
