import { clsx } from "clsx";
import { motion } from "motion/react";
import type { ChipColorMode } from "../../preferences";
import type { LeagueResponse } from "../../channels/fantasy/types";
import {
  SPORT_EMOJI,
  isMatchupFinal,
  isMatchupLive,
  teamScore,
  userMatchupContext,
} from "../../channels/fantasy/types";
import { getChipColors, chipBaseClasses } from "./chipColors";

interface FantasyChipProps {
  league: LeagueResponse;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
}

/**
 * Fantasy ticker chip — condenses a league into a single live matchup
 * readout. Highlights when live, dims when finished/pre.
 */
export default function FantasyChip({
  league,
  comfort,
  colorMode = "channel",
  onClick,
}: FantasyChipProps) {
  const c = getChipColors(colorMode, "fantasy");
  const ctx = userMatchupContext(league);

  // No current matchup — fall back to a compact "team rank" chip.
  if (!ctx) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
      >
        <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
          <span aria-hidden>{SPORT_EMOJI[league.game_code] ?? "🏆"}</span>
          <span className={clsx("font-medium truncate max-w-[180px]", c.text)}>
            {league.name}
          </span>
        </div>
        {comfort && (
          <div className={clsx("flex items-center gap-1.5 text-ui-chip", c.textFaint)}>
            {league.data.is_finished ? "Finished" : "Off-week"}
          </div>
        )}
      </button>
    );
  }

  const live = isMatchupLive(ctx.matchup);
  const final = isMatchupFinal(ctx.matchup);
  const myPts = teamScore(ctx.user);
  const oppPts = teamScore(ctx.opponent);
  const myWinning = myPts > oppPts;
  const myLosing = myPts < oppPts;

  const scoreClass = final
    ? myWinning
      ? "text-up"
      : myLosing
        ? "text-down"
        : c.text
    : myWinning
      ? "text-up"
      : c.text;

  return (
    <button
      type="button"
      onClick={onClick}
      className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
    >
      {/* Row 1 */}
      <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
        <span aria-hidden>{SPORT_EMOJI[league.game_code] ?? "🏆"}</span>
        {live && (
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-live"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className={clsx("font-semibold truncate max-w-[120px]", c.text)}>
          {ctx.user.name.split(" ").slice(0, 2).join(" ")}
        </span>
        <span className={clsx("tabular-nums font-bold", scoreClass)}>
          {myPts.toFixed(1)}
        </span>
        <span className={c.textDim}>–</span>
        <span className={clsx("tabular-nums font-bold", c.text)}>
          {oppPts.toFixed(1)}
        </span>
        <span className={clsx("truncate max-w-[90px]", c.textDim)}>
          {ctx.opponent.name.split(" ").slice(0, 2).join(" ")}
        </span>
      </div>
      {/* Row 2 (comfort only) */}
      {comfort && (
        <div className={clsx("flex items-center gap-1.5 text-ui-chip", c.textFaint)}>
          <span className="uppercase tracking-wider">
            {final ? "Final" : live ? "Live" : `Wk ${ctx.matchup.week}`}
          </span>
          <span>·</span>
          <span className="truncate max-w-[220px]">{league.name}</span>
        </div>
      )}
    </button>
  );
}
