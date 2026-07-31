/**
 * Sports — Home preview. Live games first, then upcoming, then finals.
 *
 * The only source that reads a sibling dashboard key: `sports_meta` carries
 * per-league status so the empty state can say *why* a league is quiet
 * (off-season, no games today) instead of just "nothing here". That's what
 * the `dashboard` prop on HomeRowsProps exists for.
 */
import SportsEmptyState from "./EmptyState";
import { HOME_PREVIEW_MAX } from "../home";
import type { LeagueMeta } from "../../api/queries";
import type { HomeRowsProps, Game, HomeHighlight } from "../../types";

export function SportsHomeRows({
  data,
  dashboard,
  onConfigure,
}: HomeRowsProps) {
  const games = data as Game[];
  const meta = (dashboard?.sports_meta as { leagues?: LeagueMeta[] } | undefined)
    ?.leagues;

  const visibleMeta: LeagueMeta[] = meta ?? [];
  const empty = (
    <SportsEmptyState leagues={visibleMeta} onConfigure={onConfigure} />
  );
  if (games.length === 0) return empty;

  // State priority matches the API contract: in > pre > final > postponed.
  // Earlier versions used the legacy "post" state from the ESPN era, which
  // never matched anything api-sports.io produces.
  const priority: Record<string, number> = { in: 0, pre: 1, final: 2, postponed: 3 };
  const sorted = [...games]
    .sort((a, b) => (priority[a.state ?? ""] ?? 4) - (priority[b.state ?? ""] ?? 4))
    .slice(0, HOME_PREVIEW_MAX);

  if (sorted.length === 0) return empty;

  return (
    <>
      {sorted.map((g) => {
        const isLive = g.state === "in";
        return (
          <div key={g.id} className="flex items-center px-4 py-2.5 gap-3">
            {isLive && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <span className="text-[10px] font-mono font-semibold text-fg-4 uppercase w-10 shrink-0 truncate">
              {g.league}
            </span>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {g.away_team_logo && (
                <img
                  src={g.away_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
              <span className="text-ui-meta text-fg-2 truncate">
                {g.away_team_name || g.away_team_code}
              </span>
              <span className="text-xs text-fg-3 tabular-nums shrink-0">
                {g.away_team_score} – {g.home_team_score}
              </span>
              <span className="text-ui-meta text-fg-2 truncate">
                {g.home_team_name || g.home_team_code}
              </span>
              {g.home_team_logo && (
                <img
                  src={g.home_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
            </div>
            <span className="text-[10px] text-fg-4 shrink-0 truncate max-w-24">
              {g.short_detail ?? g.status_short ?? ""}
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * Happening now — the first genuinely live game.
 *
 * "in" is the only state worth interrupting for: a final already
 * happened and an upcoming game has nothing to report yet. Returning
 * null on a quiet slate is the point — Home shows the hero row only
 * when there is something in it, rather than padding it with a
 * scheduled fixture and calling that news.
 */
export function sportsHighlight(data: unknown[]): HomeHighlight | null {
  const games = data as Game[];
  const live = games.find((g) => g.state === "in");
  if (!live) return null;

  const away = live.away_team_name || live.away_team_code || "";
  const home = live.home_team_name || live.home_team_code || "";
  if (!away || !home) return null;

  const headline =
    live.away_team_score != null && live.home_team_score != null
      ? `${away} ${live.away_team_score} – ${live.home_team_score} ${home}`
      : `${away} v ${home}`;

  return {
    headline,
    // Straight from the feed — `short_detail` is the game clock ("71'",
    // "2nd 04:12"), with the status strings as fallbacks. Never phrased
    // by us.
    sub: live.short_detail || live.status_long || live.status_short || "Live",
    live: true,
  };
}
