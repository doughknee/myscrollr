/**
 * TanStack Query hooks for the desktop API layer.
 *
 * Centralizes all query keys, query options, and mutation helpers.
 * Every remote data fetch uses this layer — no manual fetch + useState.
 */
import { queryOptions } from "@tanstack/react-query";
import { isAuthenticated, hasRefreshToken } from "../auth";
import { authFetch, request, rssApi, fetchOverview } from "./client";
import type { TrackedFeed, UserOverview } from "./client";
import type { DashboardResponse } from "../types";

// ── Query Keys ───────────────────────────────────────────────────

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  weather: ["weather"] as const,
  catalogs: {
    sports: ["catalogs", "sports"] as const,
    finance: ["catalogs", "finance"] as const,
    rss: ["catalogs", "rss"] as const,
    rssAll: ["catalogs", "rss", "all"] as const,
  },
  fantasy: {
    status: ["fantasy", "status"] as const,
    leagues: ["fantasy", "leagues"] as const,
  },
  standings: (league: string) => ["standings", league] as const,
  userOverview: ["userOverview"] as const,
};

// ── User Overview Query ──────────────────────────────────────────

/**
 * Aggregated account view: identity + tier + subscription summary +
 * channel counts + fantasy summary + GDPR state. Backed by the core
 * API's singleflight cache (~30s).
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
  // Try authenticated path if token is valid OR a refresh token can restore the session.
  // This prevents the deadlock where an expired access token blocked the only code path
  // that could trigger a refresh via getValidToken().
  //
  // Signed-in users with zero channels installed deliberately receive an
  // empty `data` payload — the ticker renders an inline "no sources yet"
  // CTA in that state rather than teasing public-feed data. See
  // `ScrollrTicker` empty-shell handling and `App.tsx` channelTabs logic.
  if (isAuthenticated() || hasRefreshToken()) {
    try {
      const data = await authFetch<{
        data: DashboardResponse["data"];
        channels?: DashboardResponse["channels"];
        preferences?: DashboardResponse["preferences"];
      }>("/dashboard");
      return {
        data: data.data,
        channels: data.channels,
        preferences: data.preferences,
      } as DashboardResponse;
    } catch {
      // Token rejected or expired — fall back to public feed
    }
  }

  const data = await request<{ data: DashboardResponse["data"] }>("/public/feed");
  return { data: data.data } as DashboardResponse;
}

/** Query options for the dashboard — usable in route loaders and components. */
export function dashboardQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.dashboard,
    queryFn: fetchDashboard,
    staleTime: 10_000,
  });
}

// ── Catalog Queries ──────────────────────────────────────────────

export interface TrackedLeague {
  name: string;
  sport_api: string;
  category: string;
  country: string;
  logo_url: string;
  game_count: number;
  live_count: number;
  next_game: string | null;
  is_offseason: boolean;
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
    queryFn: () => authFetch<{ standings: Standing[] }>(`/sports/standings?league=${encodeURIComponent(league)}`),
    staleTime: 60 * 60 * 1000, // 1 hour
    enabled: !!league,
  });
}

export function sportsCatalogOptions() {
  return queryOptions({
    queryKey: queryKeys.catalogs.sports,
    queryFn: () => request<TrackedLeague[]>("/sports/leagues"),
    staleTime: 5 * 60 * 1000, // 5 min — catalogs change infrequently
  });
}

export function sportsTeamsOptions(league: string) {
  return queryOptions({
    queryKey: ["teams", league] as const,
    queryFn: () => request<{ teams: TeamInfo[] }>(`/sports/teams?league=${encodeURIComponent(league)}`),
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

export function rssCatalogOptions(opts?: { includeFailing?: boolean }) {
  const includeFailing = opts?.includeFailing ?? false;
  return queryOptions({
    queryKey: includeFailing ? queryKeys.catalogs.rssAll : queryKeys.catalogs.rss,
    queryFn: () => rssApi.getCatalog(includeFailing ? { includeFailing: true } : undefined),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Fantasy Queries ─────────────────────────────────────────────

interface YahooStatusResponse {
  connected: boolean;
  synced: boolean;
}

// MyLeaguesResponse imported from canonical source to avoid duplicate types.
import type { MyLeaguesResponse } from "../channels/fantasy/types";
export type { MyLeaguesResponse } from "../channels/fantasy/types";

export function fantasyStatusOptions() {
  return queryOptions({
    queryKey: queryKeys.fantasy.status,
    queryFn: () =>
      authFetch<YahooStatusResponse>("/users/me/yahoo-status"),
    staleTime: 30_000,
    retry: false,
  });
}

export function fantasyLeaguesOptions() {
  return queryOptions({
    queryKey: queryKeys.fantasy.leagues,
    queryFn: () =>
      authFetch<MyLeaguesResponse>("/users/me/yahoo-leagues"),
    staleTime: 30_000,
    retry: false,
  });
}

// ── Weather Queries ──────────────────────────────────────────────

import { searchCities, loadCities, saveCities, fetchWeather } from "../widgets/weather/types";
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
