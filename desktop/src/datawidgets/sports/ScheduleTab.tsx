import { useMemo } from "react";
import { clsx } from "clsx";
import { CalendarOff } from "lucide-react";
import { FEED_CARD, FEED_CARD_STATIC } from "../../components/feedCard";
import TeamLogo from "../../components/TeamLogo";
import { isPre, formatCountdown, displayTeamCode } from "../../utils/gameHelpers";
import type { Game } from "../../types";

interface ScheduleTabProps {
  games: Game[];
  favoriteTeams: Set<string>;
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gameDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (gameDay.getTime() - today.getTime()) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatLocalTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isFavoriteGame(game: Game, favorites: Set<string>): boolean {
  return favorites.has(game.home_team_name) || favorites.has(game.away_team_name);
}

export function ScheduleTab({
  games,
  favoriteTeams,
}: ScheduleTabProps) {
  const upcoming = useMemo(() => {
    return games
      .filter(isPre)
      .sort((a, b) => {
        // Favorites first
        const aFav = isFavoriteGame(a, favoriteTeams) ? 1 : 0;
        const bFav = isFavoriteGame(b, favoriteTeams) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
      });
  }, [games, favoriteTeams]);

  const grouped = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of upcoming) {
      const label = dateLabel(g.start_time);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(g);
    }
    return Array.from(map.entries());
  }, [upcoming]);

  if (upcoming.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CalendarOff size={28} className="text-fg-3" />
        <p className="text-fg-3 text-xs">No upcoming games scheduled</p>
      </div>
    );
  }

  return (
    <div>
      {grouped.map(([label, dateGames]) => (
        <div key={label}>
          <div className="px-3 py-1.5 bg-surface-hover border-b border-edge/30">
            <span className="text-[10px] font-bold uppercase tracking-wider text-fg-3">
              {label}
            </span>
            <span className="text-[10px] text-fg-3 ml-2">
              {dateGames.length} {dateGames.length === 1 ? "game" : "games"}
            </span>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {dateGames.map((g) => {
              const favorite = isFavoriteGame(g, favoriteTeams);
              return (
                <div
                  key={String(g.id)}
                  className={clsx(
                    FEED_CARD,
                    FEED_CARD_STATIC,
                    "flex items-center justify-between text-xs",
                    favorite && "border-l-2 border-l-[#f97316]/30",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TeamLogo src={g.away_team_logo} alt={g.away_team_name} size="md" />
                    <span className="font-mono font-bold text-fg-2">
                      {displayTeamCode(g.away_team_code, g.away_team_name)}
                    </span>
                    <span className="text-fg-3 mx-1">@</span>
                    <span className="font-mono font-bold text-fg-2">
                      {displayTeamCode(g.home_team_code, g.home_team_name)}
                    </span>
                    <TeamLogo src={g.home_team_logo} alt={g.home_team_name} size="md" />
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-fg-2 font-mono text-[10px]">
                      {formatLocalTime(g.start_time)}
                      <span className="text-fg-3 ml-1.5">
                        · {formatCountdown(g.start_time)}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-fg-3 text-[9px] uppercase tracking-wider">
                        {g.league}
                      </span>
                      {g.venue && (
                        <span className="text-fg-3 text-[9px] truncate max-w-[120px]" title={g.venue}>
                          · {g.venue}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
