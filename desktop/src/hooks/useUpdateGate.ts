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
import { valid } from "semver";
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import { API_BASE } from "../config";
import { requiresUpdate } from "../lib/releases";
import { updateController } from "../lib/updateController";

/** How often the minimum is read again while the app stays open. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

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
    const load = async () => {
      try {
        const body = await fetchWithTimeout(
          `${API_BASE}/app/min-version`,
          {},
          async (res): Promise<unknown> => (res.ok ? res.json() : undefined),
        );
        const min =
          body && typeof body === "object"
            ? (body as Record<string, unknown>).min_desktop_version
            : undefined;
        if (!cancelled && typeof min === "string" && valid(min.trim())) {
          // This persistent main-window hook owns the policy, even when the
          // installed Beta is supported and the blocking overlay stays hidden.
          // Keep the last valid policy through unmounts and failed responses.
          updateController.setMinimum(min.trim());
          setMinVersion(min.trim());
        }
      } catch {
        // Offline / API blip — fail open.
      }
    };
    void load();
    // An app left open for days (or started before the network was up) would
    // otherwise never learn the floor moved; the next reading is a few hours
    // away, never minutes.
    const timer = setInterval(() => void load(), RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [appVersion]);

  const updateRequired = requiresUpdate(appVersion, minVersion);

  return { updateRequired, minVersion };
}
