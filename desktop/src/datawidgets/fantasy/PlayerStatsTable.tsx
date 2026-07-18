/**
 * PlayerStatsTable — the canonical table view for a group of fantasy
 * players in the same sport position type (e.g. all hitters or all
 * pitchers on a team).
 *
 * Columns are driven by the league's own stat catalog. Rows show player
 * name, injury status, slot, and one value per stat column. Values
 * preserve Yahoo's raw formatting (ratios like "5/17", IP thirds like
 * "3.2", leading-period OPS, and "—" for missing data).
 */
import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";
import {
  isInjuryStatus,
  statColumnsForPosition,
  statValue,
  statusColorClass,
} from "./types";
import type { RosterPlayer, StatCatalog } from "./types";

/**
 * Which stats window the table should render:
 *  - "week"  — player_stats (week-to-date totals; our default)
 *  - "today" — player_stats_today (today's date in Eastern Time)
 */
export type StatsWindow = "week" | "today";

interface PlayerStatsTableProps {
  players: RosterPlayer[];
  /** Sport position type that scopes the stat columns: "B" / "P" / "O" / "D". */
  positionType: string;
  /** Section title — e.g. "Hitters" or "Pitchers". */
  title: string;
  /** Optional secondary label — e.g. "9 starters". */
  subtitle?: string;
  /** League-provided stat catalog. Null when the league's catalog hasn't synced yet. */
  catalog: StatCatalog | null;
  /** Highlight a specific player row (used to mark the user's team). */
  highlightPlayerKey?: string | null;
  /** Render in a quieter bench style. */
  subdued?: boolean;
  /** Stats window to render; defaults to "week". */
  window?: StatsWindow;
}

export function PlayerStatsTable({
  players,
  positionType,
  title,
  subtitle,
  catalog,
  highlightPlayerKey,
  subdued,
  window = "week",
}: PlayerStatsTableProps) {
  if (players.length === 0) return null;

  const columns = statColumnsForPosition(catalog, positionType);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
          {title}
        </h3>
        {subtitle && (
          <span className="font-mono text-[10px] tabular-nums text-fg-4">
            {subtitle}
          </span>
        )}
      </div>

      <div
        className={clsx(
          "overflow-x-auto rounded-lg border",
          subdued
            ? "border-edge/30 bg-surface-2/40"
            : "border-edge/40 bg-surface",
        )}
      >
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-edge/40 font-mono text-[9px] uppercase tracking-wider text-fg-4">
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left">
                Player
              </th>
              <th className="px-1 py-2 text-center">Slot</th>
              {columns.map((col) => (
                <th
                  key={col.stat_id}
                  className="px-2 py-2 text-right"
                  title={col.name || col.display_name}
                >
                  {col.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <PlayerRow
                key={p.player_key}
                player={p}
                columns={columns}
                subdued={subdued}
                window={window}
                highlighted={
                  highlightPlayerKey != null &&
                  p.player_key === highlightPlayerKey
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Row ─────────────────────────────────────────────────────────

function PlayerRow({
  player,
  columns,
  subdued,
  highlighted,
  window,
}: {
  player: RosterPlayer;
  columns: ReturnType<typeof statColumnsForPosition>;
  subdued?: boolean;
  highlighted?: boolean;
  window: StatsWindow;
}) {
  const injured = isInjuryStatus(player.status);
  const source =
    window === "today" ? player.player_stats_today : player.player_stats;

  return (
    <tr
      className={clsx(
        "border-t border-edge/20 transition-colors",
        highlighted && "bg-accent/[0.06]",
        !subdued && "hover:bg-surface-hover",
      )}
    >
      {/* Player cell — sticky so columns can scroll on narrow widths */}
      <td
        className={clsx(
          "sticky left-0 z-10 px-3 py-2",
          subdued ? "bg-surface-2/40" : "bg-surface",
          highlighted && "bg-accent/[0.06]",
        )}
      >
        <div className="flex items-center gap-2">
          {player.image_url ? (
            <img
              src={player.image_url}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="h-6 w-6 shrink-0 rounded-full bg-surface-3" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span
                className={clsx(
                  "truncate font-medium",
                  subdued ? "text-fg-3" : "text-fg-2",
                )}
              >
                {player.name.full}
              </span>
              {injured && (
                <span
                  className={clsx(
                    "inline-flex items-center gap-0.5 rounded border px-1 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-wider",
                    statusColorClass(player.status),
                  )}
                  title={player.status_full || player.injury_note || ""}
                >
                  <AlertTriangle size={7} />
                  {player.status}
                </span>
              )}
            </div>
            <div className="truncate text-[9px] text-fg-4">
              {player.editorial_team_abbr}
              {player.display_position && ` · ${player.display_position}`}
            </div>
          </div>
        </div>
      </td>

      {/* Slot pill */}
      <td className="px-1 py-2 text-center">
        <span
          className={clsx(
            "inline-block rounded-full border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-wider",
            subdued
              ? "border-edge/30 bg-surface-3/50 text-fg-4"
              : "border-edge/50 bg-surface-2 text-fg-3",
          )}
        >
          {player.selected_position || "—"}
        </span>
      </td>

      {/* One cell per stat column */}
      {columns.map((col) => {
        const raw = statValue(source, col.stat_id);
        const isDash = raw === "—";
        return (
          <td
            key={col.stat_id}
            className={clsx(
              "px-2 py-2 text-right font-mono tabular-nums",
              isDash
                ? "text-fg-4"
                : subdued
                  ? "text-fg-3"
                  : col.display_only
                    ? "text-fg-2"
                    : "text-fg font-medium",
            )}
          >
            {raw}
          </td>
        );
      })}
    </tr>
  );
}
