/**
 * ConnectedView — the management surface for an already-connected Yahoo
 * user. This panel is deliberately quiet: no live scores, no matchup
 * cards, no roster drill-downs. All of that lives in the Feed tab.
 *
 * What the user manages here:
 *   - Pick a primary league (hero treatment in the Feed).
 *   - Enable/disable visibility of individual leagues.
 *   - Reorder by activity.
 *   - Add more leagues (re-run discovery).
 *   - Disconnect.
 */
import { useCallback, useMemo, useState } from "react";
import { clsx } from "clsx";
import { open } from "@tauri-apps/plugin-shell";
import { Eye, EyeOff, Plus, Star } from "lucide-react";
import {
  Section,
  DisplayRow,
  ActionRow,
  SegmentedRow,
  ToggleRow,
  Badge,
} from "../../components/settings/SettingsControls";
import { shouldShowOnTicker } from "../../preferences";
import type { FantasyDisplayPrefs, FantasyTickerMode } from "../../preferences";
import { fantasyTickerSource } from "./ticker";
import type { TickerContext } from "../ticker";
import { useShell } from "../../shell-context";
import { SPORT_EMOJI, sportLabel } from "./types";
import type { LeagueResponse } from "./types";

interface ConnectedViewProps {
  leagues: LeagueResponse[];
  yahooConnected: boolean;
  hex: string;
  /** Discovery ran but Yahoo returned zero leagues for this account. */
  noLeaguesFound: boolean;
  onStartDiscovery: () => void;
  onDisconnect: () => void;
}

