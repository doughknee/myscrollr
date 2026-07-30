/**
 * Fantasy — Home preview.
 *
 * The only source needing all three optional hooks: its payload is wrapped
 * (`{ leagues: [...] }`), and its group keys are opaque league ids that have
 * to be labelled by name.
 */
import { HOME_PREVIEW_MAX, HomeEmptyRow } from "../home";
import type { HomeRowsProps } from "../../types";

/** A league row as the dashboard sends it — deliberately loose; Home only
 *  reads the handful of fields below and the shape varies by sport. */
type LeagueRow = Record<string, unknown>;

/**
 * Fantasy wraps its rows: `{ leagues: [...] }`, not a bare array. Every other
 * Fantasy consumer (ticker, FeedTab, player picker) already unwraps it; Home
 * once treated the payload as flat and showed "No leagues imported yet" to
 * users who had leagues.
 */
export function normalizeFantasyHome(raw: unknown): unknown[] {
  const obj = raw as { leagues?: unknown } | undefined;
  return Array.isArray(obj?.leagues) ? (obj.leagues as unknown[]) : [];
}

export function FantasyHomeRows({ data, onConfigure }: HomeRowsProps) {
  const leagues = data as LeagueRow[];
  const empty = (
    <HomeEmptyRow
      message="No leagues imported yet"
      openLabel="Fantasy"
      onConfigure={onConfigure}
    />
  );
  if (leagues.length === 0) return empty;

  // Rank like every other source: leagues worth a glance first. One with
  // a live matchup beats one without, and among those a tight margin
  // beats a blowout.
  const margin = (l: LeagueRow): number | null => {
    const mine = l.my_score ?? l.team_points;
    const theirs = l.opp_score ?? l.opponent_points;
    if (mine == null || theirs == null) return null;
    const diff = Math.abs(Number(mine) - Number(theirs));
    return Number.isFinite(diff) ? diff : null;
  };

  const preview = [...leagues]
    .sort((a, b) => {
      const am = margin(a);
      const bm = margin(b);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm;
    })
    .slice(0, HOME_PREVIEW_MAX);
  if (preview.length === 0) return empty;

  return (
    <>
      {preview.map((league, i) => {
        const name = (league.league_name ?? league.name ?? "League") as string;
        const myScore = league.my_score ?? league.team_points;
        const oppScore = league.opp_score ?? league.opponent_points;
        const hasMatchup = myScore != null && oppScore != null;

        return (
          <div key={i} className="flex items-center px-4 py-2.5 gap-3">
            <span className="text-ui-meta text-fg flex-1 truncate">{name}</span>
            {hasMatchup && (
              <span className="text-xs text-fg-3 tabular-nums">
                {String(myScore)} – {String(oppScore)}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
