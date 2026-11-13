/**
 * TanStack Query hooks for the desktop API layer.
 *
 * Centralizes all query keys, query options, and mutation helpers.
 * Every remote data fetch uses this layer — no manual fetch + useState.
 */
import { queryOptions } from "@tanstack/react-query";
import { isAuthenticated, hasRefreshToken, isSignedOut, currentUserSub } from "../auth";
import { ApiError, authFetch, request, rssApi, fetchOverview } from "./client";
import { pinnedSubjectsQuery } from "./pinnedSubjects";
import { getStore, removeStore } from "../lib/store";
import { DEMO } from "../config";
import type { QueryClient } from "@tanstack/react-query";
import type { TrackedFeed, UserOverview } from "./client";
import type { DashboardResponse, Game, Trade } from "../types";

// ── Query Keys ───────────────────────────────────────────────────

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  financeMarket: ["finance", "market"] as const,
  weather: ["weather"] as const,
  catalogs: {
    finance: ["catalogs", "finance"] as const,
    rss: ["catalogs", "rss"] as const,
    rssAll: ["catalogs", "rss", "all"] as const,
  },
  standings: (league: string) => ["standings", league] as const,
  userOverview: ["userOverview"] as const,
};

// ── User Overview Query ──────────────────────────────────────────

/**
 * Aggregated account view: identity + tier + subscription summary +
 * widget counts + GDPR state. Backed by the core API's singleflight
 * cache (~30s).
 */
export function userOverviewQueryOptions() {
  return queryOptions<UserOverview>({
    queryKey: queryKeys.userOverview,
    queryFn: fetchOverview,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

// ── Dashboard Query ──────────────────────────────────────────────

async function fetchDashboard(): Promise<DashboardResponse> {
  // Demo mode: talk to the no-auth bridge directly (it serves /dashboard with
  // widgets[] and ignores Authorization), so the demo works signed-out with
  // zero infra.
  if (DEMO) {
    const demo = await request<{
      data: DashboardResponse["data"];
      widgets?: DashboardResponse["widgets"];
    }>("/dashboard");
    return { data: demo.data, widgets: demo.widgets } as DashboardResponse;
  }

  // Try authenticated path if token is valid OR a refresh token can restore the session.
  // This prevents the deadlock where an expired access token blocked the only code path
  // that could trigger a refresh via getValidToken().
  //
  // Signed-in users with zero widgets installed deliberately receive an
  // empty `data` payload — the ticker renders an inline "no sources yet"
  // CTA in that state rather than teasing public-feed data. See
  // `ScrollrTicker` empty-shell handling and `App.tsx` widgetTabs logic.
  if (isAuthenticated() || hasRefreshToken()) {
    try {
      const data = await authFetch<{
        data: DashboardResponse["data"];
        widgets?: DashboardResponse["widgets"];
        preferences?: DashboardResponse["preferences"];
      }>(`/dashboard${pinnedSubjectsQuery()}`);
      return {
        data: data.data,
        widgets: data.widgets,
        preferences: data.preferences,
      } as DashboardResponse;
    } catch (err) {
      // Only a session that is really over falls back to the public feed:
      // a 401 after authFetch's refresh-and-retry left nothing stored. Any
      // other failure (timeout, 429, 5xx, a refresh lost to the network)
      // throws, so the query keeps the last good dashboard and reports the
      // error. Before SCROLLR-448 every failure "succeeded" with a payload
      // that has no widgets, and every bar said "no sources yet" (RC-1).
      if (!(err instanceof ApiError && err.status === 401 && isSignedOut())) throw err;
    }
  }

  const data = await request<{ data: DashboardResponse["data"] }>(
    "/public/feed",
  );
  return { data: data.data } as DashboardResponse;
}

const SAVED_DASHBOARD_KEY = "scrollr:dashboard";

/** The dashboard as the main window saves it: tagged with whose it is. */
export type SavedDashboard = DashboardResponse & { userSub?: string | null };

/** Tag a dashboard with the account it was fetched for, before saving it. */
export function dashboardToSave(dashboard: DashboardResponse): SavedDashboard {
  return { ...dashboard, userSub: currentUserSub() };
}

/**
 * The last dashboard this install saw (the main window writes every good
 * one to the store), so a restart during an outage opens on it rather than
 * on nothing. Never another session's: signed out, only a public feed saved
 * by nobody; signed in, only a copy saved by this same account. A copy from
 * before SCROLLR-470 carries no account, so a signed-in user ignores it.
 */
function savedDashboard(): DashboardResponse | undefined {
  const saved = getStore<SavedDashboard | null>(SAVED_DASHBOARD_KEY, null);
  if (!saved?.data) return undefined;
  if (isSignedOut()) return saved.preferences || saved.userSub ? undefined : saved;
  const sub = currentUserSub();
  return saved.preferences && sub && saved.userSub === sub ? saved : undefined;
}

/**
 * On sign-in and sign-out, forget everything fetched for the account that
 * was signed in (SCROLLR-470): the saved dashboard and every per-account
 * query (dashboard, profile, GitHub). Preferences live in the store and
 * are not touched.
 */
export async function forgetAccountData(queryClient: QueryClient): Promise<void> {
  removeStore(SAVED_DASHBOARD_KEY);
  const filters = {
    predicate: ({ queryKey: [key] }: { queryKey: readonly unknown[] }) =>
      key === queryKeys.dashboard[0] ||
      key === queryKeys.userOverview[0] ||
      (typeof key === "string" && key.startsWith("github-")),
  };
  // A fetch still running for the old account must not land.
  await queryClient.cancelQueries(filters);
  // Empty them in place, so every observer sees it at once. Not
  // `resetQueries`: that restores the state from when the query was made,
  // which can be the old account's saved dashboard.
  for (const query of queryClient.getQueryCache().findAll(filters)) {
    query.setState({
      data: undefined,
      dataUpdatedAt: 0,
      error: null,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      status: "pending",
      isInvalidated: true,
    });
  }
  // Only the dashboard refetches now: profile and GitHub wait for their
  // page, which fetches them once signed in (a fetch now, signed out, would
  // 401 and raise the "session expired" banner after a plain sign-out).
  await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
}

/** Query options for the dashboard — usable in route loaders and components. */
export function dashboardQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.dashboard,
    queryFn: fetchDashboard,
    staleTime: 10_000,
    initialData: savedDashboard,
    // Saved, not fetched: stale at once, and no "updated just now".
    initialDataUpdatedAt: 0,
  });
}

