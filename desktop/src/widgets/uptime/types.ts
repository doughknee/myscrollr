/**
 * Uptime Kuma widget types, API response shapes, and storage helpers.
 *
 * Fetches monitor status from a user-provided Uptime Kuma public
 * status page URL. Uses @tauri-apps/plugin-http to bypass CORS
 * since self-hosted Kuma instances may not set CORS headers.
 *
 */
import { fetch } from "@tauri-apps/plugin-http";
import { LS_UPTIME_MONITORS } from "../../constants";
import { getStore, setStore } from "../../lib/store";

// ── Uptime Kuma API response types ─────────────────────────────

/** A monitor entry inside a publicGroupList group. */
export interface KumaMonitorInfo {
  id: number;
  name: string;
  type: string;
  sendUrl?: number;
}

/** A single heartbeat record from the heartbeatList. */
export interface KumaHeartbeat {
  /** 0 = DOWN, 1 = UP, 2 = PENDING, 3 = MAINTENANCE */
  status: number;
  time: string;
  msg: string;
  ping: number | null;
}

/** A monitor group from the status page. */
export interface KumaGroup {
  id: number;
  name: string;
  monitorList: KumaMonitorInfo[];
}

/** Shape returned by GET /api/status-page/{slug}. */
export interface KumaPageResponse {
  config?: Record<string, unknown>;
  incident?: Record<string, unknown> | null;
  publicGroupList: KumaGroup[];
  maintenanceList?: unknown[];
}

/** Shape returned by GET /api/status-page/heartbeat/{slug}. */
export interface KumaHeartbeatResponse {
  heartbeatList: Record<string, KumaHeartbeat[]>;
  uptimeList: Record<string, number>;
}

// ── Internal monitor type ──────────────────────────────────────

export type MonitorStatus = "up" | "down" | "pending" | "maintenance";

export const MONITOR_STATUS_LABELS: Record<MonitorStatus, string> = {
  up: "Up",
  down: "Down",
  pending: "Pending",
  maintenance: "Maintenance",
};

export const MONITOR_STATUS_COLORS: Record<MonitorStatus, string> = {
  up: "bg-up",
  down: "bg-down",
  pending: "bg-warning",
  maintenance: "bg-info",
};

export const MONITOR_STATUS_TEXT: Record<MonitorStatus, string> = {
  up: "text-up",
  down: "text-down",
  pending: "text-warning",
  maintenance: "text-info",
};

export interface KumaMonitor {
  /** Numeric ID from the Kuma instance. */
  id: number;
  /** Human-readable monitor name. */
  name: string;
  /** Current status derived from the latest heartbeat. */
  status: MonitorStatus;
  /** 24-hour uptime percentage (0–100), or null if unavailable. */
  uptimePercent: number | null;
  /** Latest response time in ms, or null if unavailable. */
  responseTime: number | null;
  /** ISO-ish timestamp of the most recent heartbeat check, or null. */
  lastChecked: string | null;
  /** Recent heartbeat status codes (0=down, 1=up, 2=pending, 3=maintenance).
   *  Last ~30 entries, oldest first. Used to render the mini heartbeat bar. */
  recentHeartbeats: number[];
  /**
   * Timestamp of the first heartbeat in the current down run, or null
   * when the monitor isn't down. Null also when we simply don't have
   * history — the chip then omits the duration rather than guessing.
   */
  downSince: string | null;
}

// ── Helpers ────────────────────────────────────────────────────

/** Map a Kuma heartbeat status code to our status string. */
function heartbeatToStatus(code: number): MonitorStatus {
  switch (code) {
    case 1:
      return "up";
    case 0:
      return "down";
    case 3:
      return "maintenance";
    default:
      return "pending";
  }
}

/**
 * Resolve the base API URL and slug from a public status page URL.
 *
 * Input:  https://status.example.com/status/my-page
 * Output: { base: "https://status.example.com", slug: "my-page" }
 */
