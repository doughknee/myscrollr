import { useMemo } from "react";
import { clsx } from "clsx";
import { GameItem } from "./GameItem";
import { isLive } from "../../utils/gameHelpers";
import { selectSportsForFeed } from "./view";
import type { Game, FeedMode } from "../../types";
import type { SportsDisplayPrefs } from "../../hooks/useSportsConfig";

interface ScoresTabProps {
  games: Game[];
  mode: FeedMode;
  display: SportsDisplayPrefs;
  favoriteTeams: Set<string>;
  showLeagueHeaders: boolean;
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
    return (
      <div className="flex items-center justify-center py-12 text-fg-3 text-xs">
        No games to show
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
