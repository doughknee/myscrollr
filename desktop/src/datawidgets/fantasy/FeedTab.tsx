/**
 * Fantasy FeedTab — redesigned as a multi-view consumption experience.
 *
 * Organized around the rituals of a fantasy season:
 *   - Overview: multi-league weekly scorecard + primary league hero
 *   - Matchup:  live head-to-head with starting lineups
 *   - Standings: playoff-aware standings for the primary league
 *   - Roster:   user's (or any team's) roster with injury spotlight
 *
 * ONE Kalshi-style control bar (widget-bar primitives): Segmented
 * sub-tabs (sticky — picking one is the default view) · league
 * SelectMenu (emoji + name, ★ primary, live dot; hidden on Overview /
 * single league) · "N live" pulse · Account pill. The Yahoo
 * OAuth/import wizard (YahooConnectFlow) mounts IN-FEED — as the whole
 * feed when nothing is connected, or via the Account pill; primary and
 * enabled leagues are managed there (ConnectedView).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  LayoutGrid,
  Star,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "../../api/queries";
import { useShell } from "../../shell-context";
import EmptyWidgetState from "../../components/EmptyWidgetState";
import WidgetStateTransition from "../../components/WidgetStateTransition";
import { WidgetBar, BarPill } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import { OverviewView } from "./OverviewView";
import { MatchupView } from "./MatchupView";
import { StandingsView } from "./StandingsView";
import { RosterView } from "./RosterView";
import YahooConnectFlow from "./YahooConnectFlow";
import {
  SPORT_EMOJI,
  isMatchupLive,
  userMatchupContext,
} from "./types";
import { filterEnabledLeagues, resolvePrimaryLeague } from "./view";
import type { FeedTabProps, DataWidgetManifest } from "../../types";
import type { FantasySubTab } from "../../preferences";
import type { LeagueResponse, MyLeaguesResponse } from "./types";
import {
  FantasyHomeRows,
  normalizeFantasyHome,
} from "./home";

/** DataWidgetRow accent — kept in sync with `fantasyDataWidget.hex`. */
const FANTASY_HEX = "#6366f1";

// ── DataWidgetRow manifest ─────────────────────────────────────────────

export const fantasyDataWidget: DataWidgetManifest = {
  id: "fantasy",
  name: "Fantasy",
  tabLabel: "Fantasy",
  description: "Yahoo Fantasy Sports leagues",
  hex: "#6366f1",
  icon: Swords,
  info: {
    about:
      "Live matchups, playoff-aware standings, and roster intel for all of " +
      "your Yahoo Fantasy leagues. Scores, injuries, and seedings update in " +
      "near real time as games play out.",
    usage: [
      "Connect Yahoo from the Account pill in the top bar to import your leagues.",
      "Pick a primary league to surface as the hero view.",
      "Flip between Overview, Matchup, Standings, and Roster to manage your teams.",
    ],
  },
  FeedTab: FantasyFeedTab,
  HomeRows: FantasyHomeRows,
  normalizeHome: normalizeFantasyHome,
};

// ── Helpers ──────────────────────────────────────────────────────

function extractLeagues(data: unknown): LeagueResponse[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const resp = data as MyLeaguesResponse;
    return resp.leagues ?? [];
  }
  if (Array.isArray(data)) return data as LeagueResponse[];
  return [];
}

const SUB_TABS: SegmentedOption<FantasySubTab>[] = [
  { value: "overview", label: "Overview", icon: LayoutGrid },
  { value: "matchup", label: "Matchup", icon: Swords },
  { value: "standings", label: "Standings", icon: Trophy },
  { value: "roster", label: "Roster", icon: Users },
];

// ── FeedTab ──────────────────────────────────────────────────────

