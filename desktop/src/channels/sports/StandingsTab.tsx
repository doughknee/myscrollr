import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import TeamLogo from "../../components/TeamLogo";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import { standingsOptions } from "../../api/queries";
import type { Standing } from "../../api/queries";

interface StandingsTabProps {
  leagues: string[];
  favoriteTeams: Set<string>;
}

type SportType = "soccer" | "nfl" | "nba" | "nhl" | "mlb" | "other";

interface Column {
  key: string;
  label: string;
  fullName?: string;
  width?: string;
  align?: "left" | "center" | "right";
  getValue: (s: Standing) => React.ReactNode;
}

function getColumnsForSport(sportApi?: string): Column[] {
  const sport = getSportType(sportApi);
  
  const teamCol: Column = {
    key: "team",
    label: "Team",
    fullName: "Team",
    getValue: (s) => (
      <div className="flex items-center gap-2">
        <TeamLogo src={s.team_logo} alt={s.team_name} size="sm" />
        <span className="text-fg-2 font-medium truncate">{s.team_name}</span>
      </div>
    ),
  };

  switch (sport) {
    case "soccer":
      return [
        { key: "rank", label: "#", fullName: "Rank", width: "w-12", align: "center", getValue: (s) => s.rank || "-" },
        { ...teamCol, width: "w-48" },
        { key: "gp", label: "GP", fullName: "Games Played", width: "w-14", align: "center", getValue: (s) => s.games_played },
        { key: "w", label: "W", fullName: "Wins", width: "w-14", align: "center", getValue: (s) => s.wins },
        { key: "d", label: "D", fullName: "Draws", width: "w-14", align: "center", getValue: (s) => s.draws },
        { key: "l", label: "L", fullName: "Losses", width: "w-14", align: "center", getValue: (s) => s.losses },
        { key: "gd", label: "GD", fullName: "Goal Difference", width: "w-16", align: "center", getValue: (s) => s.goal_diff > 0 ? `+${s.goal_diff}` : s.goal_diff },
        { key: "pts", label: "Pts", fullName: "Points", width: "w-16", align: "center", getValue: (s) => s.points },
        { key: "form", label: "Form", fullName: "Recent Form", width: "w-20", getValue: (s) => s.form || "-" },
      ];
    case "nfl":
      return [
        { key: "rank", label: "#", fullName: "Rank", width: "w-12", align: "center", getValue: (s) => s.rank || "-" },
        { ...teamCol, width: "w-48" },
        { key: "w", label: "W", fullName: "Wins", width: "w-14", align: "center", getValue: (s) => s.wins },
        { key: "l", label: "L", fullName: "Losses", width: "w-14", align: "center", getValue: (s) => s.losses },
        { key: "t", label: "T", fullName: "Ties", width: "w-14", align: "center", getValue: (s) => s.draws },
        { key: "pct", label: "Pct", fullName: "Win Percentage", width: "w-16", align: "center", getValue: (s) => s.pct || "-" },
        { key: "pf", label: "PF", fullName: "Points For", width: "w-16", align: "center", getValue: (s) => s.points_for || "-" },
        { key: "pa", label: "PA", fullName: "Points Against", width: "w-16", align: "center", getValue: (s) => s.points_against || "-" },
        { key: "streak", label: "Str", fullName: "Streak", width: "w-16", getValue: (s) => s.streak || "-" },
      ];
    case "nba":
    case "mlb":
      return [
        { key: "rank", label: "#", fullName: "Rank", width: "w-12", align: "center", getValue: (s) => s.rank || "-" },
        { ...teamCol, width: "w-48" },
        { key: "w", label: "W", fullName: "Wins", width: "w-14", align: "center", getValue: (s) => s.wins },
        { key: "l", label: "L", fullName: "Losses", width: "w-14", align: "center", getValue: (s) => s.losses },
        { key: "pct", label: "Pct", fullName: "Win Percentage", width: "w-16", align: "center", getValue: (s) => s.pct || "-" },
        { key: "gb", label: "GB", fullName: "Games Behind", width: "w-16", align: "center", getValue: (s) => s.games_behind || "-" },
        { key: "pf", label: "PF", fullName: "Points For", width: "w-16", align: "center", getValue: (s) => s.points_for || "-" },
        { key: "pa", label: "PA", fullName: "Points Against", width: "w-16", align: "center", getValue: (s) => s.points_against || "-" },
        { key: "streak", label: "Str", fullName: "Streak", width: "w-16", getValue: (s) => s.streak || "-" },
      ];
    case "nhl":
      return [
        { key: "rank", label: "#", fullName: "Rank", width: "w-12", align: "center", getValue: (s) => s.rank || "-" },
        { ...teamCol, width: "w-48" },
        { key: "gp", label: "GP", fullName: "Games Played", width: "w-14", align: "center", getValue: (s) => s.games_played },
        { key: "w", label: "W", fullName: "Wins", width: "w-14", align: "center", getValue: (s) => s.wins },
        { key: "l", label: "L", fullName: "Losses", width: "w-14", align: "center", getValue: (s) => s.losses },
        { key: "otl", label: "OTL", fullName: "Overtime Losses", width: "w-14", align: "center", getValue: (s) => s.otl ?? "-" },
        { key: "pts", label: "Pts", fullName: "Points", width: "w-16", align: "center", getValue: (s) => s.points },
        { key: "gf", label: "GF", fullName: "Goals For", width: "w-16", align: "center", getValue: (s) => s.goals_for ?? "-" },
        { key: "ga", label: "GA", fullName: "Goals Against", width: "w-16", align: "center", getValue: (s) => s.goals_against ?? "-" },
        { key: "streak", label: "Str", fullName: "Streak", width: "w-16", getValue: (s) => s.streak || "-" },
      ];
    default:
      return [
        { key: "rank", label: "#", fullName: "Rank", width: "w-12", align: "center", getValue: (s) => s.rank || "-" },
        { ...teamCol, width: "w-48" },
        { key: "gp", label: "GP", fullName: "Games Played", width: "w-14", align: "center", getValue: (s) => s.games_played },
        { key: "w", label: "W", fullName: "Wins", width: "w-14", align: "center", getValue: (s) => s.wins },
        { key: "l", label: "L", fullName: "Losses", width: "w-14", align: "center", getValue: (s) => s.losses },
        { key: "d", label: "D", fullName: "Draws", width: "w-14", align: "center", getValue: (s) => s.draws },
        { key: "pts", label: "Pts", fullName: "Points", width: "w-16", align: "center", getValue: (s) => s.points },
      ];
  }
}

