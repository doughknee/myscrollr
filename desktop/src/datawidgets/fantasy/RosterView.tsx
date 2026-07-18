/**
 * RosterView — table view of any team's roster in the league.
 *
 * Splits players into Hitters / Pitchers tables (or whatever
 * position_types the sport uses), each with their own stat columns
 * driven by the league's Yahoo stat catalog. Starters render in the
 * primary table; bench/IR/NA players drop into a subdued section below.
 *
 * User can swap between any team in the league via the selector.
 */
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle, ChevronDown } from "lucide-react";
import {
  isBenchPosition,
  isInjuryStatus,
  statusColorClass,
  userRoster,
} from "./types";
import { PlayerStatsTable } from "./PlayerStatsTable";
import type { StatsWindow } from "./PlayerStatsTable";
import type { LeagueResponse, RosterEntry, RosterPlayer } from "./types";

interface RosterViewProps {
  league: LeagueResponse | null;
}

export function RosterView({ league }: RosterViewProps) {
  const userRosterEntry = useMemo(
    () => (league ? userRoster(league) : null),
    [league],
  );
  const [teamKey, setTeamKey] = useState<string | null>(
    userRosterEntry?.team_key ?? null,
  );
  const [window, setWindow] = useState<StatsWindow>("week");

  const activeRoster = useMemo(() => {
    if (!league?.rosters) return null;
    if (teamKey) {
      const match = league.rosters.find((r) => r.team_key === teamKey);
      if (match) return match;
    }
    return userRosterEntry ?? league.rosters[0] ?? null;
  }, [league, teamKey, userRosterEntry]);

  if (!league || !league.rosters || league.rosters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[12px] text-fg-3">
        Rosters aren&rsquo;t available for this league yet.
      </div>
    );
  }

  const isMe = activeRoster?.team_key === league.team_key;
  const allPlayers = activeRoster?.data.players ?? [];
  const starters = allPlayers.filter((p) => !isBenchPosition(p.selected_position));
  const bench = allPlayers.filter((p) => isBenchPosition(p.selected_position));

  const groupedStarters = groupByPositionType(starters);
  const groupedBench = groupByPositionType(bench);
  const injuries = allPlayers.filter((p) => isInjuryStatus(p.status));

  const catalog = league.data.stat_catalog ?? null;
  const hasTodayStats = allPlayers.some(
    (p) => p.player_stats_today && Object.keys(p.player_stats_today).length > 0,
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Team selector + quick stats */}
      <div className="flex flex-wrap items-center gap-3">
        <TeamSelector
          league={league}
          value={activeRoster?.team_key ?? null}
          onChange={setTeamKey}
        />
        <StatsWindowPicker
          value={window}
          onChange={setWindow}
          todayDisabled={!hasTodayStats}
        />
        <div className="flex items-center gap-3 text-[11px] text-fg-3">
          <span>
            <span className="font-bold text-fg">{starters.length}</span> starters
          </span>
          <span>·</span>
          <span>
            <span className="font-bold text-fg">{bench.length}</span> bench/IR
          </span>
          {injuries.length > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-warn">
                <AlertTriangle size={11} />
                {injuries.length} injured
              </span>
            </>
          )}
        </div>
      </div>

      {/* Injury spotlight (only for user's own team) */}
      {injuries.length > 0 && isMe && (
        <div className="rounded-lg border border-warn/30 bg-warn/[0.06] p-3">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-warn">
            <AlertTriangle size={12} />
            Injury watch
          </div>
          <div className="space-y-1.5">
            {injuries.map((p) => (
              <div
                key={p.player_key}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className={clsx(
                    "inline-flex shrink-0 items-center rounded border px-1.5 py-[1px] font-mono text-[9px] font-semibold uppercase tracking-wider",
                    statusColorClass(p.status),
                  )}
                >
                  {p.status}
                </span>
                <span className="font-medium text-fg">{p.name.full}</span>
                <span className="text-fg-3">({p.display_position})</span>
                {p.injury_note && (
                  <span className="truncate text-[10px] italic text-fg-3">
                    — {p.injury_note}
                  </span>
                )}
                <span
                  className={clsx(
                    "ml-auto font-mono text-[11px] font-bold uppercase",
                    isBenchPosition(p.selected_position)
                      ? "text-fg-3"
                      : "text-warn",
                  )}
                >
                  {isBenchPosition(p.selected_position) ? p.selected_position : "STARTING"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Starters — one table per position_type */}
      {groupedStarters.map(({ positionType, title, players }) => (
        <PlayerStatsTable
          key={`starters-${positionType}`}
          players={players}
          positionType={positionType}
          title={title}
          subtitle={`${players.length} starter${players.length === 1 ? "" : "s"}`}
          catalog={catalog}
          highlightPlayerKey={null}
          window={window}
        />
      ))}

      {/* Bench / IR — subdued tables */}
      {groupedBench.map(({ positionType, title, players }) => (
        <PlayerStatsTable
          key={`bench-${positionType}`}
          players={players}
          positionType={positionType}
          title={`${title} — bench & IR`}
          subtitle={`${players.length}`}
          catalog={catalog}
          subdued
          window={window}
        />
      ))}
    </div>
  );
}

// ── Team selector ────────────────────────────────────────────────

function TeamSelector({
  league,
  value,
  onChange,
}: {
  league: LeagueResponse;
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rosters = league.rosters ?? [];
  const current = rosters.find((r) => r.team_key === value) ?? rosters[0];
  const isMe = current?.team_key === league.team_key;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-edge/50 bg-surface px-2.5 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-accent/40 cursor-pointer"
      >
        <span>{current?.data.team_name ?? "Team"}</span>
        {isMe && (
          <span className="rounded bg-accent/20 px-1 py-[1px] font-mono text-[8px] uppercase tracking-wider text-accent">
            You
          </span>
        )}
        <ChevronDown size={12} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-64 overflow-y-auto rounded-lg border border-edge/50 bg-surface-2 py-1 shadow-lg">
          {rosters.map((r) => (
            <button
              key={r.team_key}
              type="button"
              onClick={() => {
                onChange(r.team_key);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors cursor-pointer hover:bg-surface-3",
                r.team_key === value && "bg-accent/10",
              )}
            >
              <span className="truncate">{r.data.team_name}</span>
              {r.team_key === league.team_key && (
                <span className="ml-auto rounded bg-accent/20 px-1 py-[1px] font-mono text-[8px] uppercase tracking-wider text-accent">
                  You
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export RosterEntry so existing imports don't break.
export type { RosterEntry };

// ── Stats window picker ──────────────────────────────────────────

interface StatsWindowPickerProps {
  value: StatsWindow;
  onChange: (v: StatsWindow) => void;
  todayDisabled?: boolean;
}

export function StatsWindowPicker({
  value,
  onChange,
  todayDisabled,
}: StatsWindowPickerProps) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-edge/40 text-[11px]">
      <Pill active={value === "week"} onClick={() => onChange("week")}>
        Week
      </Pill>
      <Pill
        active={value === "today"}
        onClick={() => onChange("today")}
        disabled={todayDisabled}
        title={todayDisabled ? "Today's stats are still syncing" : undefined}
      >
        Today
      </Pill>
    </div>
  );
}

function Pill({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "px-2.5 py-1 font-medium transition-colors",
        active
          ? "bg-accent/15 text-accent"
          : disabled
            ? "cursor-not-allowed text-fg-4"
            : "text-fg-3 hover:bg-surface-hover hover:text-fg-2 cursor-pointer",
      )}
    >
      {children}
    </button>
  );
}

// ── Position-type grouping ───────────────────────────────────────

interface PositionGroup {
  positionType: string;
  title: string;
  players: RosterPlayer[];
}

/** Friendly labels per position_type for each Yahoo sport. */
const POSITION_TYPE_LABELS: Record<string, string> = {
  B: "Hitters",
  P: "Pitchers",
  O: "Offense",
  D: "Defense",
  K: "Kickers",
};

function groupByPositionType(players: RosterPlayer[]): PositionGroup[] {
  const buckets = new Map<string, RosterPlayer[]>();
  for (const p of players) {
    const key = p.position_type || "B";
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  // Preserve a stable sport-friendly order: hitters before pitchers, etc.
  const order = ["B", "O", "P", "D", "K"];
  const groups: PositionGroup[] = [];
  for (const key of order) {
    if (buckets.has(key)) {
      groups.push({
        positionType: key,
        title: POSITION_TYPE_LABELS[key] ?? key,
        players: buckets.get(key)!,
      });
      buckets.delete(key);
    }
  }
  // Any remaining unknown position_types get appended.
  for (const [key, players] of buckets.entries()) {
    groups.push({
      positionType: key,
      title: POSITION_TYPE_LABELS[key] ?? key,
      players,
    });
  }
  return groups;
}
