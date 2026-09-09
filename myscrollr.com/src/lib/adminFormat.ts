/**
 * Presentation rules for the staff Overview (REL-260).
 *
 * These live apart from the components because they encode the page's one
 * hard promise — a tile shows a real number or says it cannot — and that
 * promise is worth a test that does not need a DOM.
 */

import type { ConnectedTile, IngestRow, Measured } from '@/api/admin'

/** What a tile should actually render for a Measured value. */
export interface TileValue {
  /** The number, or null when it must not be shown as one. */
  display: string | null
  /** Shown instead of (or under) the number. */
  note?: string
}

/**
 * A `Measured` with `available: false` must never render as a number — not
 * even as "0", which reads as a measurement of zero rather than the absence
 * of a measurement. That distinction is the whole reason the type exists.
 */
export function measuredValue(m: Measured | undefined): TileValue {
  if (!m || !m.available) {
    return { display: null, note: m?.note ?? 'Not measurable.' }
  }
  return { display: m.value.toLocaleString(), note: m.note }
}

/**
 * The "connected now" caveat.
 *
 * `events.ClientCount()` is per-replica and core-api runs two, so the number
 * is a sum over the replicas that reported in the last heartbeat window. When
 * fewer than the expected two reported, the total is understated and the tile
 * has to say so rather than showing a confidently halved number.
 */
export const EXPECTED_REPLICAS = 2

export function connectedCaveat(tile: ConnectedTile): string {
  if (tile.replicas >= EXPECTED_REPLICAS) {
    return `Summed across ${tile.replicas} replicas.`
  }
  if (tile.replicas <= 0) {
    return 'No replica reported — this number is not trustworthy.'
  }
  return `Only ${tile.replicas} of ${EXPECTED_REPLICAS} replicas reported — the real total is higher.`
}

/** Compact "how long ago", for ingest freshness. */
export function formatAge(seconds: number): string {
  if (seconds < 0) return 'in the future'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Ingest health. The thresholds are deliberately loose: this answers "has
 * this feed stopped", not "is it a few seconds behind". Sports rows can
 * legitimately sit still overnight, so a stale table is a warning, never an
 * error, and an empty one is the only genuinely broken state.
 */
export type IngestHealth = 'empty' | 'stale' | 'fresh'

export function ingestHealth(row: IngestRow): IngestHealth {
  if (!row.has_data) return 'empty'
  return row.age_seconds > 6 * 3600 ? 'stale' : 'fresh'
}

/**
 * Downloads are not installs, and the label has to carry that everywhere the
 * number appears — a reader who sees the count without the caveat will file
 * it away as an install count.
 */
export const DOWNLOADS_CAVEAT =
  'Downloads, not installs. One person upgrading through five releases is five downloads, and nothing reports back whether the app was kept or opened.'
