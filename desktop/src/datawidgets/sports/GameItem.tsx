/**
 * GameItem — renders a single game scoreboard card.
 *
 * Supports compact (single-row) and comfort (two-row with team logos)
 * display modes. Flashes briefly when scores update via CDC.
 * Clickable when game.link is available (opens in new tab).
 */
import { memo } from "react";
import { clsx } from "clsx";
import { Star } from "lucide-react";
import { isLive, isFinal, getWinner, gameStatusLabel, displayTeamCode, sameGame } from "../../utils/gameHelpers";
import { FEED_CARD, FEED_CARD_INTERACTIVE, FEED_CARD_STATIC } from "../../components/feedCard";
import TeamLogo from "../../components/TeamLogo";
import { useScoreFlash } from "../../hooks/useScoreFlash";
import type { Game, FeedMode } from "../../types";

interface GameItemProps {
  game: Game;
  mode: FeedMode;
  isFavorite?: boolean;
}

function formatScore(score: number | string | null | undefined): string {
  if (score == null || score === "") return "-";
  return String(score);
}

/** Wraps children in an <a> tag if the game has a link, otherwise a <div>. */
function CardWrapper({
  link,
  children,
  className,
}: {
  link: string;
  children: React.ReactNode;
  className: string;
}) {
  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}

// ── Component ───────────────────────────────────────────────────

export const GameItem = memo(function GameItem({
  game,
  mode,
  isFavorite = false,
}: GameItemProps) {
  const live = isLive(game);
  const final_ = isFinal(game);
  const winner = getWinner(game);
  const flash = useScoreFlash(game.away_team_score, game.home_team_score);
  const hasLink = !!game.link;

  if (mode === "compact") {
    return (
      <CardWrapper
        link={game.link}
        className={clsx(
          "flex items-center gap-2 px-3 py-1.5 bg-surface text-xs transition-colors duration-700",
          flash && "bg-live/10",
          hasLink && "hover:bg-surface-hover cursor-pointer",
        )}
      >
        <TeamLogo src={game.away_team_logo} alt={game.away_team_name} size="md" />
        <span
          className={clsx(
            "font-mono font-medium min-w-[28px]",
            final_ && winner === "home" ? "text-fg-3" : "text-fg",
            winner === "away" && "font-bold",
          )}
        >
          {displayTeamCode(game.away_team_code, game.away_team_name)}
        </span>
        <span
          className={clsx(
            "font-mono tabular-nums",
            final_ && winner === "home" ? "text-fg-3" : "text-fg",
            winner === "away" && "font-bold",
          )}
        >
          {formatScore(game.away_team_score)}
        </span>
        <span className="text-fg-3 font-mono">&ndash;</span>
        <span
          className={clsx(
            "font-mono tabular-nums",
            final_ && winner === "away" ? "text-fg-3" : "text-fg",
            winner === "home" && "font-bold",
          )}
        >
          {formatScore(game.home_team_score)}
        </span>
        <span
          className={clsx(
            "font-mono font-medium min-w-[28px]",
            final_ && winner === "away" ? "text-fg-3" : "text-fg",
            winner === "home" && "font-bold",
          )}
        >
          {displayTeamCode(game.home_team_code, game.home_team_name)}
        </span>
        <TeamLogo src={game.home_team_logo} alt={game.home_team_name} size="md" />
        {isFavorite && (
          <Star size={10} className="text-[#f97316]/60 fill-[#f97316]/40 shrink-0" />
        )}
        <span
          className={clsx(
            "ml-auto text-[9px] font-mono uppercase tracking-wider",
            live && "text-live font-bold",
            !live && "text-fg-3",
          )}
        >
          {live && (
            <span className="inline-block w-1 h-1 rounded-full bg-live mr-1 align-middle animate-pulse" />
          )}
          {gameStatusLabel(game)}
        </span>
      </CardWrapper>
    );
  }

  // Comfort mode
  return (
    <CardWrapper
      link={game.link}
      className={clsx(
        FEED_CARD,
        hasLink ? FEED_CARD_INTERACTIVE : FEED_CARD_STATIC,
        "relative overflow-hidden",
        // Accent border layered on the shell: favorite+live > live > favorite
        isFavorite && live
          ? "border-l-2 border-l-[#f97316]/60"
          : live
            ? "border-l-2 border-l-live/40"
            : isFavorite
              ? "border-l-2 border-l-[#f97316]/30"
              : null,
      )}
    >
      {/* Score-flash tint on its OWN overlay: the slow 700ms fade the
          cards had pre-unification, decoupled from the shell's 150ms
          hover transition (a bg class on the card also fought
          FEED_CARD's bg utility on stylesheet order). */}
      <span
        aria-hidden
        className={clsx(
          "pointer-events-none absolute inset-0 transition-colors duration-700",
          flash ? "bg-live/8" : "bg-transparent",
        )}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TeamLogo src={game.away_team_logo} alt={game.away_team_name} size="lg" />
          <span
            className={clsx(
              "text-sm",
              final_ && winner === "home" ? "text-fg-3" : "text-fg",
              winner === "away" && "font-semibold",
            )}
          >
            {game.away_team_name}
          </span>
        </div>
        <span
          className={clsx(
            "text-sm font-mono font-bold tabular-nums",
            final_ && winner === "home" ? "text-fg-3" : "text-fg",
          )}
        >
          {formatScore(game.away_team_score)}
        </span>
      </div>

      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-2">
          <TeamLogo src={game.home_team_logo} alt={game.home_team_name} size="lg" />
          <span
            className={clsx(
              "text-sm",
              final_ && winner === "away" ? "text-fg-3" : "text-fg",
              winner === "home" && "font-semibold",
            )}
          >
            {game.home_team_name}
          </span>
        </div>
        <span
          className={clsx(
            "text-sm font-mono font-bold tabular-nums",
            final_ && winner === "away" ? "text-fg-3" : "text-fg",
          )}
        >
          {formatScore(game.home_team_score)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        {isFavorite && (
          <Star size={10} className="text-[#f97316]/60 fill-[#f97316]/40" />
        )}
        <div className={clsx("flex items-center gap-1.5", !isFavorite && "ml-auto")}>
          {live && (
            <span className="inline-block w-1 h-1 rounded-full bg-live animate-pulse" />
          )}
          <span
            className={clsx(
              "text-[9px] font-mono uppercase tracking-wider",
              live && "text-live font-bold",
              !live && "text-fg-3",
            )}
          >
            {gameStatusLabel(game)}
          </span>
        </div>
      </div>
    </CardWrapper>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.isFavorite === next.isFavorite &&
  sameGame(prev.game, next.game)
);
