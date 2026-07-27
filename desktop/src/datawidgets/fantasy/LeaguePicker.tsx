import { Check } from "lucide-react";
import { clsx } from "clsx";
import {
  Section,
} from "../../components/settings/SettingsControls";
import { sportLabel } from "./types";
import type { DiscoveredLeague } from "./types";

// ── Props ────────────────────────────────────────────────────────

interface LeaguePickerProps {
  pickableLeagues: DiscoveredLeague[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onImport: () => void;
  onSkip: () => void;
  hex: string;
}

// ── Component ────────────────────────────────────────────────────

export function LeaguePicker({
  pickableLeagues,
  selectedKeys,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onImport,
  onSkip,
  hex,
}: LeaguePickerProps) {
  const pickableActive = pickableLeagues.filter((l) => !l.is_finished);
  const pickableFinished = pickableLeagues.filter((l) => l.is_finished);

  return (
    <div
    >
      <Section title={`Select Leagues (${pickableLeagues.length} found)`}>
        <div className="px-3 space-y-3">
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onSelectAll}
              className="text-[11px] text-fg-3 hover:text-fg-2  cursor-pointer"
            >
              Select All
            </button>
            <span className="text-fg-3">|</span>
            <button
              onClick={onDeselectAll}
              className="text-[11px] text-fg-3 hover:text-fg-2  cursor-pointer"
            >
              Deselect All
            </button>
          </div>

          {pickableActive.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-success/80 flex items-center gap-1.5 mb-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success " />
                Active Leagues
              </p>
              {pickableActive.map((league) => (
                <LeaguePickerRow
                  key={league.league_key}
                  league={league}
                  selected={selectedKeys.has(league.league_key)}
                  onToggle={() => onToggle(league.league_key)}
                  hex={hex}
                />
              ))}
            </div>
          )}

          {pickableFinished.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-fg-3 mb-1.5">
                Past Leagues
              </p>
              {pickableFinished.map((league) => (
                <LeaguePickerRow
                  key={league.league_key}
                  league={league}
                  selected={selectedKeys.has(league.league_key)}
                  onToggle={() => onToggle(league.league_key)}
                  hex={hex}
                />
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onImport}
              disabled={selectedKeys.size === 0}
              className="flex-1 px-4 py-2 rounded-lg text-[12px] font-medium text-white  disabled:opacity-30 cursor-pointer"
              style={{
                background:
                  selectedKeys.size > 0 ? hex : "var(--color-base-300)",
              }}
            >
              Add Selected ({selectedKeys.size})
            </button>
            <button
              onClick={onSkip}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-fg-3 hover:text-fg-2 hover:bg-base-250/50  cursor-pointer"
            >
              Skip
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── League Picker Row ────────────────────────────────────────────

function LeaguePickerRow({
  league,
  selected,
  onToggle,
  hex,
}: {
  league: DiscoveredLeague;
  selected: boolean;
  onToggle: () => void;
  hex: string;
}) {
  const sport = sportLabel(league.game_code);

  return (
    <button
      onClick={onToggle}
      className={clsx(
        "w-full flex items-center gap-3 p-2.5 rounded-lg border  text-left cursor-pointer",
        selected
          ? "bg-base-250/40 border-edge/30"
          : "bg-base-250/15 border-edge/30 opacity-60",
      )}
      style={
        selected ? { borderColor: `${hex}30`, background: `${hex}10` } : {}
      }
    >
      <div
        className="h-4 w-4 rounded border flex items-center justify-center shrink-0 "
        style={
          selected
            ? { background: hex, borderColor: hex }
            : { borderColor: "var(--color-fg-3)" }
        }
      >
        {selected && <Check size={10} className="text-white" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold text-fg-2 truncate">
          {league.name}
        </p>
        <p className="text-[11px] text-fg-3">
          {sport} &middot; {league.num_teams} Teams &middot;{" "}
          {league.season}
        </p>
      </div>

      {!league.is_finished ? (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/10 border border-success/20">
          <span className="h-1 w-1 rounded-full bg-success " />
          <span className="text-[10px] font-bold text-success">Active</span>
        </span>
      ) : (
        <span className="text-[10px] font-mono text-fg-3">
          {league.season}
        </span>
      )}
    </button>
  );
}
