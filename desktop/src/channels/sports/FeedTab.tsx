/**
 * Sports FeedTab — desktop-native.
 *
 * Tabbed container with Scores, Schedule, and Standings views.
 * Scores shows real-time game scoreboard cards via CDC/SSE.
 * Schedule filters upcoming pre-games by date.
 * Standings fetches league standings from the API.
 *
 * ONE Kalshi-style control bar (widget-bar primitives): Segmented
 * [Scores | Schedule | Standings] · status BarPills (collapsing into a
 * Filter menu at narrow widths, counts in the rows) · freshness · gear
 * popover. The gear IS the per-league Configure page: favorite team
 * (teams fetched on first open), day-range time window, logo/timer
 * toggles — all via useSportsConfig. No league management: per-league
 * widgets have an intrinsic league, and coarse `sports` rows can't
 * exist post-migration-000014.
 */
import { useState, useMemo, useRef, useCallback } from "react";
import { Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sportsFullQueryOptions, sportsTeamsOptions } from "../../api/queries";
import type { TeamInfo } from "../../api/queries";
import { useSportsConfig } from "../../hooks/useSportsConfig";
import { dataWidgetDef } from "../../marketplace";
import { ScoresTab } from "./ScoresTab";
import { ScheduleTab } from "./ScheduleTab";
import { StandingsTab } from "./StandingsTab";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar, BarDivider, BarPill } from "../../components/widget-bar/Bar";
import {
  useDismiss,
  MenuPanel,
  MenuHeading,
  MenuRow,
  FilterTrigger,
} from "../../components/widget-bar/Menu";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { GearMenu } from "../../components/widget-bar/GearMenu";
import { SelectRow } from "../../components/settings/SettingsControls";
import { DayRangeControl } from "../../components/TimeWindowControl";
import { SPORTS_WINDOW_MAX_DAYS } from "./view";
import { isLive, isPre, isFinal } from "../../utils/gameHelpers";
import { AnimatePresence } from "motion/react";
import type { FeedTabProps, ChannelManifest } from "../../types";
import type { FavoriteTeam } from "../../hooks/useSportsConfig";

// ── Channel manifest ─────────────────────────────────────────────

export const sportsChannel: ChannelManifest = {
  id: "sports",
  name: "Sports",
  tabLabel: "Sports",
  description: "Live scores and game updates",
  hex: "#f97316",
  icon: Trophy,
  info: {
    about:
      "Follow live scores across NFL, NBA, MLB, NHL, MLS, and more. " +
      "Scores update automatically with a visual flash when they change.",
    usage: [
      "Set your favorite team and time window from the gear menu.",
      "Live games show a pulsing indicator and scores update automatically.",
      "Final scores highlight the winning team in bold.",
    ],
  },
  FeedTab: SportsFeedTab,
};

// ── Types ────────────────────────────────────────────────────────

type SportsTab = "scores" | "schedule" | "standings";
export type StatusFilter = "all" | "live" | "upcoming" | "final";

const TAB_OPTIONS: SegmentedOption<SportsTab>[] = [
  { value: "scores", label: "Scores" },
  { value: "schedule", label: "Schedule" },
  { value: "standings", label: "Standings" },
];

// ── StatusFilter pills ───────────────────────────────────────────

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "final", label: "Final" },
];

// Per-league widgets are single-league by construction (and coarse
// `sports` rows can't exist post-migration-000014), so the old in-feed
// league filter is gone; the tab components still accept a set — always
// empty until their props get slimmed in the teardown pass.
const EMPTY_LEAGUE_FILTER = new Set<string>();

// ── Helper: build set of favorite team names ─────────────────────

function buildFavoriteSet(favorites: Record<string, FavoriteTeam>): Set<string> {
  const set = new Set<string>();
  for (const ft of Object.values(favorites)) {
    set.add(ft.teamName);
  }
  return set;
}

// ── FeedTab ──────────────────────────────────────────────────────

