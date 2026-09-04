/**
 * Sports FeedTab — desktop-native.
 *
 * Tabbed container with Scores, Schedule, and Standings views.
 * Scores shows real-time game scoreboard cards via CDC/SSE.
 * Schedule filters upcoming pre-games by date.
 * Standings fetches league standings from the API.
 *
 * ONE Kalshi-style control bar (widget-bar primitives): Segmented
 * [Scores | Schedule | Standings] · freshness · favorite-team and
 * time-window SelectMenus — all via useSportsConfig.
 * No league management: per-league widgets have an intrinsic league,
 * and coarse `sports` rows can't exist post-migration-000014.
 */
import { useState, useMemo, useCallback } from "react";
import { Trophy, CalendarRange } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sportsFullQueryOptions, sportsTeamsOptions } from "../../api/queries";
import type { TeamInfo } from "../../api/queries";
import { useSportsConfig } from "../../hooks/useSportsConfig";
import { useCatalog } from "../../hooks/useCatalog";
import { addConfigForWidget } from "../../marketplace";
import { ScoresTab } from "./ScoresTab";
import { ScheduleTab } from "./ScheduleTab";
import { StandingsTab } from "./StandingsTab";
import EmptyWidgetState from "../../components/EmptyWidgetState";
import WidgetStateTransition from "../../components/WidgetStateTransition";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import { latestTimestamp } from "../feedHooks";
import type { FeedTabProps, DataWidgetManifest } from "../../types";
import type { FavoriteTeam } from "../../hooks/useSportsConfig";
import { SportsHomeRows, sportsHighlight } from "./home";

// ── DataWidgetRow manifest ─────────────────────────────────────────────

export const sportsDataWidget: DataWidgetManifest = {
  id: "sports",
  name: "Sports",
  tabLabel: "Sports",
  description: "Live scores and game updates",
  hex: "#f97316",
  icon: Trophy,
  info: {
    about:
      "Follow live scores across NFL, NBA, MLB, NHL, MLS, and more. " +
      "Scores update automatically when they change.",
    usage: [
      "Set your favorite team and time window from the top bar.",
      "Live games show a status indicator and scores update automatically.",
      "Final scores highlight the winning team in bold.",
    ],
  },
  FeedTab: SportsFeedTab,
  HomeRows: SportsHomeRows,
  highlight: sportsHighlight,
};

// ── Types ────────────────────────────────────────────────────────

type SportsTab = "scores" | "schedule" | "standings";

const TAB_OPTIONS: SegmentedOption<SportsTab>[] = [
  { value: "scores", label: "Scores" },
  { value: "schedule", label: "Schedule" },
  { value: "standings", label: "Standings" },
];

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
  const { leagues, display, favoriteTeams } = useSportsConfig(widgetId ?? "sports");
  const isComfort = mode === "comfort";

  // A per-league widget (sports_nfl) scopes the whole page to its one league:
  // its league is intrinsic, so we filter the shared /sports payload down.
  const catalogVersion = useCatalog();
  const scopedLeague = useMemo(() => {
    const l = widgetId ? addConfigForWidget(widgetId)?.leagues : undefined;
    return Array.isArray(l) && typeof l[0] === "string" ? (l[0] as string) : undefined;
  }, [widgetId, catalogVersion]);

  // Full widget page reads from /sports directly (not /dashboard), which
  // returns every game for the user's selected leagues without per-league
  // fair-share capping.
  const { data: sportsData } = useQuery(sportsFullQueryOptions());
  const games = useMemo(() => {
    const all = sportsData?.sports ?? [];
    return scopedLeague ? all.filter((g) => g.league === scopedLeague) : all;
  }, [sportsData?.sports, scopedLeague]);

  // Scoped the same way the games are: on /widget/sports_mls the empty
  // state must speak about MLS, not about every league the user follows.
  const leagueMeta = useMemo(() => {
    const all = sportsData?.meta?.leagues ?? [];
    return scopedLeague ? all.filter((l) => l.name === scopedLeague) : all;
  }, [sportsData?.meta?.leagues, scopedLeague]);

  // Favorite team names as a Set for fast lookup
  const favoriteTeamNames = useMemo(
    () => buildFavoriteSet(favoriteTeams),
    [favoriteTeams],
  );

  const latestUpdated = useMemo(
    () => latestTimestamp(games, (g) => g.updated_at),
    [games],
  );

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

          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            {tab !== "standings" && latestUpdated && (
              <span className="hidden @xl:block">
                <FreshnessPill lastUpdated={latestUpdated} label="score" />
              </span>
            )}
            {scopedLeague && (
              <SportsBarControls
                widgetType={widgetId ?? "sports"}
                league={scopedLeague}
              />
            )}
          </div>
        </WidgetBar>
      )}

      <WidgetStateTransition stateKey={`tab-${tab}`}>
        {showEmpty ? (
          <div className="flex flex-1 flex-col justify-center">
            <EmptyWidgetState
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
                showLeagueHeaders={!scopedLeague}
                leagueMeta={leagueMeta}
              />
            )}
            {tab === "schedule" && (
              <ScheduleTab
                games={games}
                favoriteTeams={favoriteTeamNames}
                leagueMeta={leagueMeta}
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
      </WidgetStateTransition>
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
  // 365 ahead, not 7. Forward fixtures are never pruned, so this is
  // "everything the server holds" -- and at 7 an F1 or Champions League
  // user could not reach their next fixture from any preset at all.
  { value: "7/365", label: "Everything", back: 7, ahead: 365 },
];

function SportsBarControls({
  widgetType,
  league,
}: {
  widgetType: string;
  league: string;
}) {
  const { display, favoriteTeams, setDisplay, setFavoriteTeam } =
    useSportsConfig(widgetType);

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
        icon={CalendarRange}
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
