import { useMemo } from "react";
import { clsx } from "clsx";
import { GameItem } from "./GameItem";
import { isLive } from "../../utils/gameHelpers";
import { selectSportsForFeed } from "./view";
import SportsEmptyState from "./EmptyState";
import type { LeagueMeta } from "../../api/queries";
import type { Game, FeedMode } from "../../types";
import type { SportsDisplayPrefs } from "../../hooks/useSportsConfig";

interface ScoresTabProps {
  games: Game[];
  mode: FeedMode;
  display: SportsDisplayPrefs;
  favoriteTeams: Set<string>;
  showLeagueHeaders: boolean;
  /** Per-league season/polling status, for the empty state. */
  leagueMeta: LeagueMeta[];
}

function isFavoriteGame(game: Game, favorites: Set<string>): boolean {
  return favorites.has(game.home_team_name) || favorites.has(game.away_team_name);
}

export function ScoresTab({
  games,
  mode,
  display,
  favoriteTeams,
  showLeagueHeaders,
  leagueMeta,
}: ScoresTabProps) {
  const ordered = useMemo(
    () => selectSportsForFeed(games, display, favoriteTeams),
    [games, display, favoriteTeams],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of ordered) {
      const league = g.league || "Other";
      if (!map.has(league)) map.set(league, []);
      map.get(league)!.push(g);
    }
    // Sort league groups: those with live games first, then alphabetical
    return Array.from(map.entries()).sort(([aKey, aGames], [bKey, bGames]) => {
      const aHasLive = aGames.some(isLive);
      const bHasLive = bGames.some(isLive);
      if (aHasLive !== bHasLive) return bHasLive ? 1 : -1;
      return aKey.localeCompare(bKey);
    });
  }, [ordered]);

  if (ordered.length === 0) {
    // Two different nothings, and conflating them was the confusing part:
    // the league has no games at all (off-season, or nothing scheduled --
    // SportsEmptyState says which), versus games exist and the user's own
    // time window or favourites-only filter hid every one of them. Only
    // the second is fixed by touching a control, so only the second says so.
    if (games.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-1 text-center">
          <p className="text-xs text-fg-3 font-medium">
            No games in this time window
          </p>
          <p className="text-[11px] text-fg-4">
            {games.length} {games.length === 1 ? "game is" : "games are"} hidden by your filters
          </p>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-12">
        <SportsEmptyState leagues={leagueMeta} />
      </div>
    );
  }

  return (
    <div>
      {grouped.map(([league, leagueGames]) => (
        <div key={league}>
          {showLeagueHeaders && (
            <div className="px-3 py-1.5 bg-surface-hover border-b border-edge/30">
              <span className="text-[10px] font-bold uppercase tracking-wider text-fg-3">
                {league}
              </span>
              <span className="text-[10px] text-fg-3 ml-2">
                {leagueGames.length} {leagueGames.length === 1 ? "game" : "games"}
              </span>
            </div>
          )}
          <div
            className={clsx(
              "grid",
              mode === "compact"
                ? "grid-cols-1 gap-px bg-edge"
                : "grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3",
            )}
          >
            {leagueGames.map((game) => (
              <GameItem
                key={String(game.id)}
                game={game}
                mode={mode}
                isFavorite={isFavoriteGame(game, favoriteTeams)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
