import { memo } from "react";
import { clsx } from "clsx";
import {
  isLive,
  isFinal,
  isPre,
  isCloseGame,
  getWinner,
  gameStatusLabel,
  gameStatusCompact,
  displayTeamCode,
  leagueCode,
  sameGame,
} from "../../utils/gameHelpers";
import { useScoreFlash } from "../../hooks/useScoreFlash";
import { getChipColors, chipBaseClasses } from "./chipColors";
import TeamLogo from "../TeamLogo";
import { TiltBar } from "./TiltBar";
import { winProbabilityForGame } from "../../utils/winProbability";
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

const GameChip = memo(
  function GameChip({
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
    // Score share today, a real model when the seam is fed — see
    // winProbabilityForGame. Nothing prints it as a percentage until it
    // reports isRealProbability.
    const tilt = winProbabilityForGame(game);

    // ── Render ──────────────────────────────────────────────────

    // One scoreboard row: logo, full name, score. Comfort only — compact
    // keeps the single-line code layout below.
    const teamRow = (
      side: "away" | "home",
      logo: string,
      name: string,
      score: number | string,
    ) => {
      const won = winner === side;
      const lost = final_ && winner !== null && winner !== side;
      return (
        <div className="flex min-w-0 items-center gap-[5px]">
          <TeamLogo
            src={logo}
            alt={name}
            size="xs"
            className={clsx(lost && "opacity-50")}
          />
          {/* Full name, not a code. displayTeamCode falls back to the first
              three letters, which renders three different MLS teams as "NEW"
              and both LA teams as "LOS". 11px fits 24 characters here, which
              covers 95% of the 190 teams in the catalog. */}
          <span
            className={clsx(
              // text-left is load-bearing: a <button> is centred by the UA
              // stylesheet, and a flex-1 span inherits that, so names float
              // in the middle of their row instead of lining up under each
              // other. Invisible on the old chip, where the codes were short
              // and sat adjacent with no slack to centre within.
              "min-w-0 flex-1 truncate text-left text-ui-chip leading-[18px]",
              won ? "font-semibold text-fg" : "font-medium text-fg-2",
              lost && "text-fg-4",
            )}
            title={name}
          >
            {name}
          </span>
          <span
            className={clsx(
              "w-5 shrink-0 text-right leading-[18px] tabular-nums",
              won ? "font-bold text-fg" : "text-fg-2",
              lost && "text-fg-4",
              pre_ && "text-fg-4/60",
            )}
          >
            {pre_ ? "–" : score === null || score === "" ? "-" : String(score)}
          </span>
        </div>
      );
    };

    if (comfort) {
      return (
        <button
          onClick={onClick}
          className={chipBaseClasses(
            comfort,
            c,
            clsx(
              "font-mono whitespace-nowrap gap-[5px] transition-colors duration-700",
              // Closeness is the whole weighting. Lateness would need a period
              // count per sport and `short_detail` is an unstructured string
              // ("Inning 4"), so it is deliberately left out rather than guessed.
              close && "border-live/70 bg-live/[0.13] shadow-[0_0_14px_rgba(255,71,87,0.2)]",
              flash && "bg-live/20",
            ),
            "row",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            {teamRow("away", game.away_team_logo, game.away_team_name, game.away_team_score)}
            {teamRow("home", game.home_team_logo, game.home_team_name, game.home_team_score)}
          </div>

          <div className={clsx("w-px shrink-0", close ? "bg-live/40" : "bg-secondary/20")} />

          <div className="flex w-[34px] shrink-0 flex-col items-center justify-center gap-[3px]">
            <span
              className={clsx(
                "flex items-center gap-[3px] whitespace-nowrap text-[10px] font-semibold leading-none",
                live ? "text-live" : final_ ? "text-fg-4" : "text-fg-2",
              )}
            >
              {live && (
                <span className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-live" />
              )}
              {gameStatusCompact(game)}
            </span>
            {game.league && (
              <span
                className={clsx(
                  "text-[8px] uppercase leading-none tracking-[0.08em]",
                  close ? "text-live" : "text-fg-4",
                )}
              >
                {leagueCode(game.league)}
              </span>
            )}
          </div>
        </button>
      );
    }

    // Compact: unchanged single-line layout. Team codes still collide here —
    // see REL-158's follow-up note; a single row cannot fit two full names.
    return (
      <button
        onClick={onClick}
        className={chipBaseClasses(
          comfort,
          c,
          clsx(
            "font-mono whitespace-nowrap transition-colors duration-700",
            flash && "bg-live/15",
            close && "border-live/40",
          ),
        )}
      >
        <div className="flex items-center gap-1.5">
          <TeamLogo src={game.away_team_logo} alt={game.away_team_name} size="xs" />
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
            {pre_ ? "_" : game.away_team_score == null || game.away_team_score === "" ? "-" : String(game.away_team_score)}
          </span>

          <TiltBar value={tilt.away} dimmed={pre_} settled={final_} live={live && close} />

          <span
            className={clsx(
              "tabular-nums",
              winner === "home" ? "font-bold " + c.text : c.textDim,
              final_ && winner === "away" && "opacity-50",
              pre_ && "opacity-30",
            )}
          >
            {pre_ ? "_" : game.home_team_score == null || game.home_team_score === "" ? "-" : String(game.home_team_score)}
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
          <TeamLogo src={game.home_team_logo} alt={game.home_team_name} size="xs" />

          {status && (
            <span
              className={clsx(
                "ml-0.5 flex items-center gap-1 text-ui-chip uppercase tracking-wider",
                live ? "font-semibold text-live" : "text-fg-3",
              )}
            >
              {live && (
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-live" />
              )}
              {status}
            </span>
          )}
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.comfort === next.comfort &&
    prev.colorMode === next.colorMode &&
    prev.onClick === next.onClick &&
    sameGame(prev.game, next.game),
);

export default GameChip;
