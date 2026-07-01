import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Star, X } from "lucide-react";
import LeagueManager from "./LeagueManager";
import { useSportsConfig } from "../../hooks/useSportsConfig";
import { sportsCatalogOptions, sportsTeamsOptions } from "../../api/queries";
import type { TeamInfo } from "../../api/queries";
import { getLimit } from "../../tierLimits";
import { dataWidgetDef } from "../../marketplace";
import type { Venue } from "../../preferences";
import type { Channel } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface SportsConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

// The single fixed league for a sports widget. The channel config (set on add)
// is the source of truth; fall back to the marketplace definition.
function widgetLeague(channel: Channel): string | undefined {
  const cfg = (channel.config ?? {}) as { leagues?: unknown };
  if (Array.isArray(cfg.leagues) && typeof cfg.leagues[0] === "string") {
    return cfg.leagues[0];
  }
  const defLeagues = dataWidgetDef(channel.channel_type)?.addConfig?.leagues;
  if (Array.isArray(defLeagues) && typeof defLeagues[0] === "string") {
    return defLeagues[0];
  }
  return undefined;
}

// ── Dispatch ─────────────────────────────────────────────────────

export default function SportsConfigPanel({
  channel,
  subscriptionTier,
  hex,
}: SportsConfigPanelProps) {
  const league = widgetLeague(channel);

  // A per-league widget (sports_nfl, …) gets a tailored page: its league is
  // intrinsic, so no league picker — just the favorite team + display. A legacy
  // coarse "sports" channel keeps the full league manager.
  if (league && channel.channel_type !== "sports") {
    return (
      <SportsWidgetConfig
        channelType={channel.channel_type}
        league={league}
        hex={hex}
      />
    );
  }
  return <LegacySportsConfig subscriptionTier={subscriptionTier} />;
}

// ── Per-widget config (favorite team + display) ──────────────────

function SportsWidgetConfig({
  channelType,
  league,
  hex,
}: {
  channelType: string;
  league: string;
  hex: string;
}) {
  const { display, favoriteTeams, setDisplay, setFavoriteTeam, saving } =
    useSportsConfig(channelType);

  const favorite = favoriteTeams[league];
  const { data: teamsData, isLoading: teamsLoading } = useQuery(
    sportsTeamsOptions(league),
  );
  const teams: TeamInfo[] = useMemo(() => teamsData?.teams ?? [], [teamsData]);

  const onPickTeam = useCallback(
    (id: number) => {
      if (!id) {
        setFavoriteTeam(league, null);
        return;
      }
      const t = teams.find((x) => x.external_id === id);
      if (t) setFavoriteTeam(league, { teamId: t.external_id, teamName: t.name });
    },
    [teams, league, setFavoriteTeam],
  );

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-7 pt-1">
      {/* Favorite team */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Star size={14} style={{ color: hex }} />
          <h3 className="text-sm font-semibold text-fg">Favorite {league} team</h3>
        </div>
        <p className="text-ui-meta text-fg-3">
          Your team's games sort to the top and get a highlight.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={favorite?.teamId ?? ""}
            disabled={saving || teamsLoading || teams.length === 0}
            onChange={(e) => onPickTeam(Number(e.target.value))}
            className="flex-1 px-3 py-2 rounded-lg bg-base-200 border border-edge/40 text-ui-body text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            <option value="">
              {teamsLoading ? "Loading teams…" : "No favorite"}
            </option>
            {teams.map((t) => (
              <option key={t.external_id} value={t.external_id}>
                {t.name}
              </option>
            ))}
          </select>
          {favorite && (
            <button
              onClick={() => setFavoriteTeam(league, null)}
              disabled={saving}
              aria-label="Clear favorite team"
              className="p-2 rounded-lg text-fg-3 hover:text-fg-1 hover:bg-base-200/70 transition-colors disabled:opacity-40"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </section>

      {/* Display */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">Display</h3>
        <DisplayToggle
          label="Upcoming games"
          hint="Show games that haven't started yet"
          value={display.showUpcoming}
          onChange={(v) => setDisplay({ showUpcoming: v })}
        />
        <DisplayToggle
          label="Final scores"
          hint="Keep completed games in the feed"
          value={display.showFinal}
          onChange={(v) => setDisplay({ showFinal: v })}
        />
        <DisplayToggle
          label="Team logos"
          value={display.showLogos}
          onChange={(v) => setDisplay({ showLogos: v })}
        />
        <DisplayToggle
          label="Game timer"
          hint="Show the live clock / countdown"
          value={display.showTimer}
          onChange={(v) => setDisplay({ showTimer: v })}
        />
      </section>
    </div>
  );
}

// A display element's venue collapsed to an on/off switch (on = "both",
// off = "off"). Venue granularity (feed-only vs ticker-only) isn't exposed
// per-widget — the toggle is the simple, legible control.
function DisplayToggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Venue;
  onChange: (v: Venue) => void;
}) {
  const on = value !== "off";
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-edge/40 bg-base-150/30">
      <div className="min-w-0">
        <div className="text-ui-body text-fg-2">{label}</div>
        {hint && <div className="text-ui-meta text-fg-4">{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(on ? "off" : "both")}
        className={clsx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-accent" : "bg-base-300",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            on ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ── Legacy coarse "sports" channel — full league manager ─────────

function LegacySportsConfig({
  subscriptionTier,
}: {
  subscriptionTier: SubscriptionTier;
}) {
  const { leagues, setLeagues, favoriteTeams, setFavoriteTeam, saving } =
    useSportsConfig();

  const leagueSet = useMemo(() => new Set(leagues), [leagues]);
  const maxLeagues = getLimit(subscriptionTier, "leagues");

  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(sportsCatalogOptions());

  const addLeague = useCallback(
    (name: string) => {
      if (leagueSet.has(name)) return;
      if (leagues.length >= maxLeagues) return;
      setLeagues([...leagues, name]);
    },
    [leagues, leagueSet, setLeagues, maxLeagues],
  );

  const removeLeague = useCallback(
    (name: string) => setLeagues(leagues.filter((l) => l !== name)),
    [leagues, setLeagues],
  );

  return (
    <div className="w-full max-w-2xl mx-auto h-full flex flex-col min-h-0 gap-3 pt-1">
      <div className="flex-1 min-h-0">
        <LeagueManager
          leagues={leagues}
          catalog={catalog}
          favoriteTeams={favoriteTeams}
          onAdd={addLeague}
          onRemove={removeLeague}
          onSetFavoriteTeam={setFavoriteTeam}
          loading={catalogLoading}
          error={catalogError}
          maxLeagues={maxLeagues}
          subscriptionTier={subscriptionTier}
          saving={saving}
        />
      </div>
    </div>
  );
}
