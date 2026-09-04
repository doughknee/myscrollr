import { memo } from "react";
import { clsx } from "clsx";
import {
  isLive,
  isFinal,
  isPre,
  isCloseGame,
  gameStatusCompact,
  leagueCode,
  sameGame,
} from "../../utils/gameHelpers";
import { teamShortName } from "../../utils/teamShortName";
import {
  reservationFor,
  ordinal,
  recordText,
  metricText,
} from "../../utils/sportsChipLayout";
import { useScoreFlash } from "../../hooks/useScoreFlash";
import { liftForTint } from "../../utils/chipAccent";
import { getChipColors, chipShellClasses } from "./chipColors";
import TeamLogo from "../TeamLogo";
import type { Game, TeamStanding } from "../../types";
import type { ChipColorMode } from "../../preferences";

// ── Props ───────────────────────────────────────────────────────

interface GameChipProps {
  game: Game;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /**
   * The league widget's catalog brand colour (#rrggbb). Used only in the
   * "widget" colour mode; "accent" and "muted" keep their shared palettes.
   * Absent (no catalog yet, or a coarse legacy row) falls back to the
   * sports palette.
   */
  accent?: string;
  onClick?: () => void;
}

// ── Component ───────────────────────────────────────────────────

/**
 * The sports chip: four boxed cells -- league, away, home, status -- with
 * one rule running the full height between the two teams. Compact is the
 * scoreboard row; detailed is the same row plus each team's table line
 * beneath it. Nothing in the top row moves when the second appears.
 *
 * Content-sized, not 264px. Each team column is as wide as its own
 * content, so a Cubs-Tigers chip is short and a Revolution-Minnesota chip
 * is longer, with nothing padded to match. What makes that safe on a
 * moving rail is that every slot which can change while the chip is on
 * screen holds its widest plausible width from first render -- see
 * sportsChipLayout for the per-league numbers -- so a chip's width settles
 * once, when the fixture first renders, and never moves again. The live
 * dot always occupies its slot and is merely invisible before tip and
 * after the final; reserving the text alone left every live chip ~9px
 * wider than the same game either side of it.
 *
 * Team identity is the short name (teamShortName), never the API's code:
 * codes are empty for NCAA, MLB, NBA and NHL and the three-letter fallback
 * made "NOR" fourteen different teams.
 */