/**
 * The one reading every surface takes of the dashboard query (SCROLLR-406):
 * `pending` (nothing yet, still trying: say nothing), `failed` (nothing at
 * all and the last attempt failed: say so, offer a retry), `ready` (data,
 * possibly kept from before a failed refresh). Only `ready` can be empty.
 */
export type DashboardState = "pending" | "failed" | "ready";

export function dashboardState(query: { data?: unknown; isError: boolean }): DashboardState {
  if (query.data) return "ready";
  return query.isError ? "failed" : "pending";
}

// ── Catalog Queries ──────────────────────────────────────────────

/**
 * Per-league meta attached to the dashboard + public sports responses.
 * Lets the empty-state component explain WHY a league has no games.
 */
export interface LeagueMeta {
  name: string;
  is_offseason: boolean;
  /** ISO timestamp of the earliest upcoming game, or null if none. */
  next_game: string | null;
  polling_healthy: boolean;
}

/** Wrapper around the meta payload returned alongside sports games. */
export interface SportsMeta {
  leagues: LeagueMeta[];
}

export interface TrackedSymbol {
  symbol: string;
  name: string;
  category: string;
}

export interface Standing {
  league: string;
  team_name: string;
  team_code: string;
  team_logo: string;
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  games_played: number;
  goal_diff: number;
  description?: string;
  form?: string;
  group_name?: string;
  sport_api?: string;
  pct?: string;
  games_behind?: string;
  otl?: number;
  goals_for?: number;
  goals_against?: number;
  points_for?: number;
  points_against?: number;
  streak?: string;
}

