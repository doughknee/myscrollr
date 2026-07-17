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
import { resolveInitialEntry } from "./routeCompat";
import type { QueryClient } from "@tanstack/react-query";

// ── Persistence ──────────────────────────────────────────────────

const HISTORY_KEY = "scrollr:lastRoute";

function getInitialEntry(): string {
  return resolveInitialEntry(getStore<string | null>(HISTORY_KEY, null));
}

// ── Router factory ───────────────────────────────────────────────

export function createAppRouter(queryClient: QueryClient) {
  const memoryHistory = createMemoryHistory({
    initialEntries: [getInitialEntry()],
  });

  const router = createRouter({
    routeTree,
    history: memoryHistory,
    context: { queryClient },
    defaultPreload: "intent",
  });

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