export function ConnectedView({
  leagues,
  yahooConnected,
  hex,
  noLeaguesFound,
  onStartDiscovery,
  onDisconnect,
}: ConnectedViewProps) {
  const { prefs, onPrefsChange } = useShell();
  const fantasyPrefs = prefs.widgetDisplay.fantasy;

  const [filter, setFilter] = useState<"all" | "active" | "past">("all");

  const sorted = useMemo(() => {
    return [...leagues].sort((a, b) => {
      // Active first, then by season desc, then by name.
      if (a.data.is_finished !== b.data.is_finished) {
        return a.data.is_finished ? 1 : -1;
      }
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return a.name.localeCompare(b.name);
    });
  }, [leagues]);

  const activeCount = sorted.filter((l) => !l.data.is_finished).length;
  const pastCount = sorted.filter((l) => l.data.is_finished).length;
  const filtered = useMemo(() => {
    if (filter === "active") return sorted.filter((l) => !l.data.is_finished);
    if (filter === "past") return sorted.filter((l) => l.data.is_finished);
    return sorted;
  }, [sorted, filter]);
  const enabledSet = useMemo(() => {
    // Empty enabled list means "all" — reflect that as a fully-enabled state.
    if (
      !fantasyPrefs.enabledLeagueKeys ||
      fantasyPrefs.enabledLeagueKeys.length === 0
    ) {
      return new Set(leagues.map((l) => l.league_key));
    }
    return new Set(fantasyPrefs.enabledLeagueKeys);
  }, [fantasyPrefs.enabledLeagueKeys, leagues]);

  const updatePrefs = useCallback(
    (patch: Partial<typeof fantasyPrefs>) => {
      onPrefsChange({
        ...prefs,
        widgetDisplay: {
          ...prefs.widgetDisplay,
          fantasy: { ...fantasyPrefs, ...patch },
        },
      });
    },
    [prefs, fantasyPrefs, onPrefsChange],
  );

  const toggleLeagueVisibility = useCallback(
    (key: string) => {
      const next = new Set(enabledSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // If every league is enabled we store [] to mean "all".
      const fullSet = next.size === leagues.length;
      updatePrefs({
        enabledLeagueKeys: fullSet ? [] : Array.from(next),
      });
    },
    [enabledSet, leagues.length, updatePrefs],
  );

  const setPrimary = useCallback(
    (key: string | null) => {
      updatePrefs({
        primaryLeagueKey: key === fantasyPrefs.primaryLeagueKey ? null : key,
      });
    },
    [fantasyPrefs.primaryLeagueKey, updatePrefs],
  );

  return (
    <>
      {/* Overview */}
      {leagues.length > 0 && (
        <Section title="Overview">
          <DisplayRow label="Imported leagues" value={String(leagues.length)} />
          <DisplayRow label="Active this season" value={String(activeCount)} />
          {pastCount > 0 && (
            <DisplayRow label="Finished / past" value={String(pastCount)} />
          )}
        </Section>
      )}

      {/* League management */}
      {leagues.length > 0 && (
        <Section title="Your Leagues">
          <div className="px-3">
            <FilterBar
              filter={filter}
              onChange={setFilter}
              counts={{
                all: sorted.length,
                active: activeCount,
                past: pastCount,
              }}
            />
          </div>

          <div className="mt-2 space-y-1 px-3">
            {filtered.map((league) => (
              <div key={league.league_key}>
                <LeagueManagementRow
                  league={league}
                  enabled={enabledSet.has(league.league_key)}
                  isPrimary={
                    fantasyPrefs.primaryLeagueKey === league.league_key
                  }
                  onToggleEnabled={() =>
                    toggleLeagueVisibility(league.league_key)
                  }
                  onSetPrimary={() => setPrimary(league.league_key)}
                  hex={hex}
                />
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="py-6 text-center text-[11px] text-fg-3">
                No leagues match this filter.
              </p>
            )}
          </div>
        </Section>
      )}

      {/* Connected but no leagues */}
      {yahooConnected && leagues.length === 0 && (
        <div className="space-y-3 px-3 py-8 text-center">
          {noLeaguesFound ? (
            <>
              <p className="text-sm font-medium text-fg-2">
                No Fantasy Leagues Found
              </p>
              <p className="mx-auto max-w-xs text-[12px] text-fg-3">
                Your Yahoo account doesn&rsquo;t have any Fantasy Sports
                leagues. Join or create a league on Yahoo, then come back and
                search again.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    open("https://football.fantasysports.yahoo.com")
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-edge/30 px-4 py-2 text-[12px] font-medium text-fg-3  hover:border-edge/50 hover:text-fg-2 cursor-pointer"
                >
                  Go to Yahoo Fantasy
                </button>
                <button
                  type="button"
                  onClick={onStartDiscovery}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium text-white  cursor-pointer"
                  style={{ background: hex }}
                >
                  Search Again
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[12px] text-fg-3">
                Yahoo account connected — no leagues added yet
              </p>
              <button
                type="button"
                onClick={onStartDiscovery}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium text-white  cursor-pointer"
                style={{ background: hex }}
              >
                <Plus size={14} />
                Find Leagues
              </button>
            </>
          )}
        </div>
      )}

      {/* Ticker controls */}
      {yahooConnected && leagues.length > 0 && (
        <TickerSection
          leagues={leagues}
          prefs={fantasyPrefs}
          onPatch={updatePrefs}
        />
      )}

      {/* Account actions */}
      {yahooConnected && (
        <Section title="Account">
          <ActionRow
            label="Add more leagues"
            description="Find and import new Yahoo Fantasy leagues"
            action="Find Leagues"
            onClick={onStartDiscovery}
          />
          <ActionRow
            label="Disconnect Yahoo"
            description="Remove your Yahoo account link and clear imported leagues"
            action="Disconnect"
            tone="error"
            onClick={onDisconnect}
          />
        </Section>
      )}
    </>
  );
}

// ── Ticker section ───────────────────────────────────────────────

/**
 * The control story: show what the ticker looks like right now, then
 * one dial that changes it.
 *
 * The preview is not a mock-up of chips — it calls the real ticker
 * source with the real leagues and renders whatever comes back. That's
 * the whole point: a preview that can disagree with the ticker is worse
 * than no preview, and this one cannot, because it IS the ticker's
 * output.
 */
function TickerSection({
  leagues,
  prefs,
  onPatch,
}: {
  leagues: LeagueResponse[];
  prefs: FantasyDisplayPrefs;
  onPatch: (patch: Partial<FantasyDisplayPrefs>) => void;
}) {
  const mode = prefs.tickerMode ?? "everything";
  const everything = mode === "everything";

  const chips = useMemo(
    () =>
      fantasyTickerSource.chips({ leagues }, {
        widgetDisplay: { fantasy: prefs } as TickerContext["widgetDisplay"],
        comfort: false,
        chipColorMode: "widget",
      } as TickerContext),
    [leagues, prefs],
  );

  const followed = prefs.followedPlayerKeys ?? [];
  const followedNames = useMemo(
    () => followed.map((k) => playerName(leagues, k)).filter(Boolean),
    [followed, leagues],
  );

  return (
    <Section title="Ticker">
      {/* Preview */}
      <div className="px-3 pb-1 pt-2">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-fg-4">
            Preview — right now
          </span>
          <span className="font-mono text-[11px] text-fg-4">
            {chips.length} chip{chips.length === 1 ? "" : "s"} ·{" "}
            {MODE_CAPTION[mode]}
          </span>
        </div>
        {/* Wrapped rather than a single scrolling rail, because the
            point of the preview is to show what a mode COSTS — hiding
            two thirds of Everything behind a clipped edge would make
            the expensive setting look as cheap as the calm one.

            But it can't own the panel either: Everything emits ~24
            chips, which unbounded is ten rows of wrap. So it's capped
            at roughly four rows and scrolls past that, and scaled down
            slightly — these are ticker chips being shown at desk
            distance inside a settings card, not on a bar across the
            top of a monitor. */}
        <div
          className="max-h-[168px] overflow-y-auto overflow-x-hidden rounded-lg bg-surface-2 p-2"
          style={{ zoom: 0.9 }}
        >
          <div className="flex min-h-[30px] flex-wrap content-start items-center gap-1.5">
            {chips.length === 0 ? (
              <span className="font-mono text-[12px] text-fg-4">
                Nothing on the ticker right now.
              </span>
            ) : (
              // min-w-0 lets an over-wide chip shrink here even though
              // chipBaseClasses pins shrink-0 for the real rail, where
              // a compressed chip would be unreadable and there's
              // infinite horizontal room anyway.
              chips.map((c) => (
                <div key={c.key} className="min-w-0 max-w-full [&>*]:shrink">
                  {c.node}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <SegmentedRow<FantasyTickerMode>
        label="What shows on the ticker"
        description="One setting — the rail adapts through the week on its own."
        value={mode}
        options={[
          { value: "essential", label: "Essential" },
          { value: "standard", label: "Standard" },
          { value: "everything", label: "Everything" },
        ]}
        onChange={(tickerMode) => onPatch({ tickerMode })}
      />

      <DisplayRow
        label="Followed players"
        value={
          followedNames.length > 0
            ? `Always on the rail — ${followedNames.join(", ")}`
            : "None yet"
        }
      />

      {/* Advanced — only meaningful in Everything, and disabled rather
          than hidden so the dial's consequence is visible. */}
      <div
        className={clsx(
          "transition-none",
          !everything && "pointer-events-none opacity-45",
        )}
        aria-hidden={!everything}
      >
        <div className="px-3 pb-1 pt-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
              Advanced — ticker items
            </span>
            <Badge>Everything only</Badge>
          </div>
          <p className="mt-1 text-[11px] text-fg-4">
            The feed always shows everything — these only control what joins the
            ticker.
          </p>
        </div>
        {ADVANCED_ITEMS.map(({ key, label }) => (
          <ToggleRow
            key={key}
            label={label}
            checked={shouldShowOnTicker(prefs[key])}
            // Toggles, not Off/Feed/Ticker segments: feed content is
            // never gated, so OFF means "feed only", never "gone".
            onChange={(on) => onPatch({ [key]: on ? "both" : "feed" })}
          />
        ))}
      </div>
    </Section>
  );
}

const MODE_CAPTION: Record<FantasyTickerMode, string> = {
  essential: "one per league",
  standard: "+ live moments",
  everything: "everything, always",
};

/** The venue prefs the Advanced block exposes, in the handoff's order. */
const ADVANCED_ITEMS: Array<{
  key: keyof FantasyDisplayPrefs & VenueKey;
  label: string;
}> = [
  { key: "matchupScore", label: "Matchup score" },
  { key: "winProbability", label: "Win probability" },
  { key: "projectedPoints", label: "Projected points" },
  { key: "topThreeScorers", label: "Top 3 scorers" },
  { key: "worstStarter", label: "Worst starter" },
  { key: "injuryDetail", label: "Injury report" },
];

type VenueKey =
  | "matchupScore"
  | "winProbability"
  | "projectedPoints"
  | "topThreeScorers"
  | "worstStarter"
  | "injuryDetail";

function playerName(leagues: LeagueResponse[], playerKey: string): string {
  for (const l of leagues) {
    for (const r of l.rosters ?? []) {
      const p = r.data.players.find((x) => x.player_key === playerKey);
      if (p) return p.name.last || p.name.full;
    }
  }
  return "";
}

// ── Filter bar ───────────────────────────────────────────────────

function FilterBar({
  filter,
  counts,
  onChange,
}: {
  filter: "all" | "active" | "past";
  counts: { all: number; active: number; past: number };
  onChange: (filter: "all" | "active" | "past") => void;
}) {
  const options: {
    value: "all" | "active" | "past";
    label: string;
    count: number;
  }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "active", label: "Active", count: counts.active },
    { value: "past", label: "Past", count: counts.past },
  ];
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => {
        const active = filter === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={opt.count === 0 && opt.value !== "all"}
            className={clsx(
              "rounded-md px-2 py-1 text-[11px] font-medium  cursor-pointer",
              active
                ? "bg-accent/15 text-accent"
                : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
              opt.count === 0 &&
                opt.value !== "all" &&
                "cursor-not-allowed opacity-40",
            )}
          >
            {opt.label}{" "}
            <span className="ml-1 font-mono text-fg-4">{opt.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

function LeagueManagementRow({
  league,
  enabled,
  isPrimary,
  onToggleEnabled,
  onSetPrimary,
  hex,
}: {
  league: LeagueResponse;
  enabled: boolean;
  isPrimary: boolean;
  onToggleEnabled: () => void;
  onSetPrimary: () => void;
  hex: string;
}) {
  const isFinished = league.data.is_finished;
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-lg border px-3 py-2 ",
        isPrimary
          ? "border-accent/40 bg-accent/[0.04]"
          : "border-edge/40 bg-surface hover:bg-surface-2",
        !enabled && "opacity-65",
      )}
    >
      <span aria-hidden className="text-[14px]">
        {SPORT_EMOJI[league.game_code] ?? "🏆"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </span>
          {isPrimary && (
            <span className="rounded-full bg-accent/20 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-wider text-accent">
              Primary
            </span>
          )}
          {isFinished && (
            <span className="rounded-full border border-edge/50 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-wider text-fg-3">
              Finished
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-3">
          {sportLabel(league.game_code)} · {league.data.num_teams} teams ·{" "}
          {league.season}
        </div>
      </div>

      <IconButton
        label={isPrimary ? "Clear primary" : "Set as primary league"}
        onClick={onSetPrimary}
        active={isPrimary}
        color={hex}
      >
        <Star size={13} className={isPrimary ? "fill-current" : ""} />
      </IconButton>
      <IconButton
        label={enabled ? "Hide from Feed" : "Show in Feed"}
        onClick={onToggleEnabled}
        active={enabled}
        color={hex}
      >
        {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active,
  color,
  children,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border  cursor-pointer",
        active
          ? "border-transparent text-white"
          : "border-edge/40 text-fg-3 hover:text-fg",
      )}
      style={
        active
          ? { background: `${color}30`, color, borderColor: `${color}60` }
          : undefined
      }
    >
      {children}
    </button>
  );
}