function parseStatusPageUrl(
  statusPageUrl: string,
): { base: string; slug: string } | null {
  const trimmed = statusPageUrl.replace(/\/+$/, "");
  const match = trimmed.match(/^(https?:\/\/[^/]+)\/status\/(.+)$/i);
  if (match) {
    return { base: match[1], slug: match[2] };
  }
  return null;
}

// ── Fetch ──────────────────────────────────────────────────────

/** Internal helper: fetch JSON with error handling. */
async function kumaFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Uptime Kuma returned ${res.status}: ${res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * Fetch monitor status from an Uptime Kuma instance.
 *
 * Kuma splits data across two endpoints:
 *   GET /api/status-page/{slug}           → page config + monitor list
 *   GET /api/status-page/heartbeat/{slug} → heartbeat + uptime data
 *
 * Both are fetched in parallel and merged.
 *
 * Uses @tauri-apps/plugin-http fetch to bypass CORS restrictions
 * that self-hosted Kuma instances may not have configured.
 */
export async function fetchKumaStatus(
  statusPageUrl: string,
): Promise<KumaMonitor[]> {
  const parsed = parseStatusPageUrl(statusPageUrl);
  if (!parsed) {
    throw new Error(
      "Invalid status page URL. Expected format: https://your-kuma.com/status/page-slug",
    );
  }

  const pageUrl = `${parsed.base}/api/status-page/${parsed.slug}`;
  const heartbeatUrl = `${parsed.base}/api/status-page/heartbeat/${parsed.slug}`;

  // Fetch both endpoints in parallel
  const [page, heartbeat] = await Promise.all([
    kumaFetch<KumaPageResponse>(pageUrl),
    kumaFetch<KumaHeartbeatResponse>(heartbeatUrl),
  ]);

  // Flatten all monitors from all groups, enriched with heartbeat data
  const monitors: KumaMonitor[] = [];

  for (const group of page.publicGroupList ?? []) {
    for (const mon of group.monitorList ?? []) {
      const heartbeats = heartbeat.heartbeatList?.[String(mon.id)] ?? [];
      const latest =
        heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;

      // Look up 24h uptime from uptimeList (keyed as "{id}_24")
      const uptimeKey = `${mon.id}_24`;
      const rawUptime = heartbeat.uptimeList?.[uptimeKey];
      const uptimePercent =
        typeof rawUptime === "number"
          ? Math.round(rawUptime * 10000) / 100 // e.g. 0.9987 → 99.87
          : null;

      // Take the last 30 heartbeats (oldest first) for the mini bar
      const recent = heartbeats.slice(-30).map((hb) => hb.status);

      // When did this outage start? Walk back from the newest beat to
      // the first one in the current down run and take ITS timestamp.
      //
      // Counting beats and multiplying by a poll interval would be
      // wrong: these arrive on Kuma's schedule, not ours. The
      // timestamps are the only honest source, and if the whole window
      // is down we can only say "at least this long", so we return the
      // oldest beat we have rather than pretending to know more.
      let downSince: string | null = null;
      if (latest && heartbeatToStatus(latest.status) === "down") {
        for (let i = heartbeats.length - 1; i >= 0; i--) {
          if (heartbeatToStatus(heartbeats[i].status) !== "down") break;
          downSince = heartbeats[i].time;
        }
      }

      monitors.push({
        id: mon.id,
        name: mon.name,
        status: latest ? heartbeatToStatus(latest.status) : "pending",
        uptimePercent,
        responseTime: latest?.ping ?? null,
        lastChecked: latest?.time ?? null,
        recentHeartbeats: recent,
        downSince,
      });
    }
  }

  return monitors;
}

// ── Store persistence ──────────────────────────────────────────

export function loadMonitors(): KumaMonitor[] {
  return getStore<KumaMonitor[]>(LS_UPTIME_MONITORS, []);
}

export function saveMonitors(monitors: KumaMonitor[]): void {
  setStore(LS_UPTIME_MONITORS, monitors);
}
