/**
 * The sports chip's contract: compact is the scoreboard row, detailed is
 * the same row plus a table line per team, and every slot that can change
 * holds its width whatever state the game is in.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GameChip from "./GameChip";
import type { Game, TeamStanding } from "../../types";

const PHI: TeamStanding = {
  rank: 2, wins: 78, losses: 61, draws: 0, points: 0, goal_diff: 0,
  points_for: 746, points_against: 610, otl: 0,
};
const DET: TeamStanding = {
  rank: 4, wins: 63, losses: 75, draws: 0, points: 0, goal_diff: 0,
  points_for: 599, points_against: 557, otl: 0,
};

function game(over: Partial<Game> = {}): Game {
  return {
    id: 1,
    league: "MLB",
    sport: "baseball",
    external_game_id: "x",
    link: "",
    away_team_name: "Philadelphia Phillies",
    away_team_logo: "",
    away_team_score: 1,
    away_team_code: "",
    home_team_name: "Detroit Tigers",
    home_team_logo: "",
    home_team_score: 2,
    home_team_code: "",
    start_time: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    state: "final",
    status_short: "FT",
    away_standing: PHI,
    home_standing: DET,
    ...over,
  };
}

describe("GameChip", () => {
  it("names teams by short name, never the three-letter slice", () => {
    render(<GameChip game={game()} comfort />);
    expect(screen.getByText("Phillies")).toBeTruthy();
    expect(screen.getByText("Detroit Tigers")).toBeTruthy(); // 14 chars: untouched
    expect(screen.queryByText("PHI")).toBeNull();
  });

  it("detailed adds each team's table line under that team; compact does not", () => {
    const { unmount } = render(<GameChip game={game()} comfort />);
    expect(screen.getByText("2nd")).toBeTruthy();
    expect(screen.getByText("78-61")).toBeTruthy();
    expect(screen.getByText(/\+136/)).toBeTruthy(); // 746 − 610, run differential
    expect(screen.getByText("4th")).toBeTruthy();
    expect(screen.getByText("63-75")).toBeTruthy();
    unmount();

    render(<GameChip game={game()} />);
    expect(screen.queryByText("78-61")).toBeNull();
    expect(screen.getByText("Phillies")).toBeTruthy();
  });

  it("leaves a pre-game score blank rather than drawing a dash", () => {
    const { container } = render(
      <GameChip
        game={game({ state: "pre", status_short: "NS", start_time: new Date(Date.now() + 3 * 3_600_000).toISOString() })}
      />,
    );
    expect(container.textContent).not.toContain("–");
    expect(container.textContent).not.toContain("-");
    // The slot is still reserved, so kickoff will not move anything.
    const scores = Array.from(container.querySelectorAll("span")).filter(
      (el) => (el as HTMLElement).style.minWidth === "2ch",
    );
    expect(scores.length).toBe(2);
  });

  it("always renders the live dot, invisible unless the game is on", () => {
    const { rerender } = render(<GameChip game={game()} />);
    expect(screen.getByTestId("live-dot").className).toContain("invisible");
    rerender(<GameChip game={game({ state: "in", status_short: "IN7" })} />);
    expect(screen.getByTestId("live-dot").className).not.toContain("invisible");
  });

  it("reserves three score characters for sports that reach 100", () => {
    const { container } = render(
      <GameChip game={game({ league: "NBA", away_team_score: 112, home_team_score: 89, away_standing: undefined, home_standing: undefined })} />,
    );
    const wide = Array.from(container.querySelectorAll("span")).filter(
      (el) => (el as HTMLElement).style.minWidth === "3ch",
    );
    expect(wide.length).toBe(2);
  });

  it("holds the table line's height with a dash when a league has no table", () => {
    const { container } = render(
      <GameChip game={game({ league: "UFC", away_standing: undefined, home_standing: undefined })} comfort />,
    );
    expect(container.textContent?.match(/—/g)?.length).toBe(2);
  });

  it("draws a Formula 1 race as one event, not two blank sides", () => {
    const { container } = render(
      <GameChip
        game={game({
          league: "Formula 1",
          home_team_name: "Italy Grand Prix",
          away_team_name: "Autodromo Nazionale Monza",
          home_team_score: "",
          away_team_score: "",
          state: "pre",
          status_short: "NS",
          away_standing: undefined,
          home_standing: undefined,
        })}
        comfort
      />,
    );
    expect(screen.getByText("Italy Grand Prix")).toBeTruthy();
    expect(screen.getByText("Monza")).toBeTruthy(); // circuit, shortened, beneath
    expect(container.textContent).not.toContain("—"); // no empty-table dashes
    // No score slots reserved: a race has no score.
    const scoreSlots = Array.from(container.querySelectorAll("span")).filter(
      (el) => /ch$/.test((el as HTMLElement).style.minWidth) && (el as HTMLElement).style.minWidth !== "7ch",
    );
    expect(scoreSlots.length).toBe(0);
  });

  it("tints from the league's brand colour in widget mode only", () => {
    const { container, rerender } = render(<GameChip game={game()} accent="#e10600" />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.style.getPropertyValue("--accent")).toBe("#e10600");
    expect(btn.className).toContain("var(--accent)");
    // The other two colour modes are shared palettes and ignore the brand.
    rerender(<GameChip game={game()} accent="#e10600" colorMode="muted" />);
    expect((container.querySelector("button") as HTMLButtonElement).style.getPropertyValue("--accent")).toBe("");
  });

  it("scales the clock to its length without touching the reserved width", () => {
    const { rerender } = render(<GameChip game={game()} />); // final -> "FT"
    const short = screen.getByTestId("status-text");
    expect(short.textContent).toBe("FT");
    expect(short.className).toContain("text-[16px]");
    // The box that holds the width is the parent, still at 7ch.
    expect((short.parentElement as HTMLElement).style.minWidth).toBe("7ch");

    // Twenty days out renders as a date ("Sep 24"): six characters.
    rerender(
      <GameChip
        game={game({ state: "pre", status_short: "NS", start_time: new Date(Date.now() + 20 * 86_400_000).toISOString() })}
      />,
    );
    const long = screen.getByTestId("status-text");
    expect(long.textContent?.length).toBeGreaterThanOrEqual(5);
    expect(long.className).toContain("text-[12px]");
    expect((long.parentElement as HTMLElement).style.minWidth).toBe("7ch");
  });

  it("lets the names give way at the cap, never the status", () => {
    const { container } = render(<GameChip game={game()} />);
    const cls = (container.querySelector("button") as HTMLButtonElement).className;
    // Team tracks can shrink; league and status tracks cannot.
    expect(cls).toContain("grid-cols-[max-content_minmax(0,max-content)_minmax(0,max-content)_max-content]");
    expect(cls).toContain("max-w-[640px]");
    // And the name cells are the ones that carry the ellipsis.
    const names = Array.from(container.querySelectorAll("span")).filter((el) => el.className.includes("truncate"));
    expect(names.length).toBe(2);
  });

  it("gives the name the score's reserved space only once the chip is at the cap", () => {
    // jsdom has no layout; stand in a ResizeObserver that reports a width.
    const real = globalThis.ResizeObserver;
    const withWidth = (w: number) => {
      class RO {
        cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) { this.cb = cb; }
        observe(el: Element) { this.cb([{ contentRect: { width: w } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
        disconnect() {}
        unobserve() {}
      }
      globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
    };
    const scoreMins = (c: HTMLElement) =>
      Array.from(c.querySelectorAll("span"))
        .filter((el) => el.className.includes("tabular-nums") && el.className.includes("text-[15px]"))
        .map((el) => (el as HTMLElement).style.minWidth);
    try {
      withWidth(420);
      const a = render(<GameChip game={game()} />);
      expect(scoreMins(a.container)).toEqual(["2ch", "2ch"]); // off the cap: reserved
      expect((screen.getByTestId("status-text").parentElement as HTMLElement).style.minWidth).toBe("7ch");
      a.unmount();

      withWidth(640);
      const b = render(<GameChip game={game()} />);
      expect(scoreMins(b.container)).toEqual(["", ""]); // at the cap: released
      // The status gives its 7ch back too, and the cells pull their padding in.
      expect((screen.getByTestId("status-text").parentElement as HTMLElement).style.minWidth).toBe("");
      const tight = Array.from(b.container.querySelectorAll("span")).filter((el) => el.classList.contains("px-1.5"));
      expect(tight.length).toBeGreaterThan(0);
      b.unmount();
    } finally {
      globalThis.ResizeObserver = real;
    }
  });

  it("writes a soccer record as W-D-L with points, not a differential", () => {
    render(
      <GameChip
        game={game({
          league: "La Liga",
          away_team_name: "Real Madrid",
          home_team_name: "Valencia",
          away_standing: { rank: 2, wins: 27, draws: 5, losses: 6, points: 86, goal_diff: 42, points_for: 0, points_against: 0, otl: 0 },
          home_standing: { rank: 9, wins: 13, draws: 10, losses: 15, points: 49, goal_diff: -9, points_for: 0, points_against: 0, otl: 0 },
        })}
        comfort
      />,
    );
    expect(screen.getByText("27-5-6")).toBeTruthy();
    expect(screen.getByText(/^86/)).toBeTruthy();
    expect(screen.getAllByText("PTS").length).toBe(2);
  });
});