function FantasyFeedTab({ mode, feedContext }: FeedTabProps) {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.widgetDisplay.fantasy;
  const isComfort = mode === "comfort";

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const fantasyData = dashboard?.data?.fantasy;
  const leagues = useMemo(() => extractLeagues(fantasyData), [fantasyData]);

  // Apply the user's per-league visibility filter: empty = show all.
  // Shared with the ticker via `filterEnabledLeagues`.
  const visibleLeagues = useMemo(
    () => filterEnabledLeagues(leagues, dp.enabledLeagueKeys),
    [leagues, dp.enabledLeagueKeys],
  );

  // Resolve the "primary" league — user override, else first active, else first.
  // Shared with the ticker via `resolvePrimaryLeague`.
  const primaryLeague = useMemo(
    () => resolvePrimaryLeague(visibleLeagues, dp.primaryLeagueKey),
    [visibleLeagues, dp.primaryLeagueKey],
  );

  // Current league the sub-views render against. Defaults to primary.
  const [activeLeagueKey, setActiveLeagueKey] = useState<string | null>(
    primaryLeague?.league_key ?? null,
  );
  useEffect(() => {
    if (!activeLeagueKey && primaryLeague) {
      setActiveLeagueKey(primaryLeague.league_key);
    } else if (
      activeLeagueKey &&
      !visibleLeagues.some((l) => l.league_key === activeLeagueKey)
    ) {
      setActiveLeagueKey(primaryLeague?.league_key ?? null);
    }
  }, [activeLeagueKey, primaryLeague, visibleLeagues]);

  const activeLeague = useMemo(
    () =>
      activeLeagueKey
        ? visibleLeagues.find((l) => l.league_key === activeLeagueKey) ?? null
        : primaryLeague,
    [activeLeagueKey, visibleLeagues, primaryLeague],
  );

  const [subTab, setSubTab] = useState<FantasySubTab>(() => {
    if (dp.defaultSubTab) return dp.defaultSubTab;
    return visibleLeagues.length > 1 ? "overview" : "matchup";
  });

  const handleOpenMatchup = useCallback(() => setSubTab("matchup"), []);
  const handleSelectLeague = useCallback((key: string) => {
    setActiveLeagueKey(key);
    setSubTab("matchup");
  }, []);

  // Account view (the Yahoo OAuth/import wizard) — opened from the bar.
  const [accountOpen, setAccountOpen] = useState(false);
  // Sticky sub-tab: the pick IS the default view (the gear's explicit
  // "Default view" radios are gone).
  const pickSubTab = useCallback(
    (t: FantasySubTab) => {
      setSubTab(t);
      setAccountOpen(false);
      onPrefsChange({
        ...prefs,
        widgetDisplay: {
          ...prefs.widgetDisplay,
          fantasy: { ...prefs.widgetDisplay.fantasy, defaultSubTab: t },
        },
      });
    },
    [prefs, onPrefsChange],
  );

  const enableAllLeagues = useCallback(() => {
    onPrefsChange({
      ...prefs,
      widgetDisplay: {
        ...prefs.widgetDisplay,
        fantasy: { ...prefs.widgetDisplay.fantasy, enabledLeagueKeys: [] },
      },
    });
  }, [prefs, onPrefsChange]);

  // League options for the bar's SelectMenu — emoji + name, ★ on the
  // primary, live dot on leagues with a live matchup.
  const leagueOptions = useMemo(
    () =>
      visibleLeagues.map((l) => {
        const ctx = userMatchupContext(l);
        const live = ctx && isMatchupLive(ctx.matchup);
        const isPrimary = l.league_key === primaryLeague?.league_key;
        return {
          value: l.league_key,
          label: (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span aria-hidden>{SPORT_EMOJI[l.game_code] ?? "🏆"}</span>
              <span className="truncate">{l.name}</span>
              {isPrimary && (
                <Star size={10} className="shrink-0 fill-accent stroke-accent" />
              )}
              {live && (
                <span className="h-1.5 w-1.5 shrink-0  rounded-full bg-live" />
              )}
            </span>
          ),
        };
      }),
    [visibleLeagues, primaryLeague?.league_key],
  );

  const liveCount = visibleLeagues.filter((l) => {
    const ctx = userMatchupContext(l);
    return ctx && isMatchupLive(ctx.matchup);
  }).length;

  const dataPending =
    !feedContext.__dashboardLoaded || Boolean(feedContext.__refreshing);
  // Nothing imported: the wizard IS the feed ("Connect Yahoo" inline).
  const showConnect = leagues.length === 0 && !dataPending;
  const showLoading = leagues.length === 0 && dataPending;
  const showLeagueSelect =
    !accountOpen &&
    !showConnect &&
    subTab !== "overview" &&
    visibleLeagues.length > 1 &&
    activeLeague !== null;

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll — sticky pins against it.
    <div className={clsx("flex min-h-full flex-col", mode === "compact" && "text-[12px]")}>
      {isComfort && (
        <WidgetBar>
          <Segmented
            ariaLabel="Fantasy view"
            value={subTab}
            onChange={pickSubTab}
            options={SUB_TABS}
          />

          {showLeagueSelect && activeLeague && (
            <SelectMenu
              value={activeLeague.league_key}
              options={leagueOptions}
              onChange={setActiveLeagueKey}
              ariaLabel="Switch league"
            />
          )}

          <div className="ml-auto flex min-w-0 shrink items-center gap-3">
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live " />
                {liveCount} live
              </span>
            )}
            <BarPill
              active={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
            >
              Account
            </BarPill>
          </div>
        </WidgetBar>
      )}

      <WidgetStateTransition
        stateKey={
          accountOpen
            ? "account"
            : `tab-${subTab}-${activeLeague?.league_key ?? "none"}`
        }
      >
        {showLoading ? (
          <div className="flex flex-1 flex-col justify-center">
            <EmptyWidgetState
              refreshing={Boolean(feedContext.__refreshing)}
              icon={Swords}
              noun="fantasy leagues"
              hasConfig={!!feedContext.__hasConfig}
              dashboardLoaded={!!feedContext.__dashboardLoaded}
              loadingNoun="leagues"
            />
          </div>
        ) : showConnect || accountOpen ? (
          <div className="pt-4">
            <YahooConnectFlow hex={FANTASY_HEX} />
          </div>
        ) : visibleLeagues.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Activity size={28} className="text-fg-3" />
            <div className="text-[13px] font-semibold text-fg">
              No leagues enabled for viewing
            </div>
            <p className="max-w-sm text-[11px] text-fg-3">
              Every one of your imported leagues is currently hidden. Enable
              them from the Account view, or show them all:
            </p>
            <button
              type="button"
              onClick={enableAllLeagues}
              className="mt-1 rounded-md bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 cursor-pointer"
            >
              Show all leagues
            </button>
          </div>
        ) : (
          <div key={subTab + (activeLeague?.league_key ?? "none")}>
            {subTab === "overview" && (
              <OverviewView
                leagues={visibleLeagues}
                primaryLeagueKey={primaryLeague?.league_key ?? null}
                onSelectLeague={handleSelectLeague}
                onOpenMatchup={handleOpenMatchup}
              />
            )}
            {subTab === "matchup" && <MatchupView league={activeLeague} />}
            {subTab === "standings" && <StandingsView league={activeLeague} />}
            {subTab === "roster" && <RosterView league={activeLeague} />}
          </div>
        )}
      </WidgetStateTransition>
    </div>
  );
}

// Note: `resolvePrimaryLeague` now lives in ./view.ts so the ticker
// can consume the same logic.
