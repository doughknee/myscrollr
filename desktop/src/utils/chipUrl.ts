/**
 * URL builders for ticker chip clicks. The handler in `App.tsx` routes
 * a click to the OS shell when these helpers return a string, and
 * falls back to opening the desktop app's main window otherwise.
 *
 * Sports games arrive from api-sports.io with `link = NULL`. The
 * upstream API does not provide canonical per-game URLs; we have to
 * construct a sensible target from `league` + `sport` + team names.
 */

import type { Trade, Game, RssItem } from "../types";

export function chipUrlForFinance(trade: Trade): string | undefined {
  return trade.link && trade.link.length > 0 ? trade.link : undefined;
}

/**
 * Map a sport key to ESPN's URL slug for that sport's scoreboard page.
 * api-sports.io's `sport` field uses lowercase short names; ESPN uses
 * a similar but not-identical convention.
 */
const ESPN_SCOREBOARD_PATH: Record<string, string> = {
  nfl: "nfl",
  nba: "nba",
  mlb: "mlb",
  nhl: "nhl",
  wnba: "wnba",
  mls: "soccer/league/_/name/usa.1",
  // football, basketball, baseball, hockey: already covered by the
  // specific league-name branches below; this map is for sport keys
  // api-sports actually emits.
};

/**
 * Build a chip-click URL for a sports game.
 *
 * Priority order:
 *   1. Server-supplied `link` (rare today — most leagues have NULL).
 *   2. League-specific scoreboard for known leagues (F1, EPL, etc.).
 *   3. ESPN scoreboard for known sport keys.
 *   4. Google search of "{home} vs {away} {league}" — always lands the
 *      user somewhere useful (Google's sports widget for popular games).
 *   5. undefined — caller falls through to opening the desktop app.
 */
export function chipUrlForSports(game: Game): string | undefined {
  if (game.link && game.link.length > 0) return game.link;

  const sport = (game.sport || "").toLowerCase();
  const league = (game.league || "").toLowerCase();

  // ── League-specific destinations ──────────────────────────────
  // Order matters: more specific names checked before generic.
  if (league.includes("formula 1") || league === "f1" || league.includes("formula1")) {
    return "https://www.formula1.com/en/results.html";
  }
  if (league.includes("premier league")) {
    return "https://www.premierleague.com/results";
  }
  if (league.includes("champions league")) {
    return "https://www.uefa.com/uefachampionsleague/fixtures-results/";
  }
  if (league.includes("la liga") || league.includes("laliga")) {
    return "https://www.laliga.com/en-GB/laliga-easports/results";
  }
  if (league.includes("bundesliga")) {
    return "https://www.bundesliga.com/en/bundesliga/matchday";
  }
  if (league.includes("serie a")) {
    return "https://www.legaseriea.it/en/serie-a/calendar-results";
  }
  if (league.includes("ligue 1")) {
    return "https://www.ligue1.com/results";
  }
  if (league.includes("mls")) {
    return "https://www.mlssoccer.com/scoreboard/";
  }

  // ── ESPN scoreboard by sport key ──────────────────────────────
  if (sport && ESPN_SCOREBOARD_PATH[sport]) {
    return `https://www.espn.com/${ESPN_SCOREBOARD_PATH[sport]}/scoreboard`;
  }

  // ── Google search fallback ────────────────────────────────────
  // Always reasonable: Google's sports widget shows scores at the top
  // of results for any well-known matchup.
  if (game.home_team_name && game.away_team_name) {
    const q = [
      game.home_team_name,
      "vs",
      game.away_team_name,
      game.league || "",
    ].filter(Boolean).join(" ").trim();
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }

  return undefined;
}

export function chipUrlForRss(item: RssItem): string | undefined {
  return item.link && item.link.length > 0 ? item.link : undefined;
}