export interface TeamInfo {
  league: string;
  external_id: number;
  name: string;
  code: string;
  logo: string;
  country?: string;
}

export function standingsOptions(league: string) {
  return queryOptions({
    queryKey: queryKeys.standings(league),
    queryFn: () =>
      authFetch<{ standings: Standing[] }>(
        `/sports/standings?league=${encodeURIComponent(league)}`,
      ),
    staleTime: 60 * 60 * 1000, // 1 hour
    enabled: !!league,
  });
}

/**
 * Full sports games payload — every game for the user's selected leagues,
 * no per-league fair-share cap. Used by the full widget page
 * (`/widget/sports_nfl`), where the user has filter chips to narrow down
 * by hand.
 *
 * The home feed reads from `dashboardQueryOptions` instead, which serves a
 * 20-row fair-shared preview optimized for glanceable consumption.
 */
export function sportsFullQueryOptions() {
  return queryOptions({
    queryKey: ["sports", "full"] as const,
    queryFn: () => authFetch<{ sports: Game[]; meta: SportsMeta }>("/sports"),
    staleTime: 10_000,
  });
}

export function sportsTeamsOptions(league: string) {
  return queryOptions({
    queryKey: ["teams", league] as const,
    queryFn: () =>
      authFetch<{ teams: TeamInfo[] }>(
        `/sports/teams?league=${encodeURIComponent(league)}`,
      ),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours — teams change infrequently
    enabled: !!league,
  });
}

export function financeCatalogOptions() {
  return queryOptions({
    queryKey: queryKeys.catalogs.finance,
    queryFn: () => request<TrackedSymbol[]>("/finance/symbols"),
    staleTime: 5 * 60 * 1000,
  });
}

export function financeMarketOptions() {
  return queryOptions({
    queryKey: queryKeys.financeMarket,
    queryFn: () => request<Trade[]>("/finance/public"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function rssCatalogOptions(opts?: { includeFailing?: boolean }) {
  const includeFailing = opts?.includeFailing ?? false;
  return queryOptions({
    queryKey: includeFailing
      ? queryKeys.catalogs.rssAll
      : queryKeys.catalogs.rss,
    queryFn: () =>
      rssApi.getCatalog(includeFailing ? { includeFailing: true } : undefined),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Weather Queries ──────────────────────────────────────────────

import {
  searchCities,
  loadCities,
  saveCities,
  fetchWeather,
} from "../widgets/weather/types";
import type { SavedCity } from "../widgets/weather/types";

/**
 * Shell-level weather query.
 *
 * Fetches fresh weather for every saved city via Open-Meteo and writes
 * the results to the Tauri store (cross-window sync for the ticker).
 *
 * Mount a `useQuery(weatherQueryOptions())` in __root.tsx so the
 * refetchInterval keeps data fresh regardless of which page is active.
 * FeedTab mounts a second observer on the same key — zero duplicate fetches.
 */
export function weatherQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.weather,
    queryFn: async (): Promise<SavedCity[]> => {
      const cities = loadCities();
      if (cities.length === 0) return [];

      const results = await Promise.allSettled(
        cities.map((c) => fetchWeather(c.location.lat, c.location.lon)),
      );

      let changed = false;
      const updated = cities.map((city, i) => {
        const result = results[i];
        if (result.status === "fulfilled") {
          changed = true;
          return {
            ...city,
            weather: result.value,
            lastFetched: Date.now(),
            error: undefined,
          };
        }
        // On failure, keep existing weather data
        return city;
      });

      if (changed) saveCities(updated);
      return updated;
    },
    staleTime: 10 * 60 * 1000, // 10 min
    refetchInterval: 10 * 60 * 1000, // 10 min auto-poll
    gcTime: 30 * 60 * 1000, // 30 min cache
  });
}

export function citySearchOptions(query: string) {
  return queryOptions({
    queryKey: ["city-search", query] as const,
    queryFn: () => searchCities(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
