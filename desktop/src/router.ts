/**
 * TanStack Router configuration with memory history.
 *
 * The desktop app has no URL bar, so we use createMemoryHistory
 * instead of browser history. Navigation state is persisted to
 * the Tauri store so the last-visited view is restored on relaunch.
 */
import {
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { getStore, setStore } from "./lib/store";
import { isMountable } from "./lib/routePaths";
import type { QueryClient } from "@tanstack/react-query";

// ── Persistence ──────────────────────────────────────────────────

const HISTORY_KEY = "scrollr:lastRoute";

// ── Router factory ───────────────────────────────────────────────

export function createAppRouter(queryClient: QueryClient) {
  // Start at home, then restore the persisted route only once the router
  // exists and can be asked whether that route still exists.
  const memoryHistory = createMemoryHistory({ initialEntries: ["/"] });

  const router = createRouter({
    routeTree,
    history: memoryHistory,
    context: { queryClient },
    defaultPreload: "intent",
  });

  const saved = getStore<string | null>(HISTORY_KEY, null);
  if (saved && saved !== "/" && isMountable(saved, Object.keys(router.routesById))) {
    memoryHistory.push(saved);
  }

  // Persist the current route on every navigation
  router.subscribe("onResolved", () => {
    const path = router.state.location.pathname;
    setStore(HISTORY_KEY, path);
  });

  return router;
}

// ── Type registration ────────────────────────────────────────────

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
