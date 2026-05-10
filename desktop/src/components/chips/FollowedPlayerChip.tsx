/**
 * Compact ticker chip representing a single followed Fantasy player.
 *
 * Renders only the data the user actually wants for tracking a
 * specific player live: position badge, last name, real-team abbr,
 * current points, optional injury status. Each followed player gets
 * its own chip — unlike league-summary chips which try to compress
 * many stats into one block, these are atomic and easy to scan in a
 * scrolling ticker.
 *
 * Lookup happens at render time via `findPlayerByKey` walking each
 * league's roster. Players appear on whichever league owns them; if
 * the user follows a player from League A, the chip shows that
 * player's data from League A's roster (which has League A's scoring
 * applied to player_points). Typically a player is in only one of the
 * user's leagues, so this is unambiguous.
 *
 * Returns null when the player_key isn't found in any roster — fresh
 * imports may not have rosters yet, or the followed list could
 * contain a stale key for a player who's been dropped.
 */
import { clsx } from "clsx";
import type { ChipColorMode } from "../../preferences";
import type {
  LeagueResponse,
  RosterPlayer,
} from "../../channels/fantasy/types";
import { getChipColors, chipBaseClasses } from "./chipColors";

/**
 * Why this player is on the rail. Drives a small leading mark before
 * the position pill so the user can scan-distinguish chip purposes:
 *
 *   - `top`     — top-N starter highlight (e.g. top 3 scorers). "↑"
 *   - `worst`   — lowest-scoring starter ("↓", down tone forced)
 *   - `bench`   — sit/start regret: bench player who outscored a
 *                 starter ("BN")
 *   - `injury`  — injury report. The injury status badge already shows
 *                 the player's condition; we just force down tone.
 *
 * When omitted, the chip behaves identically to the legacy
 * "Followed players" mode (user-selected, no contextual lead).
 */
export type FollowedPlayerAccent =
  | "top"
  | "worst"
  | "bench"
  | "injury";

interface FollowedPlayerChipProps {
  /** Yahoo player_key, e.g. "nfl.p.30977". */
  playerKey: string;
  /** All leagues from the dashboard so we can locate this player. */
  leagues: LeagueResponse[];
  /**
   * Optional league_key constraint. When set, the lookup prefers the
   * matching league's roster — important because Yahoo player_keys are
   * global, so the same NFL/MLB player can appear in BOTH of the
   * user's leagues if they own them in each. Without this hint, the
   * chip walks leagues in array order and returns the first match,
   * which produces wrong owner / score / league context. The
   * follower-list chip path doesn't set this (a user-followed player
   * is intentionally context-free), but the per-league player-stat
   * chips emitted by ScrollrTicker always do.
   */
  leagueKey?: string;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /**
   * Optional reason this chip exists on the rail — drives a small
   * leading badge so the user can tell at a glance whether they're
   * looking at "my followed Mahomes" vs "this league's MVP" vs "the
   * worst-scoring starter on my Stanton roster". Omit for a plain
   * Followed-players chip.
   */
  accent?: FollowedPlayerAccent;
  onClick?: () => void;
}

