/**
 * /status — live platform health as a terminal ledger.
 *
 * Polling is unchanged: /health + /events/count + /channels every 30s.
 * Every service the previous page monitored is still here — the skin
 * moved from cards to ledger rows with pulsing status dots.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import type { ReactNode } from 'react'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import { API_BASE } from '@/api/client'
import { EASE } from '@/lib/animations'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'

export const Route = createFileRoute('/status')({
  head: () =>
    seo({
      title: 'Scrollr System Status',
      description:
        'Live system status for the Scrollr platform. Real-time health of infrastructure, ingestion workers, and channel APIs.',
      path: '/status',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Status', path: '/status' },
        ]),
      ],
    }),
  component: StatusPage,
})

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: EASE },
}

// --- Types ---

interface HealthData {
  status: string
  database: string
  redis: string
  services: Record<string, string>
}

interface ChannelEntry {
  name: string
  display_name: string
  capabilities: Array<string>
}

interface ViewerData {
  count: number
}

type ServiceState = 'healthy' | 'unhealthy' | 'down' | 'unknown' | 'loading'

/** Known channel metadata — mono ledger code, description, port. */
interface ChannelMeta {
  code: string
  description: string
  port?: number
}

const CHANNEL_META: Partial<Record<string, ChannelMeta>> = {
  finance: {
    code: 'CHN—FIN',
    description: 'TwelveData WebSocket · real-time market data',
    port: 3001,
  },
  sports: {
    code: 'CHN—SPT',
    description: 'ESPN API · scores polling every 60s',
    port: 3002,
  },
  fantasy: {
    code: 'CHN—FAN',
    description: 'Yahoo Fantasy · Go-native sync, no Rust ingestion',
    port: 8084,
  },
  rss: {
    code: 'CHN—RSS',
    description: 'RSS/Atom/JSON · feed aggregation every 5 min',
    port: 3004,
  },
}

/** Fallback code for channels the API registers that we have no meta for. */
function channelCode(name: string): string {
  return CHANNEL_META[name]?.code ?? `CHN—${name.slice(0, 3).toUpperCase()}`
}

// --- Helpers ---

const POLL_INTERVAL = 30_000

const STATE_LABEL: Record<ServiceState, string> = {
  healthy: 'OPERATIONAL',
  unhealthy: 'DEGRADED',
  down: 'DOWN',
  unknown: 'UNKNOWN',
  loading: 'CHECKING',
}

/** Emerald up / amber degraded / red down; muted while unknown. */
const STATE_STYLE: Record<
  ServiceState,
  { dot: string; text: string; pulse: boolean }
> = {
  healthy: { dot: 'bg-primary', text: 'text-primary', pulse: true },
  unhealthy: { dot: 'bg-warning', text: 'text-warning-ink', pulse: true },
  down: { dot: 'bg-error', text: 'text-error-ink', pulse: true },
  unknown: {
    dot: 'bg-base-content/25',
    text: 'text-base-subtle',
    pulse: false,
  },
  loading: {
    dot: 'bg-base-content/25',
    text: 'text-base-subtle',
    pulse: false,
  },
}

function overallLabel(health: HealthData | null): string {
  if (!health) return 'CHECKING'
  if (health.status === 'healthy') return 'ALL SYSTEMS OPERATIONAL'
  if (health.status === 'degraded') return 'PARTIAL DEGRADATION'
  return 'MAJOR OUTAGE'
}

// --- Component ---

function StatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [channels, setChannels] = useState<Array<ChannelEntry>>([])
  const [viewers, setViewers] = useState<number | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [fetchError, setFetchError] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const [healthRes, viewerRes, chnlRes] = await Promise.allSettled([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/events/count`),
        fetch(`${API_BASE}/channels`),
      ])

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        const data: HealthData = await healthRes.value.json()
        setHealth(data)
        setFetchError(false)
      } else {
        setFetchError(true)
      }

      if (viewerRes.status === 'fulfilled' && viewerRes.value.ok) {
        const data: ViewerData = await viewerRes.value.json()
        setViewers(data.count)
      }

      if (chnlRes.status === 'fulfilled' && chnlRes.value.ok) {
        const data: Array<ChannelEntry> = await chnlRes.value.json()
        setChannels(data)
      }

      setLastChecked(new Date())
    } catch {
      setFetchError(true)
      setLastChecked(new Date())
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    intervalRef.current = setInterval(fetchHealth, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchHealth])

  // Derive infrastructure states
  const dbState: ServiceState = !health
    ? 'loading'
    : health.database === 'healthy'
      ? 'healthy'
      : 'unhealthy'
  const redisState: ServiceState = !health
    ? 'loading'
    : health.redis === 'healthy'
      ? 'healthy'
      : 'unhealthy'

  // Derive integration service states dynamically
  const getServiceState = (name: string): ServiceState => {
    if (!health) return 'loading'
    return (health.services[name] || 'unknown') as ServiceState
  }

  // lastChecked starts null, so this never renders during prerender —
  // no locale hydration mismatch.
  const lastCheckStat = lastChecked
    ? `LAST CHECK ${lastChecked.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`
    : 'CHECKING'

  const overall = fetchError
    ? { dot: 'bg-error', text: 'text-error-ink border-error/40' }
    : !health
      ? {
          dot: 'bg-base-content/25',
          text: 'text-base-subtle border-hairline',
        }
      : health.status === 'healthy'
        ? { dot: 'bg-primary', text: 'text-primary border-primary/40' }
        : { dot: 'bg-warning', text: 'text-warning-ink border-warning/40' }

  return (
    <div className="min-h-dvh">
      <PageHeader
        eyebrowLeft="STATUS ／ LIVE"
        eyebrowRight={`AUTO-REFRESH EVERY ${POLL_INTERVAL / 1000}S`}
        line1="All systems,"
        line2="plainly stated."
        sub={`The database, the cache, every channel worker. Rechecked every ${
          POLL_INTERVAL / 1000
        } seconds, straight from the same API the app reads.`}
        actions={
          <span
            className={`inline-flex items-center gap-2.5 rounded-[4px] border px-4 py-2.5 font-mono text-[12px] tracking-[0.12em] ${overall.text}`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${overall.dot} ${
                health || fetchError ? 'animate-pulse-dot' : ''
              }`}
            />
            {fetchError ? 'API UNREACHABLE' : overallLabel(health)}
          </span>
        }
      />

      {/* ── Infrastructure ───────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer className="pb-10">
          <motion.div {...reveal}>
            <SectionRow tag="SEC 01 ／ INFRASTRUCTURE" stat={lastCheckStat} />
            <LedgerRow
              code="INF—PG"
              name="PostgreSQL"
              detail="Primary data store + CDC source"
              right={<StateCell state={dbState} />}
            />
            <LedgerRow
              code="INF—RD"
              name="Redis"
              detail="Cache, Pub/Sub, token storage"
              right={<StateCell state={redisState} />}
            />
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Channel services ─────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer className="pb-10">
          <motion.div {...reveal}>
            <SectionRow
              tag="SEC 02 ／ CHANNEL SERVICES"
              stat={
                channels.length > 0
                  ? `${channels.length} REGISTERED`
                  : undefined
              }
            />
            {channels.length > 0 ? (
              channels.map((ch) => {
                const meta = CHANNEL_META[ch.name]
                return (
                  <LedgerRow
                    key={ch.name}
                    code={channelCode(ch.name)}
                    name={`${ch.display_name} Service`}
                    port={meta?.port}
                    detail={
                      meta?.description ??
                      (ch.capabilities.join(', ') || 'Channel service')
                    }
                    right={<StateCell state={getServiceState(ch.name)} />}
                  />
                )
              })
            ) : !fetchError ? (
              ['finance', 'sports', 'fantasy', 'rss'].map((name) => {
                const meta = CHANNEL_META[name]
                return (
                  <LedgerRow
                    key={name}
                    code={channelCode(name)}
                    name={`${name.charAt(0).toUpperCase() + name.slice(1)} Service`}
                    port={meta?.port}
                    detail={meta?.description ?? 'Channel service'}
                    right={<StateCell state={getServiceState(name)} />}
                  />
                )
              })
            ) : (
              // Mirrors LedgerRow's mobile stacking: badge + state share
              // the top row, the message spans full width beneath.
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[18px] gap-y-1 border-b border-hairline-minor px-2 py-5 sm:grid-cols-[90px_1fr_auto]">
                <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold text-error-ink">
                  <span
                    aria-hidden="true"
                    className="animate-pulse-dot h-[7px] w-[7px] rounded-[2px] bg-error/80"
                  />
                  CHN—??
                </span>
                <span className="order-last col-span-full text-sm text-base-muted sm:order-none sm:col-span-1">
                  Unable to discover channels. The API is not reachable from
                  this browser.
                </span>
                <span className="font-mono text-xs text-error-ink">
                  UNREACHABLE
                </span>
              </div>
            )}
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Live metrics ─────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer className="pb-10">
          <motion.div {...reveal}>
            <SectionRow tag="SEC 03 ／ LIVE METRICS" />
            <LedgerRow
              code="MET—SSE"
              name="SSE viewers"
              detail="Active connections"
              right={
                <span className="font-mono text-sm text-base-content">
                  {/* Live value rolls odometer-style on refresh */}
                  {viewers !== null ? (
                    <AnimateNumber style={{ verticalAlign: '0.055em' }}>
                      {viewers}
                    </AnimateNumber>
                  ) : (
                    '—'
                  )}
                </span>
              }
            />
            <LedgerRow
              code="MET—API"
              name="API status"
              detail={fetchError ? 'Cannot reach API' : 'Accepting requests'}
              right={
                <span
                  className={`font-mono text-[11px] tracking-[0.12em] ${
                    fetchError ? 'text-error-ink' : 'text-primary'
                  }`}
                >
                  {fetchError ? 'UNREACHABLE' : 'ONLINE'}
                </span>
              }
            />
            <LedgerRow
              code="MET—SYS"
              name="Overall"
              detail={
                !health
                  ? 'Waiting on first health check'
                  : health.status === 'healthy'
                    ? 'Every check passing'
                    : 'One or more checks failing'
              }
              right={
                <span
                  className={`font-mono text-[11px] tracking-[0.12em] ${
                    !health
                      ? 'text-base-subtle'
                      : health.status === 'healthy'
                        ? 'text-primary'
                        : 'text-warning-ink'
                  }`}
                >
                  {overallLabel(health)}
                </span>
              }
            />
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Endpoints ────────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer className="pb-10">
          <motion.div {...reveal}>
            <SectionRow
              tag="SEC 04 ／ ENDPOINTS"
              stat="SAME API THE APP USES"
            />
            <DeparturesRow
              index="01"
              label="API documentation"
              labelClassName="text-xl"
              meta="Swagger: every route, documented."
              action="OPEN ↗"
              href={`${API_BASE}/swagger/index.html`}
            />
            <DeparturesRow
              index="02"
              label="Health JSON"
              labelClassName="text-xl"
              meta="The raw feed this page renders."
              action="OPEN ↗"
              href={`${API_BASE}/health`}
            />
            <DeparturesRow
              index="03"
              label="API root"
              labelClassName="text-xl"
              meta="Hello from the platform."
              action="OPEN ↗"
              href={`${API_BASE}/`}
            />
          </motion.div>
        </TerminalContainer>
      </section>
    </div>
  )
}

