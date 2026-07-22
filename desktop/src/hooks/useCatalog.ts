import { useSyncExternalStore, useEffect } from "react";

import { fetchCatalog } from "../api/client";
import {
  catalogVersion,
  refreshCatalog,
  subscribeCatalog,
} from "../marketplace";

// One fetch per window, not per component. The ticker and the main window are
// separate Tauri webviews — separate JavaScript realms with their own copy of
// every module — so this cannot and does not dedupe across them; each window
// fetches once. (An earlier comment here claimed otherwise.) Within a window
// it matters, because several components call this hook.
let fetched = false;

// Bound once per window and never removed. The retry is a process-wide
// concern, not any one component's: binding it inside the same effect that
// owns `fetched` meant the FIRST caller registered it and that same caller's
// unmount tore it down for everyone. Under StrictMode's mount/unmount/remount
// that happened immediately — the listener was gone before the app finished
// starting, and the remount saw `fetched` already true and bound nothing.
let retryBound = false;

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
    if (!retryBound) {
      retryBound = true;
      // Reaching the network again is the one event worth retrying on: an app
      // launched offline otherwise keeps the bundled snapshot for the whole
      // session. Deliberately not cleaned up — see the note above.
      window.addEventListener("online", () => {
        void refreshCatalog(fetchCatalog);
      });
    }

    if (fetched) return;
    fetched = true;
    void refreshCatalog(fetchCatalog).then((result) => {
      // "unchanged" is a success — the server agrees with the snapshot. Only
      // a real failure should let a later mount try again.
      if (result === "failed") fetched = false;
    });
  }, []);

  return version;
}