function getSportType(sportApi?: string): SportType {
  if (!sportApi) return "soccer";
  if (sportApi === "american-football") return "nfl";
  if (sportApi === "basketball") return "nba";
  if (sportApi === "hockey") return "nhl";
  if (sportApi === "baseball") return "mlb";
  if (sportApi === "football") return "soccer";
  return "other";
}

function GroupHeader({
  name,
  isCollapsed,
  onToggle,
}: {
  name: string;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      className="bg-surface-hover cursor-pointer select-none hover:bg-surface-hover/80 transition-colors"
      onClick={onToggle}
    >
      <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-fg-2">
        <div className="flex items-center gap-1.5">
          <ChevronDown
            size={14}
            className={clsx(
              "text-fg-3 transition-transform duration-200",
              isCollapsed && "-rotate-90",
            )}
          />
          {name}
        </div>
      </td>
    </tr>
  );
}

function getZoneColor(description?: string): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("champions league")) return "border-l-green-500";
  if (lower.includes("europa")) return "border-l-blue-500";
  if (lower.includes("relegation")) return "border-l-red-500";
  return null;
}

export function StandingsTab({ leagues, favoriteTeams }: StandingsTabProps) {
  const [selected, setSelected] = useState(leagues[0] ?? "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const favRowRef = useRef<HTMLTableRowElement | null>(null);

  const toggleGroup = useCallback((groupName: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }, []);

  useEffect(() => {
    setCollapsed(new Set());
  }, [selected]);

  const { data, isLoading, isError } = useQuery({
    ...standingsOptions(selected),
    enabled: !!selected,
  });

  const standings: Standing[] = data?.standings ?? [];

  useEffect(() => {
    if (favRowRef.current) {
      favRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [standings, favoriteTeams]);

  const { columns, groupedRows, hasZones } = useMemo(() => {
    const cols = getColumnsForSport(standings[0]?.sport_api);
    
    // Group by group_name using a Map so non-contiguous entries merge properly
    const map = new Map<string, Standing[]>();
    const order: string[] = [];
    for (const s of standings) {
      const key = s.group_name || "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(s);
    }

    const groups = order.map((key) => ({
      groupName: key,
      standings: map.get(key)!,
    }));

    const zones = standings.some((s) => getZoneColor(s.description) !== null);

    // If every team is its own "group" (single-member groups with names),
    // collapse them into one unnamed group to avoid a header per team
    const namedGroups = groups.filter((g) => g.groupName);
    if (namedGroups.length > 0 && namedGroups.every((g) => g.standings.length === 1)) {
      // Every named group has exactly one team — this is not real grouping,
      // it's just per-team metadata. Flatten into a single group.
      const allStandings = groups.flatMap((g) => g.standings);
      return { columns: cols, groupedRows: [{ groupName: "", standings: allStandings }], hasZones: zones };
    }

    return { columns: cols, groupedRows: groups, hasZones: zones };
  }, [standings]);

  if (leagues.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-3 text-xs">
        Add league widgets from the Catalog to see standings
      </div>
    );
  }

  return (
    <div>
      {/* League selector */}
      <div className="px-3 py-2 border-b border-edge/30 bg-surface">
        <SelectMenu
          value={selected}
          options={leagues.map((l) => ({ value: l, label: l }))}
          onChange={setSelected}
          ariaLabel="League"
          prefix="League"
          align="left"
        />
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-fg-3 text-xs">
          Loading standings...
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center py-12 text-error text-xs">
          Failed to load standings
        </div>
      )}

      {!isLoading && !isError && standings.length === 0 && (
        <div className="flex items-center justify-center py-12 text-fg-3 text-xs">
          No standings available for {selected}
        </div>
      )}

      {standings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-fixed">
            <thead>
              <tr className="text-fg-3 text-[10px] uppercase tracking-wider border-b border-edge/30">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    title={col.fullName || col.label}
                    className={clsx(
                      "px-2 py-2 font-semibold",
                      col.width,
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right",
                      !col.align && "text-left"
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                let favRefAssigned = false;
                return groupedRows.map((group, groupIdx) => (
                  <Fragment key={group.groupName || `group-${groupIdx}`}>
                    {group.groupName && (
                      <GroupHeader
                        name={group.groupName}
                        isCollapsed={collapsed.has(group.groupName)}
                        onToggle={() => toggleGroup(group.groupName)}
                      />
                    )}
                    {!collapsed.has(group.groupName) &&
                      group.standings.map((s, i) => {
                        const isFav = favoriteTeams.has(s.team_name);
                        const assignRef = isFav && !favRefAssigned;
                        if (assignRef) favRefAssigned = true;
                        const zoneColor = getZoneColor(s.description);
                        return (
                          <tr
                            key={`${s.team_name}-${i}`}
                            ref={assignRef ? favRowRef : undefined}
                            className={clsx(
                              "border-b border-edge/30 hover:bg-surface-hover transition-colors",
                              isFav && "bg-[#f97316]/5",
                              zoneColor
                                ? `border-l-2 ${zoneColor}`
                                : "border-l-2 border-l-transparent",
                            )}
                          >
                            {columns.map((col) => (
                              <td
                                key={col.key}
                                className={clsx(
                                  "px-2 py-1.5",
                                  col.width,
                                  col.key !== "team" && "font-mono text-fg-2",
                                  col.align === "center" && "text-center",
                                  col.align === "right" && "text-right",
                                  !col.align && "text-left"
                                )}
                              >
                                {col.getValue(s)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </Fragment>
                ));
              })()}
            </tbody>
          </table>
          {hasZones && (
            <div className="flex items-center gap-4 px-3 py-2 border-t border-edge/30 text-[10px] text-fg-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Champions League
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Europa League
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Relegation
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
