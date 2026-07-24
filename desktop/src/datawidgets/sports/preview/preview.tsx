/**
 * Sports widget preview harness — dev-only, browser-only entry.
 *
 * Mirrors datawidgets/finance/preview/ (see that harness for the pattern
 * rationale). Sports additionally needs ShellDataContext: useSportsConfig
 * reads the widget rows from it, not from ShellContext. Gear writes are
 * asserted render-only (useSportsConfig mutates via the authed API).
 */
// FIRST: evaluate the widget registry before ../FeedTab (module-cycle
// guard — see the finance harness for the full explanation).
import "../../registry";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../style.css";
import {
  ShellContext,
  ShellDataContext,
  type ShellState,
  type ShellDataState,
} from "../../../shell-context";
import {
  dashboardQueryOptions,
  sportsFullQueryOptions,
  sportsTeamsOptions,
  type TeamInfo,
} from "../../../api/queries";
import type { AppPreferences } from "../../../preferences";
import { sportsDataWidget } from "../FeedTab";
import type { DataWidgetRow, WidgetId } from "../../../api/client";
import type { FeedTabProps, Game } from "../../../types";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") ?? "scrollr-light";
const widgetId = "sports_nfl";

// ── Deterministic fixture ────────────────────────────────────────

const NFL_TEAMS = [
  "Kansas City Chiefs",
  "Buffalo Bills",
  "Philadelphia Eagles",
  "Dallas Cowboys",
  "San Francisco 49ers",
  "Detroit Lions",
  "Baltimore Ravens",
  "Green Bay Packers",
  "Miami Dolphins",
  "New York Jets",
  "Cincinnati Bengals",
  "Houston Texans",
  "Seattle Seahawks",
  "Los Angeles Rams",
  "Minnesota Vikings",
  "Chicago Bears",
];

const teams: TeamInfo[] = NFL_TEAMS.map((name, i) => ({
  league: "NFL",
  external_id: i + 1,
  name,
  code: name.split(" ").pop()!.slice(0, 3).toUpperCase(),
  logo: "",
}));

// 72 games (¼ live, ½ upcoming, ¼ final) — staggered around now so the
// schedule grouping and the day-window filter always have content, and
// tall enough that the scoreboard scrolls well past the viewport (the
// sticky-pin check needs ≥300px of travel).
const games: Game[] = Array.from({ length: 72 }, (_, i) => {
  const state = i % 4 === 0 ? "in_progress" : i % 4 === 1 || i % 4 === 2 ? "pre" : "final";
  const home = teams[(i * 2) % teams.length];
  const away = teams[(i * 2 + 1) % teams.length];
  const hoursOff = state === "pre" ? (i % 48) + 2 : -((i % 24) + 1);
  return {
    id: i + 1,
    league: "NFL",
    sport: "football",
    external_game_id: `nfl-${i + 1}`,
    link: "https://example.com/game",
    home_team_name: home.name,
    home_team_logo: "",
    home_team_score: state === "pre" ? 0 : 14 + (i % 21),
    home_team_code: home.code,
    away_team_name: away.name,
    away_team_logo: "",
    away_team_score: state === "pre" ? 0 : 10 + ((i * 3) % 24),
    away_team_code: away.code,
    start_time: new Date(Date.now() + hoursOff * 3_600_000).toISOString(),
    state,
    short_detail: state === "in_progress" ? "Q3 4:12" : undefined,
    timer: state === "in_progress" ? "Q3 4:12" : undefined,
    updated_at: new Date(Date.now() - 60_000).toISOString(),
  };
});

const widgetRow = {
  id: 1,
  widget_type: widgetId,
  enabled: true,
  ticker_enabled: true,
  created_at: "2026-07-17T00:00:00Z",
  updated_at: "2026-07-17T00:00:00Z",
  config: {
    leagues: ["NFL"],
    favoriteTeams: {
      NFL: { teamId: 1, teamName: "Kansas City Chiefs" },
    },
  },
} as unknown as DataWidgetRow;

function main(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(dashboardQueryOptions().queryKey, {
    data: {},
    widgets: [widgetRow],
  });
  queryClient.setQueryData(sportsFullQueryOptions().queryKey, {
    sports: games,
    meta: { leagues: [] },
  });
  queryClient.setQueryData(sportsTeamsOptions("NFL").queryKey, { teams });

  const initialPrefs = {
    widgetDisplay: {},
  } as unknown as AppPreferences;

  const noop = (): void => {};
  const shellBase = {
    authenticated: false,
    tier: "free",
    subscriptionInfo: null,
    onLogin: noop,
    onLogout: noop,
    autostartEnabled: false,
    onAutostartChange: noop,
    appVersion: "preview",
    allDataWidgetManifests: [],
    allWidgets: [],
  };

  const shellData: ShellDataState = {
    widgets: [widgetRow],
    dashboard: undefined,
  };

  const feedContext = {
    __hasConfig: true,
    __dashboardLoaded: true,
    __refreshing: false,
  } as FeedTabProps["feedContext"];

  const FeedTab = sportsDataWidget.FeedTab;

  function Harness() {
    const [prefs, setPrefs] = useState<AppPreferences>(initialPrefs);
    const shell = {
      ...shellBase,
      prefs,
      onPrefsChange: setPrefs,
    } as unknown as ShellState;
    return (
      <QueryClientProvider client={queryClient}>
        <ShellContext.Provider value={shell}>
          <ShellDataContext.Provider value={shellData}>
            <div
              id="app-shell"
              data-theme={theme}
              className="h-screen overflow-y-auto scrollbar-thin bg-surface text-fg font-sans"
            >
              <FeedTab
                mode="comfort"
                feedContext={feedContext}
                widgetId={widgetId}
              />
            </div>
          </ShellDataContext.Provider>
        </ShellContext.Provider>
      </QueryClientProvider>
    );
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}

main();
