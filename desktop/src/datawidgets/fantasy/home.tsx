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

/** Group key for one league: id first, falling back to whatever names it. */
function leagueKey(l: LeagueRow): string {
  return String(l.league_key ?? l.league_name ?? l.name ?? "");
}

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

export function fantasyHomeGroups(rows: unknown[]): string[] {
  return [...new Set((rows as LeagueRow[]).map(leagueKey).filter(Boolean))];
}

/** Chips key on the league id but must read as its name. */
export function fantasyHomeGroupLabel(key: string, rows: unknown[]): string {
  const league = (rows as LeagueRow[]).find(
    (l) => String(l.league_key ?? "") === key || String(l.league_name ?? "") === key,
  );
  return league ? String(league.league_name ?? league.name ?? key) : key;
}

export function FantasyHomeRows({ data, filter, onConfigure }: HomeRowsProps) {
  const leagues = data as LeagueRow[];
  const empty = (
    <HomeEmptyRow
      message="No leagues imported yet"
      openLabel="Fantasy"
      onConfigure={onConfigure}
    />
  );
  if (leagues.length === 0) return empty;

  const filtered =
    filter.length > 0
      ? leagues.filter((l) => filter.includes(leagueKey(l)))
      : leagues;

  const preview = filtered.slice(0, HOME_PREVIEW_MAX);
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
