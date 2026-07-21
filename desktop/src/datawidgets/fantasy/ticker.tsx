import { shouldShowOnTicker } from "../../preferences";
import FantasyStatChip from "../../components/chips/FantasyStatChip";
import FollowedPlayerChip from "../../components/chips/FollowedPlayerChip";
import { buildYahooLeagueUrl, buildYahooPlayerUrl } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { selectFantasyForTicker } from "./view";
import {
  findTopN,
  findTopBench,
  findWorstStarter,
  findInjuredPlayers,
} from "./playerStats";
import type { LeagueResponse as FantasyLeague } from "./types";

/**
 * Fantasy ticker chips.
 *
 * The only source whose payload is a structured `{ leagues: [...] }` object
 * rather than a flat array, and the only one that emits two chip kinds:
 * league summaries and per-player chips derived from the user's roster.
 *
 * `selectFantasyForTicker` honours enabledLeagueKeys + primaryLeagueKey from
 * Display prefs, so the ticker stays in sync with the Fantasy feed page.
 */
export const fantasyTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const payload = raw as { leagues?: unknown } | undefined;
    const leagues = Array.isArray(payload?.leagues)
      ? (payload.leagues as FantasyLeague[])
      : [];
    if (leagues.length === 0) return [];

    const prefs = ctx.widgetDisplay?.fantasy;
    if (!prefs) return [];

    const chips: TickerChip[] = [];

    // Followed-player chips render FIRST so the user's tracked players lead
    // the fantasy bucket. They render even when league-summary chips are
    // gated off — the user explicitly opted in to per-player tracking.
    //
    // Yahoo's `player_key` prefix is a numeric game id, not the sport name,
    // so a player's URL needs the owning league's `game_code`.
    const playerToLeagueGameCode = new Map<string, string>();
    for (const lg of leagues) {
      if (!lg.rosters) continue;
      for (const roster of lg.rosters) {
        for (const player of roster.data.players) {
          if (player.player_key) {
            playerToLeagueGameCode.set(player.player_key, lg.game_code);
          }
        }
      }
    }
    for (const playerKey of prefs.followedPlayerKeys ?? []) {
      const gameCode = playerToLeagueGameCode.get(playerKey);
      chips.push({
        key: `follow-${playerKey}`,
        node: (
          <FollowedPlayerChip
            playerKey={playerKey}
            leagues={leagues}
            comfort={ctx.comfort}
            colorMode={ctx.chipColorMode}
            onClick={() =>
              ctx.onChipClick?.(
                "fantasy",
                playerKey,
                buildYahooPlayerUrl(playerKey, gameCode),
              )
            }
          />
        ),
      });
    }

    for (const league of selectFantasyForTicker(leagues, prefs)) {
      const playerChip = (
        suffix: string,
        playerKey: string,
        accent: "top" | "worst" | "bench" | "injury",
      ): TickerChip => ({
        key: `fan-${league.league_key}-${suffix}-${playerKey}`,
        node: (
          <FollowedPlayerChip
            playerKey={playerKey}
            leagueKey={league.league_key}
            leagues={leagues}
            comfort={ctx.comfort}
            colorMode={ctx.chipColorMode}
            accent={accent}
            onClick={() =>
              ctx.onChipClick?.(
                "fantasy",
                playerKey,
                buildYahooPlayerUrl(playerKey, league.game_code),
              )
            }
          />
        ),
      });

      // 1. The league summary chip (matchup-level: score, week, win-prob,
      //    record, standings, top scorer, …).
      chips.push({
        key: `fan-${league.league_key}`,
        node: (
          <FantasyStatChip
            league={league}
            prefs={prefs}
            comfort={ctx.comfort}
            colorMode={ctx.chipColorMode}
            onClick={() =>
              ctx.onChipClick?.(
                "fantasy",
                league.league_key,
                buildYahooLeagueUrl(league.league_key, league.game_code),
              )
            }
          />
        ),
      });

      // 2. Per-player chips from the user's roster in this league. Render
      //    order mirrors the Display prefs grouping. Skip entirely when the
      //    league has no roster (rare pre-import or partial-sync state).
      const userTeam = league.rosters?.find((r) => r.team_key === league.team_key);
      if (!userTeam) continue;
      const players = userTeam.data.players;

      if (shouldShowOnTicker(prefs.topThreeScorers)) {
        const top3 = findTopN(players, 3, { startersOnly: true });
        // Skip top1 when topScorer is also enabled — it is already on the
        // league chip as "★ Mahomes 32" and would duplicate.
        const startIdx =
          shouldShowOnTicker(prefs.topScorer) && top3.length > 0 ? 1 : 0;
        for (let i = startIdx; i < top3.length; i++) {
          chips.push(playerChip("top", top3[i].player_key, "top"));
        }
      }

      if (shouldShowOnTicker(prefs.worstStarter)) {
        const worst = findWorstStarter(players);
        if (worst) chips.push(playerChip("worst", worst.player_key, "worst"));
      }

      if (shouldShowOnTicker(prefs.benchOpportunity)) {
        const topBench = findTopBench(players);
        if (topBench) {
          chips.push(playerChip("bench", topBench.player_key, "bench"));
        }
      }

      if (shouldShowOnTicker(prefs.injuryDetail)) {
        for (const p of findInjuredPlayers(players)) {
          chips.push(playerChip("inj", p.player_key, "injury"));
        }
      }
    }

    return chips;
  },
};
