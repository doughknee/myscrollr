import { memo } from "react";
import { clsx } from "clsx";
import { isLive, isFinal, isPre, isCloseGame, getWinner, gameStatusLabel, displayTeamCode } from "../../utils/gameHelpers";
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
  showLogos?: boolean;
  /**
   * Hide the per-game status (Q3 4:32, Final, in 2h) when false.
   * Matches the ticker-side `showTimer` Venue toggle. Defaults to
   * true to preserve existing behavior for callers that don't pass
   * the prop explicitly.
   */
  showTimer?: boolean;
  onClick?: () => void;
}

// ── Component ───────────────────────────────────────────────────

const GameChip = memo(function GameChip({
  game,
  comfort,
  colorMode = "channel",
  showLogos = true,
  showTimer = true,
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
        {showLogos && (
          <TeamLogo
            src={game.away_team_logo}
            alt={game.away_team_name}
            size={comfort ? "sm" : "xs"}
          />
        )}
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
        {showLogos && (
          <TeamLogo
            src={game.home_team_logo}
            alt={game.home_team_name}
            size={comfort ? "sm" : "xs"}
          />
        )}

        {/* Status (compact only) */}
        {!comfort && showTimer && status && (
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
          {showTimer && status && (
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
  prev.showLogos === next.showLogos &&
  prev.showTimer === next.showTimer &&
  prev.onClick === next.onClick &&
  prev.game.id === next.game.id &&
  prev.game.sport === next.game.sport &&
  prev.game.league === next.game.league &&
  prev.game.away_team_name === next.game.away_team_name &&
  prev.game.away_team_logo === next.game.away_team_logo &&
  prev.game.away_team_score === next.game.away_team_score &&
  prev.game.home_team_name === next.game.home_team_name &&
  prev.game.home_team_logo === next.game.home_team_logo &&
  prev.game.home_team_score === next.game.home_team_score &&
  prev.game.home_team_code === next.game.home_team_code &&
  prev.game.away_team_code === next.game.away_team_code &&
  prev.game.state === next.game.state &&
  prev.game.timer === next.game.timer &&
  prev.game.status_short === next.game.status_short &&
  prev.game.status_long === next.game.status_long &&
  prev.game.start_time === next.game.start_time
);

export default GameChip;