function SportsFeedTab({ mode, feedContext, widgetId }: FeedTabProps) {
  const [tab, setTab] = useState<SportsTab>("scores");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { leagues, display, favoriteTeams } = useSportsConfig(widgetId ?? "sports");
  const isComfort = mode === "comfort";

  // A per-league widget (sports_nfl) scopes the whole page to its one league:
  // its league is intrinsic, so we filter the shared /sports payload down.
  const scopedLeague = useMemo(() => {
    const l = widgetId ? dataWidgetDef(widgetId)?.addConfig?.leagues : undefined;
    return Array.isArray(l) && typeof l[0] === "string" ? (l[0] as string) : undefined;
  }, [widgetId]);

  // Full channel page reads from /sports directly (not /dashboard), which
  // returns every game for the user's selected leagues without per-league
  // fair-share capping. The bar's status pills narrow down by hand.
  const { data: sportsData } = useQuery(sportsFullQueryOptions());
  const games = useMemo(() => {
    const all = sportsData?.sports ?? [];
    return scopedLeague ? all.filter((g) => g.league === scopedLeague) : all;
  }, [sportsData?.sports, scopedLeague]);

  // Favorite team names as a Set for fast lookup
  const favoriteTeamNames = useMemo(
    () => buildFavoriteSet(favoriteTeams),
    [favoriteTeams],
  );

  // Most-recent update across all games — drives the FreshnessPill.
  const latestUpdated = useMemo(() => {
    let latest = 0;
    for (const g of games) {
      if (!g.updated_at) continue;
      const ts = new Date(g.updated_at).getTime();
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  }, [games]);

  // Status counts for the collapsed Filter menu rows.
  const statusCounts = useMemo(() => {
    let live = 0;
    let upcoming = 0;
    let final = 0;
    for (const g of games) {
      if (isLive(g)) live++;
      else if (isPre(g)) upcoming++;
      else if (isFinal(g)) final++;
    }
    return { all: games.length, live, upcoming, final };
  }, [games]);

  const showEmpty = games.length === 0 && leagues.length === 0;

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll — sticky pins against it.
    <div className="flex min-h-full flex-col">
      {isComfort && (
        <WidgetBar>
          <Segmented
            ariaLabel="Sports view"
            value={tab}
            onChange={setTab}
            options={TAB_OPTIONS}
          />

          {tab !== "standings" && !showEmpty && (
            <>
              <BarDivider />
              {/* Wide: open status pills. Collapse BEFORE clipping. */}
              <div className="scrollbar-none hidden min-w-0 items-center gap-1 overflow-x-auto @2xl:flex">
                {STATUS_OPTIONS.map((opt) => (
                  <BarPill
                    key={opt.value}
                    active={statusFilter === opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                  >
                    {opt.label}
                  </BarPill>
                ))}
              </div>
              {/* Narrow: status radios in one Filter menu (with counts). */}
              <div className="@2xl:hidden">
                <SportsFilterMenu
                  statusFilter={statusFilter}
                  onPickStatus={setStatusFilter}
                  counts={statusCounts}
                />
              </div>
            </>
          )}

          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            {tab !== "standings" && latestUpdated && (
              <span className="hidden @xl:block">
                <FreshnessPill lastUpdated={latestUpdated} label="score" />
              </span>
            )}
            {scopedLeague && (
              <SportsGear
                channelType={widgetId ?? "sports"}
                league={scopedLeague}
              />
            )}
          </div>
        </WidgetBar>
      )}

      {showEmpty ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyChannelState
            refreshing={Boolean(feedContext.__refreshing)}
            icon={Trophy}
            noun="leagues"
            hasConfig={!!feedContext.__hasConfig}
            dashboardLoaded={!!feedContext.__dashboardLoaded}
            loadingNoun="scores"
            actionHint="pick your leagues"
          />
        </div>
      ) : (
        <>
          {/* Tab content */}
          {tab === "scores" && (
            <ScoresTab
              games={games}
              mode={mode}
              display={display}
              favoriteTeams={favoriteTeamNames}
              leagueFilter={EMPTY_LEAGUE_FILTER}
              statusFilter={statusFilter}
            />
          )}
          {tab === "schedule" && (
            <ScheduleTab
              games={games}
              display={display}
              favoriteTeams={favoriteTeamNames}
              leagueFilter={EMPTY_LEAGUE_FILTER}
              statusFilter={statusFilter}
            />
          )}
          {tab === "standings" && (
            <StandingsTab
              leagues={leagues}
              favoriteTeams={favoriteTeamNames}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Filter menu (narrow-width collapse) ─────────────────────────

function SportsFilterMenu({
  statusFilter,
  onPickStatus,
  counts,
}: {
  statusFilter: StatusFilter;
  onPickStatus: (s: StatusFilter) => void;
  counts: { all: number; live: number; upcoming: number; final: number };
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    // NOT position:relative — the dropdown anchors to the sticky bar so
    // it spans the channel width instead of clipping at narrow widths.
    <div ref={rootRef} className="shrink-0 rounded-lg">
      <FilterTrigger
        open={open}
        badgeCount={statusFilter !== "all" ? 1 : 0}
        onClick={() => setOpen((o) => !o)}
      />
      <AnimatePresence>
        {open && (
          <MenuPanel className="inset-x-2">
            <MenuHeading>Status</MenuHeading>
            {STATUS_OPTIONS.map((opt) => (
              <MenuRow
                key={opt.value}
                selected={statusFilter === opt.value}
                onClick={() => onPickStatus(opt.value)}
                role="menuitemradio"
                count={counts[opt.value]}
              >
                {opt.label}
              </MenuRow>
            ))}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Gear popover (the per-league Configure page, in-widget) ─────

function SportsGear({
  channelType,
  league,
}: {
  channelType: string;
  league: string;
}) {
  return (
    <GearMenu ariaLabel="Sports settings" panelClassName="right-0 w-80">
      {/* Contents mount when the popover opens — the teams list is only
          fetched on first open, not on every feed visit. */}
      <SportsGearContents channelType={channelType} league={league} />
    </GearMenu>
  );
}

function SportsGearContents({
  channelType,
  league,
}: {
  channelType: string;
  league: string;
}) {
  const { display, favoriteTeams, setDisplay, setFavoriteTeam, saving } =
    useSportsConfig(channelType);

  const favorite = favoriteTeams[league];
  const { data: teamsData, isLoading: teamsLoading } = useQuery(
    sportsTeamsOptions(league),
  );
  const teams: TeamInfo[] = useMemo(() => teamsData?.teams ?? [], [teamsData]);

  const teamOptions = useMemo(
    () => [
      { value: "", label: teamsLoading ? "Loading teams…" : "No favorite" },
      ...teams.map((t) => ({ value: String(t.external_id), label: t.name })),
    ],
    [teams, teamsLoading],
  );

  const onPickTeam = useCallback(
    (id: string) => {
      if (!id) {
        setFavoriteTeam(league, null);
        return;
      }
      const t = teams.find((x) => String(x.external_id) === id);
      if (t) setFavoriteTeam(league, { teamId: t.external_id, teamName: t.name });
    },
    [teams, league, setFavoriteTeam],
  );

  return (
    <>
      <MenuHeading>Favorite {league} team</MenuHeading>
      <SelectRow
        label="Team"
        description="Sorts to the top with a highlight"
        value={String(favorite?.teamId ?? "")}
        options={teamOptions}
        onChange={onPickTeam}
      />
      <MenuHeading>Time window</MenuHeading>
      <div className="px-1 pb-1">
        <DayRangeControl
          daysBack={display.daysBack}
          daysAhead={display.daysAhead}
          max={SPORTS_WINDOW_MAX_DAYS}
          disabled={saving}
          onChange={(next) => setDisplay(next)}
        />
      </div>
    </>
  );
}
