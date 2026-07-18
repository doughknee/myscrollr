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
 * Filter menu at narrow widths, counts in the rows) · freshness ·
 * favorite-team and time-window SelectMenus — all via useSportsConfig.
 * No league management: per-league widgets have an intrinsic league,
 * and coarse `sports` rows can't exist post-migration-000014.
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
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
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
      "Set your favorite team and time window from the top bar.",
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
              <SportsBarControls
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

// ── Bar controls (ex-gear: favorite team + time window) ─────────

/** Time-window choices — the old DayRangeControl presets. A stored
 *  custom range (its retired steppers) gets a synthetic row so the
 *  trigger never shows a value the menu doesn't contain. */
const WINDOW_OPTIONS: { value: string; label: string; back: number; ahead: number }[] = [
  { value: "0/0", label: "Today", back: 0, ahead: 0 },
  { value: "1/7", label: "This week", back: 1, ahead: 7 },
  { value: "7/7", label: "Everything", back: 7, ahead: 7 },
];

function SportsBarControls({
  channelType,
  league,
}: {
  channelType: string;
  league: string;
}) {
  const { display, favoriteTeams, setDisplay, setFavoriteTeam } =
    useSportsConfig(channelType);

  const favorite = favoriteTeams[league];
  // Fetched on feed mount now (the gear lazy-loaded on first open); the
  // list is small and TanStack caches it per league.
  const { data: teamsData, isLoading: teamsLoading } = useQuery(
    sportsTeamsOptions(league),
  );
  const teams: TeamInfo[] = useMemo(() => teamsData?.teams ?? [], [teamsData]);

  const teamOptions = useMemo(() => {
    const rows = [
      { value: "", label: teamsLoading ? "Loading teams…" : "No favorite" },
      ...teams.map((t) => ({ value: String(t.external_id), label: t.name })),
    ];
    // Stored favorite shows its saved name in the trigger before (or
    // without) the teams list loading.
    if (
      favorite &&
      !teams.some((t) => String(t.external_id) === String(favorite.teamId))
    ) {
      rows.push({ value: String(favorite.teamId), label: favorite.teamName });
    }
    return rows;
  }, [teams, teamsLoading, favorite]);

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

  const windowValue = `${display.daysBack}/${display.daysAhead}`;
  const windowOptions = WINDOW_OPTIONS.some((o) => o.value === windowValue)
    ? WINDOW_OPTIONS
    : [
        ...WINDOW_OPTIONS,
        {
          value: windowValue,
          label: `${display.daysBack}d back · ${display.daysAhead}d ahead`,
          back: display.daysBack,
          ahead: display.daysAhead,
        },
      ];

  return (
    <>
      <SelectMenu
        ariaLabel={`Favorite ${league} team`}
        prefix="Team"
        value={String(favorite?.teamId ?? "")}
        options={teamOptions}
        onChange={onPickTeam}
      />
      <SelectMenu
        ariaLabel="Time window"
        prefix="Window"
        value={windowValue}
        options={windowOptions}
        onChange={(v) => {
          const o = windowOptions.find((x) => x.value === v);
          if (o) setDisplay({ daysBack: o.back, daysAhead: o.ahead });
        }}
      />
    </>
  );
}
