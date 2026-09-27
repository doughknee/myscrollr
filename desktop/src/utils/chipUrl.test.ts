import { describe, it, expect } from "vitest";
import {
  chipUrlForFinance,
  chipUrlForSports,
  chipUrlForRss,
} from "./chipUrl";

describe("chipUrlForFinance", () => {
  it("returns the trade.link when populated", () => {
    expect(chipUrlForFinance({ link: "https://www.google.com/finance/quote/AAPL:NASDAQ" } as never)).toBe(
      "https://www.google.com/finance/quote/AAPL:NASDAQ",
    );
  });

  it("returns undefined when link is empty", () => {
    expect(chipUrlForFinance({ link: "" } as never)).toBeUndefined();
  });

  it("returns undefined when link is missing", () => {
    expect(chipUrlForFinance({} as never)).toBeUndefined();
  });
});

describe("chipUrlForSports", () => {
  it("returns the game.link when populated", () => {
    expect(chipUrlForSports({ link: "https://www.espn.com/nfl/game/_/gameId/123" } as never)).toBe(
      "https://www.espn.com/nfl/game/_/gameId/123",
    );
  });

  // ── New: fallback URL construction when game.link is empty/null ──
  // api-sports.io doesn't supply per-game URLs, so the helper has to
  // build something useful from league + sport + team names.

  it("returns ESPN scoreboard for known NFL sport key when link is empty", () => {
    expect(chipUrlForSports({
      link: "",
      sport: "nfl",
      league: "NFL",
      home_team_name: "Chiefs",
      away_team_name: "Bills",
    } as never)).toBe(
      "https://www.espn.com/nfl/scoreboard",
    );
  });

  it("returns Formula 1 official results page for F1 league", () => {
    expect(chipUrlForSports({
      link: "",
      sport: "",
      league: "Formula 1",
      home_team_name: "Las Vegas Grand Prix",
      away_team_name: "",
    } as never)).toBe(
      "https://www.formula1.com/en/results.html",
    );
  });

  it("returns Premier League results page for EPL league", () => {
    expect(chipUrlForSports({
      link: "",
      league: "Premier League",
      home_team_name: "Arsenal",
      away_team_name: "Chelsea",
    } as never)).toBe(
      "https://www.premierleague.com/results",
    );
  });

  it("falls back to Google search of teams + league when nothing else matches", () => {
    expect(chipUrlForSports({
      link: "",
      sport: "",
      league: "Some Niche League",
      home_team_name: "Team A",
      away_team_name: "Team B",
    } as never)).toMatch(
      /^https:\/\/www\.google\.com\/search\?q=Team%20A%20vs%20Team%20B%20Some%20Niche%20League/,
    );
  });

  it("returns undefined when link is empty AND no league/team info", () => {
    expect(chipUrlForSports({ link: "" } as never)).toBeUndefined();
  });
});

describe("chipUrlForRss", () => {
  it("returns the item.link when populated", () => {
    expect(chipUrlForRss({ link: "https://example.com/article/1" } as never)).toBe(
      "https://example.com/article/1",
    );
  });

  it("returns undefined when link is empty", () => {
    expect(chipUrlForRss({ link: "" } as never)).toBeUndefined();
  });
});
