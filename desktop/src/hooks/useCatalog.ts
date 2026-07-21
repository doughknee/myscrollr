import { useSyncExternalStore, useEffect } from "react";

import { fetchCatalog } from "../api/client";
import {
  catalogVersion,
  refreshCatalog,
  subscribeCatalog,
} from "../marketplace";

// The catalog refresh is a once-per-session, process-wide concern: both the
// ticker window and the main window mount this hook, and neither should
// trigger a second fetch. Guarded here rather than in marketplace so the
// module stays a pure view over the catalog.
let started = false;

/**
 * Keeps a component in sync with the server-authoritative widget catalog.
 *
 * Renders immediately from the bundled snapshot — the ticker must work
 * offline and on first run (VISION §4.2, constraint 1) — then re-renders once
 * if a fetched catalog differs from it. An offline or failing server is not
 * an error path: the snapshot simply stays.
 *
 * Returns the active catalog version, which is also the store snapshot, so
 * `useSyncExternalStore` re-renders exactly when the catalog changes.
 */
export function useCatalog(): string {
  const version = useSyncExternalStore(subscribeCatalog, catalogVersion);

  useEffect(() => {
    if (started) return;
    started = true;
    void refreshCatalog(fetchCatalog);
  }, []);

  return version;
}
