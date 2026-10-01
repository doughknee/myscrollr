/**
 * Dev only (SCROLLR-272): a live update every 4 s, so "nothing moves while
 * a page is up" can be watched and measured in the ticker shim, which has
 * no stream. Loaded by main.tsx behind `import.meta.env.DEV` and `?live=1`;
 * a release bundle contains none of it.
 *
 * Each tick runs every live game's clock down 25 s, adds a touchdown or a
 * field goal to one live game (in turn), and moves a third of the prices
 * by up to 0.4 %. It writes the dashboard query cache, exactly where the
 * CDC merge writes in the app.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { DashboardResponse, Game, Trade } from "../types";
import { queryKeys } from "../api/queries";
import { isLive } from "../utils/gameHelpers";

export function tickDashboard(prev: DashboardResponse, n: number): DashboardResponse {
  const games = (prev.data?.sports as Game[] | undefined) ?? [];
  const live = games.filter(isLive);
  const target = live[n % Math.max(1, live.length)];
  const trades = (prev.data?.finance as Trade[] | undefined) ?? [];
  return {
    ...prev,
    data: {
      ...prev.data,
      sports: games.map((g) => {
        if (!isLive(g)) return g;
        const t = /^(\d+):(\d\d)$/.exec(g.timer ?? "");
        const secs = t ? Math.max(0, Number(t[1]) * 60 + Number(t[2]) - 25) : 0;
        const timer = t ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : g.timer;
        if (g !== target) return { ...g, timer };
        const side = n % 2 ? "home_team_score" : "away_team_score";
        return { ...g, timer, [side]: String(Number(g[side] || 0) + (n % 3 ? 7 : 3)) };
      }),
      finance: trades.map((t, i) => {
        if (i % 3 !== n % 3) return t;
        const p = Number(t.price) * (1 + Math.sin(n + i) * 0.004);
        const pc = Number(t.previous_close) || Number(t.price);
        return { ...t, price: p, percentage_change: ((p - pc) / pc) * 100, price_change: p - pc };
      }),
    },
  } as DashboardResponse;
}

export function startLiveSim(qc: QueryClient): void {
  let n = 0;
  window.setInterval(() => {
    qc.setQueryData<DashboardResponse>(queryKeys.dashboard, (prev) => (prev?.data ? tickDashboard(prev, n++) : prev));
  }, 4000);
}