const GameChip = memo(
  function GameChip({
    game,
    comfort,
    colorMode = "widget",
    accent,
    onClick,
  }: GameChipProps) {
    const c = getChipColors(colorMode, "sports");
    // Brand tints derive from one CSS variable so the same 6% fill / 25%
    // border / 40% hover recipe every chip uses applies to a colour that is
    // only known at runtime. Tailwind cannot mint a class per hex, and a
    // variable keeps hover in CSS where it belongs.
    const branded = colorMode === "widget" && !!accent;
    // Lifted, not raw: a navy brand tints invisibly on this surface.
    const accentStyle = branded ? ({ "--accent": liftForTint(accent) } as React.CSSProperties) : undefined;
    const live = isLive(game);
    const close = live && isCloseGame(game);
    const final_ = isFinal(game);
    const pre_ = isPre(game);
    const ppd = game.state === "postponed";
    const flash = useScoreFlash(game.away_team_score, game.home_team_score);
    const r = reservationFor(game.league);

    // Weight follows the score: the side ahead carries it, the side behind
    // dims. Colour and weight only -- the teams never trade places, so a
    // lead changing hands is not a layout event.
    const away = Number(game.away_team_score);
    const home = Number(game.home_team_score);
    const scored = !pre_ && Number.isFinite(away) && Number.isFinite(home);
    const awayLeads = scored && away >= home;
    const homeLeads = scored && home >= away;

    const rule = close
      ? "border-live/40"
      : branded
        ? "border-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
        : "border-secondary/20";

    const scoreText = (v: number | string) =>
      pre_ || v === null || v === "" ? "" : String(v);

    // ── Cells ─────────────────────────────────────────────────

    const top = (side: "away" | "home", logo: string, name: string, score: number | string, leads: boolean) => (
      <span
        className={clsx(
          "row-start-1 flex min-w-0 items-center gap-1.5 px-2.5",
          side === "away" ? "col-start-2" : clsx("col-start-3 border-l", rule),
        )}
      >
        {/* 20px, not the 12px the old chip used: a crest is the identity a
            short name only labels, and at 12px on a 30px row it read as a
            bullet. ESPN runs ~18px against 12px type for the same reason. */}
        <TeamLogo src={logo} alt={name} size="lg" />
        <span
          className={clsx(
            "min-w-0 truncate text-left text-[12px] leading-none",
            pre_ ? "font-medium text-fg" : leads ? "font-semibold text-fg" : "font-medium text-fg-2",
          )}
          title={name}
        >
          {teamShortName(game.league, name)}
        </span>
        <span className="min-w-[6px] flex-1" />
        <span
          className={clsx(
            "text-right text-[13px] leading-none tabular-nums",
            leads ? "font-bold text-fg" : "font-medium text-fg-2",
          )}
          style={{ minWidth: `${r.score}ch` }}
        >
          {scoreText(score)}
        </span>
      </span>
    );

    const bottom = (side: "away" | "home", s: TeamStanding | undefined) => {
      const m = s ? metricText(s, r) : null;
      return (
        <span
          className={clsx(
            "row-start-2 flex items-center gap-1.5 px-2.5 text-[10px] leading-none",
            side === "away" ? "col-start-2" : clsx("col-start-3 border-l", rule),
          )}
        >
          {s ? (
            <>
              <span className="font-bold text-fg-2" style={{ minWidth: `${r.rank}ch` }}>
                {ordinal(s.rank)}
              </span>
              <span className="text-fg-3 tabular-nums" style={{ minWidth: `${r.record}ch` }}>
                {recordText(s, r)}
              </span>
              {m && (
                <span
                  className={clsx(
                    "text-right tabular-nums",
                    m.tone === "pos" && "text-up",
                    m.tone === "neg" && "text-down",
                    m.tone === "zero" && "text-fg-3",
                  )}
                  style={{ minWidth: `${r.metric}ch` }}
                >
                  {m.text}
                  <span className="ml-0.5 text-[8px] tracking-[0.06em] text-fg-4">{r.unit}</span>
                </span>
              )}
            </>
          ) : (
            // No table for this league (UFC, F1). Hold the height, say so.
            <span className="text-fg-4">—</span>
          )}
        </span>
      );
    };

    return (
      <button
        onClick={onClick}
        style={accentStyle}
        className={clsx(
          chipShellClasses(
            branded
              ? {
                  ...c,
                  bg: "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                  border: "border-[color-mix(in_srgb,var(--accent)_25%,transparent)]",
                  hoverBorder: "hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
                }
              : c,
            "font-mono whitespace-nowrap transition-colors duration-700",
          ),
          "grid max-w-[520px] grid-cols-[max-content_max-content_max-content_max-content]",
          comfort ? "grid-rows-[30px_20px]" : "grid-rows-[28px]",
          // Closeness is the whole weighting; the rules brighten with it.
          close && "border-live/70 bg-live/[0.13] shadow-[0_0_14px_rgba(255,71,87,0.2)]",
          // A result recedes behind what is still being played.
          final_ && "opacity-[0.82]",
          flash && "bg-live/20",
        )}
      >
        {/* The league tab is where the colour is SEEN. A tinted border and a
            6% fill are the recipe every chip shares, and by design they
            whisper; without one place the brand is painted properly, a
            branded chip looked no different from the old red one. */}
        <span
          className={clsx(
            "col-start-1 row-span-full flex items-center border-r px-[9px]",
            rule,
            branded && "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]",
          )}
        >
          <span
            className={clsx(
              "text-[10px] font-bold tracking-[0.08em]",
              branded ? "text-[var(--accent)]" : "text-fg-3",
            )}
          >
            {leagueCode(game.league)}
          </span>
        </span>

        {r.single ? (
          // One event, one venue. The feed models a race as home = grand
          // prix, away = circuit; the chip shows them stacked in one cell.
          <>
            <span className="col-start-2 col-span-2 row-start-1 flex min-w-0 items-center gap-1.5 px-2.5">
              <TeamLogo src={game.home_team_logo} alt={game.home_team_name} size="lg" />
              <span className="min-w-0 truncate text-[12px] font-semibold leading-none text-fg" title={game.home_team_name}>
                {teamShortName(game.league, game.home_team_name)}
              </span>
            </span>
            {comfort && (
              <span className="col-start-2 col-span-2 row-start-2 flex items-center px-2.5 text-[10px] leading-none text-fg-3">
                {teamShortName(game.league, game.away_team_name)}
              </span>
            )}
          </>
        ) : (
          <>
            {top("away", game.away_team_logo, game.away_team_name, game.away_team_score, awayLeads)}
            {top("home", game.home_team_logo, game.home_team_name, game.home_team_score, homeLeads)}
            {comfort && bottom("away", game.away_standing)}
            {comfort && bottom("home", game.home_standing)}
          </>
        )}

        <span className={clsx("col-start-4 row-span-full flex items-center justify-center border-l px-[9px]", rule)}>
          <span
            className={clsx(
              "inline-flex items-center gap-1 text-[11px] font-semibold tracking-[0.04em] leading-none",
              live ? "text-live" : final_ ? "text-fg-4" : ppd ? "text-warning" : "text-fg-2",
            )}
          >
            <span
              data-testid="live-dot"
              className={clsx("h-[5px] w-[5px] shrink-0 rounded-full bg-live", !live && "invisible")}
            />
            <span className="inline-block text-center" style={{ minWidth: `${r.status}ch` }}>
              {gameStatusCompact(game)}
            </span>
            {/* Mirror of the dot's slot, never visible: the dot reserves
                space on the left, so without this the text sat ~4px right
                of centre in every state. Width is unchanged either way. */}
            <span className="invisible h-[5px] w-[5px] shrink-0" />
          </span>
        </span>
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
