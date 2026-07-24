import { memo } from "react";
import { clsx } from "clsx";
import { isLive, isFinal, isPre, isCloseGame, getWinner, gameStatusLabel, displayTeamCode, sameGame } from "../../utils/gameHelpers";
import { useScoreFlash } from "../../hooks/useScoreFlash";
import { getChipColors } from "./chipColors";
import TeamLogo from "../TeamLogo";
import type { Game } from "../../types";
import type { ChipColorMode } from "../../preferences";

// ── Props ───────────────────────────────────────────────────────

interface GameChipProps {
  game: Game;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
}

// ── Component ───────────────────────────────────────────────────

const GameChip = memo(function GameChip({
  game,
  comfort,
  colorMode = "widget",
  onClick,
}: GameChipProps) {
  const c = getChipColors(colorMode, "sports");
  const live = isLive(game);
  const close = isCloseGame(game);
  const winner = getWinner(game);
  const status = gameStatusLabel(game);
  const final_ = isFinal(game);
  const pre_ = isPre(game);
  const flash = useScoreFlash(game.away_team_score, game.home_team_score);

  // ── Render ──────────────────────────────────────────────────

  return (
    <button
      onClick={onClick}
      className={clsx(
        "ticker-chip group",
        "px-3 rounded-sm border",
        "font-mono whitespace-nowrap",
        "transition-colors duration-700 cursor-pointer",
        flash ? "bg-live/15" : c.bg,
        close ? "border-live/40" : c.border,
        !close && c.hoverBorder,
        comfort
          ? "flex flex-col items-start py-1.5 gap-0.5"
          : "flex items-center gap-2 py-1 text-ui-body",
      )}
    >
      {/* Row 1: logos + scores */}
      <div
        className={clsx("flex items-center gap-1.5", comfort && "text-ui-body")}
      >
        {/* Away team */}
        <TeamLogo
          src={game.away_team_logo}
          alt={game.away_team_name}
          size={comfort ? "sm" : "xs"}
        />
        <span
          className={clsx(
            c.text,
            winner === "away" ? "font-bold" : "font-semibold",
            final_ && winner === "home" && "opacity-50",
          )}
        >
          {displayTeamCode(game.away_team_code, game.away_team_name)}
        </span>
        <span
          className={clsx(
            "tabular-nums",
            winner === "away" ? "font-bold " + c.text : c.textDim,
            final_ && winner === "home" && "opacity-50",
            pre_ && "opacity-30",
          )}
        >
          {pre_ ? "_" : (game.away_team_score == null || game.away_team_score === "" ? "-" : String(game.away_team_score))}
        </span>

        <span className="text-fg-3">-</span>

        {/* Home team */}
        <span
          className={clsx(
            "tabular-nums",
            winner === "home" ? "font-bold " + c.text : c.textDim,
            final_ && winner === "away" && "opacity-50",
            pre_ && "opacity-30",
          )}
        >
          {pre_ ? "_" : (game.home_team_score == null || game.home_team_score === "" ? "-" : String(game.home_team_score))}
        </span>
        <span
          className={clsx(
            c.text,
            winner === "home" ? "font-bold" : "font-semibold",
            final_ && winner === "away" && "opacity-50",
          )}
        >
          {displayTeamCode(game.home_team_code, game.home_team_name)}
        </span>
        <TeamLogo
          src={game.home_team_logo}
          alt={game.home_team_name}
          size={comfort ? "sm" : "xs"}
        />

        {/* Status (compact only) */}
        {!comfort && status && (
          <span
            className={clsx(
              "flex items-center gap-1 text-ui-chip uppercase tracking-wider ml-0.5",
              live ? "text-live font-semibold" : "text-fg-3",
            )}
          >
            {live && (
              <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse shrink-0" />
            )}
            {status}
          </span>
        )}
      </div>

      {/* Row 2: league + timer/status (comfort only) */}
      {comfort && (
        <div
          className={clsx(
            "flex items-center gap-1.5 text-ui-chip",
            c.textFaint,
          )}
        >
          {game.league && (
            <span className="uppercase font-semibold">{game.league}</span>
          )}
          {status && (
            <>
              <span className="text-fg-3">&middot;</span>
              <span
                className={clsx(
                  "flex items-center gap-1",
                  live && "text-live font-semibold",
                )}
              >
                {live && (
                  <span className="w-1 h-1 rounded-full bg-live animate-pulse shrink-0" />
                )}
                {status}
              </span>
            </>
          )}
          {close && (
            <>
              <span className="text-fg-3">&middot;</span>
              <span className="text-live/80 font-semibold">Close</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}, (prev, next) =>
  prev.comfort === next.comfort &&
  prev.colorMode === next.colorMode &&
  prev.onClick === next.onClick &&
  sameGame(prev.game, next.game)
);

export default GameChip;