// --- Sub-components ---

/** One ledger row: mono code | name (+ port) | muted detail | right cell. */
function LedgerRow({
  code,
  name,
  detail,
  port,
  right,
}: {
  code: string
  name: string
  detail: string
  port?: number
  right: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35, ease: EASE }}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-hairline-minor px-2 py-[15px] sm:grid-cols-[110px_220px_minmax(0,1fr)_auto] sm:gap-x-5"
    >
      <span className="hidden font-mono text-[11px] tracking-[0.1em] text-base-subtle sm:block">
        {code}
      </span>
      <span className="flex items-baseline gap-2 text-[15px] font-bold tracking-[0.01em] text-base-content">
        {name}
        {port != null && (
          <span className="font-mono text-[10px] font-normal text-base-subtle">
            :{port}
          </span>
        )}
      </span>
      <span className="order-last col-span-full min-w-0 text-[13px] text-base-muted sm:order-none sm:col-span-1 sm:truncate sm:text-sm">
        {detail}
      </span>
      <span className="justify-self-end">{right}</span>
    </motion.div>
  )
}

/** Pulsing dot + mono state label. */
function StateCell({ state }: { state: ServiceState }) {
  const s = STATE_STYLE[state]
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${s.dot} ${
          s.pulse ? 'animate-pulse-dot' : ''
        }`}
      />
      <span className={`font-mono text-[11px] tracking-[0.12em] ${s.text}`}>
        {STATE_LABEL[state]}
      </span>
    </span>
  )
}