export default function FollowedPlayerChip({
  playerKey,
  leagues,
  leagueKey,
  comfort,
  colorMode = "channel",
  accent,
  onClick,
}: FollowedPlayerChipProps) {
  const found = findPlayerByKey(playerKey, leagues, leagueKey);
  if (!found) return null;

  const { player, leagueName, ownerTeamName } = found;
  const c = getChipColors(colorMode, "fantasy");
  const points = player.player_points;
  const hasPoints = points !== null && points !== undefined;
  const injured = isInjuredStatus(player.status);
  // `accent` overrides the default tone calculation so worst/injury chips
  // feel emphatically down even when the player has positive points.
  const tone: "up" | "down" | "neutral" =
    accent === "worst" || accent === "injury"
      ? "down"
      : accent === "top"
        ? "up"
        : injured
          ? "down"
          : hasPoints && points > 0
            ? "up"
            : "neutral";

  const positionBadge = positionLabel(player.selected_position, player.display_position);
  const teamAbbr = player.editorial_team_abbr || "";
  const last = player.name.last || player.name.full;

  return (
    <button
      type="button"
      onClick={onClick}
      className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
      title={`${player.name.full}${teamAbbr ? ` (${teamAbbr})` : ""}`}
    >
      <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
        {accent && <AccentBadge accent={accent} colorClass={c.textDim} />}
        <span
          className={clsx(
            "inline-flex items-center justify-center px-1 py-0 rounded text-ui-chip font-semibold uppercase tracking-wide tabular-nums",
            "bg-fg-3/15",
            c.textDim,
          )}
        >
          {positionBadge}
        </span>
        <span className={clsx("font-medium truncate max-w-[120px]", c.text)}>
          {last}
        </span>
        {teamAbbr && (
          <span className={clsx("text-ui-chip uppercase tracking-wider", c.textFaint)}>
            {teamAbbr}
          </span>
        )}
        <span
          className={clsx(
            "tabular-nums font-medium",
            tone === "up" && "text-up",
            tone === "down" && "text-down",
            tone === "neutral" && c.textDim,
          )}
        >
          {hasPoints ? points.toFixed(1) : "—"}
        </span>
        {injured && (
          <span
            className={clsx(
              "text-ui-chip font-semibold uppercase tracking-wider px-1 rounded",
              "bg-down/15 text-down",
            )}
          >
            {shortStatus(player.status)}
          </span>
        )}
      </div>
      {comfort && (
        // Bottom row in comfort mode shows owner context — useful when
        // following players from multiple leagues / multiple friends'
        // teams. Format: "OwnerTeam · LeagueName · NFL Team Full Name".
        // The position badge already lives on the top row, so the
        // bottom row's job is "where does this player come from?"
        <div className={clsx("flex items-center gap-1.5 text-ui-chip", c.textFaint)}>
          <span className="truncate max-w-[140px]" title={ownerTeamName}>
            {ownerTeamName}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate max-w-[140px]" title={leagueName}>
            {leagueName}
          </span>
          {player.editorial_team_full_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[140px]">
                {player.editorial_team_full_name}
              </span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

// ── Accent badge ─────────────────────────────────────────────────

const ACCENT_GLYPH: Record<FollowedPlayerAccent, string> = {
  top: "↑",
  worst: "↓",
  bench: "BN",
  injury: "🚨",
};

const ACCENT_TITLE: Record<FollowedPlayerAccent, string> = {
  top: "Top scorer this week",
  worst: "Lowest-scoring starter",
  bench: "Bench player outscoring a starter",
  injury: "Injured / unavailable",
};

function AccentBadge({
  accent,
  colorClass,
}: {
  accent: FollowedPlayerAccent;
  colorClass: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center px-1 py-0 rounded text-ui-chip font-semibold uppercase tracking-wide",
        // Injury accent uses the emoji glyph natively; the rest get the
        // shared chip text-dim color so they read as quiet metadata.
        accent !== "injury" && colorClass,
        accent !== "injury" && "bg-fg-3/15",
      )}
      title={ACCENT_TITLE[accent]}
      aria-label={ACCENT_TITLE[accent]}
    >
      {ACCENT_GLYPH[accent]}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

interface PlayerLookup {
  player: RosterPlayer;
  leagueKey: string;
  leagueName: string;
  /** The fantasy team that has this player on their roster — `roster.data.team_name`. */
  ownerTeamName: string;
}

/** Walk every league's roster looking for the given player_key. When
 *  `preferLeagueKey` is provided, that league is searched first; this
 *  matters because Yahoo player_keys are global — a real player like
 *  "469.p.9590" (Byron Buxton) can sit in BOTH of the user's MLB
 *  leagues with totally different owners, scores, and roster slots
 *  per league. The per-league player-stat chips emitted by
 *  ScrollrTicker always pass `preferLeagueKey` so they show the data
 *  from the league that derived them. The user-followed chip path
 *  doesn't (a followed player is intentionally context-free).
 *
 *  Returns the league context AND the owning fantasy-team name so
 *  callers can surface "this player is on Big Thumps in Stanton
 *  League" in chip comfort mode. */
export function findPlayerByKey(
  playerKey: string,
  leagues: LeagueResponse[],
  preferLeagueKey?: string,
): PlayerLookup | null {
  // Two-pass: when preferLeagueKey is set, search that league first.
  // Falls through to the global walk if the player isn't there (defensive
  // — caller may pass a stale leagueKey if the dashboard is mid-refresh).
  const ordered = preferLeagueKey
    ? [
        ...leagues.filter((l) => l.league_key === preferLeagueKey),
        ...leagues.filter((l) => l.league_key !== preferLeagueKey),
      ]
    : leagues;

  for (const league of ordered) {
    if (!league.rosters) continue;
    for (const roster of league.rosters) {
      for (const player of roster.data.players) {
        if (player.player_key === playerKey) {
          return {
            player,
            leagueKey: league.league_key,
            leagueName: league.name,
            ownerTeamName: roster.data.team_name,
          };
        }
      }
    }
  }
  return null;
}

/** Yahoo `selected_position` strings collapse for ticker display:
 *   - real positions render as-is (QB, RB, WR, TE, K, DST, FLEX)
 *   - bench → "BN", IR/IL pass through (will be drawn dim)
 *   - empty falls back to display_position (player's natural position) */
function positionLabel(selected: string, display: string | undefined): string {
  if (selected) return selected.toUpperCase();
  return (display ?? "?").toUpperCase();
}

/** Match the same logic as FantasyStatChip's isInjured to stay in
 *  visual sync with the league chip's injury detail segment. */
function isInjuredStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  if (s === "" || s === "HEALTHY" || s === "P") return false;
  return true;
}

function shortStatus(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.trim().toUpperCase();
  if (s.startsWith("IR")) return "IR";
  return s;
}
