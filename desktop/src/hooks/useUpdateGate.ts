// ── Mandatory-update gate ───────────────────────────────────────
//
// The core API serves the minimum desktop version it still supports at
// GET /app/min-version (unauthenticated). When the installed version is
// older, the dashboard blocks with UpdateRequiredOverlay until the user
// updates — the lever for breaking deploys (schema/model changes an old
// client can't render), unlike the optional startup check the user can
// disable in Settings.
//
// FAIL OPEN everywhere: a fetch error, malformed payload, or empty
// minimum must never lock users out of a working app. The gate only
// engages on a positive "server says X, we are provably older than X".

import { useEffect, useState } from "react";
import { API_BASE } from "../config";
import { compareVersions } from "../lib/releases";

interface UpdateGate {
  /** True when the server's minimum is newer than the installed version. */
  updateRequired: boolean;
  /** The server's minimum version (for the overlay copy). */
  minVersion: string;
}

export function useUpdateGate(appVersion: string): UpdateGate {
  const [minVersion, setMinVersion] = useState("");

  useEffect(() => {
    if (!appVersion) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/app/min-version`);
        if (!res.ok) return;
        const body: unknown = await res.json();
        const min =
          body && typeof body === "object"
            ? (body as Record<string, unknown>).min_desktop_version
            : undefined;
        if (!cancelled && typeof min === "string" && min.trim() !== "") {
          setMinVersion(min.trim());
        }
      } catch {
        // Offline / API blip — fail open.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appVersion]);

  const updateRequired =
    Boolean(appVersion) &&
    Boolean(minVersion) &&
    compareVersions(appVersion, minVersion) < 0;

  return { updateRequired, minVersion };
}
