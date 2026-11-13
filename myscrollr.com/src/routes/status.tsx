/**
 * /status — live platform health as a terminal ledger.
 *
 * Polls /health + /events/count every 30s. Workers are listed from the
 * /health report itself.
 * Every service the previous page monitored is still here — the skin
 * moved from cards to ledger rows with pulsing status dots.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import type { ReactNode } from 'react'
import type { HealthData, ServiceState } from '@/lib/statusHealth'
import { seo } from '@/lib/seo'
import { organization } from '@/lib/structured-data'
import { API_BASE } from '@/api/client'
import { classifyState, parseHealth } from '@/lib/statusHealth'
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
      jsonLd: organization,
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

interface ViewerData {
  count: number
}

type StateKind = ServiceState | 'loading'

/** Known workers: mono ledger code, name and what each one does. */
const SERVICE_META: Partial<
  Record<string, { code: string; name: string; description: string }>
> = {
  finance: {
    code: 'SVC—FIN',
    name: 'Finance',
    description: 'TwelveData WebSocket · real-time market data',
  },
  sports: {
    code: 'SVC—SPT',
    name: 'Sports',
    description: 'api-sports.io · live scores and schedules',
  },
  rss: {
    code: 'SVC—RSS',
    name: 'News',
    description: 'RSS/Atom/JSON · feed aggregation every 5 min',
  },
}

const KNOWN_SERVICES = ['finance', 'sports', 'rss']

function serviceMeta(name: string) {
  return (
    SERVICE_META[name] ?? {
      code: `SVC—${name.slice(0, 3).toUpperCase()}`,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: 'Ingestion worker',
    }
  )
}

// --- Helpers ---

const POLL_INTERVAL = 30_000

const STATE_LABEL: Record<StateKind, string> = {
  healthy: 'OPERATIONAL',
  unhealthy: 'DEGRADED',
  down: 'DOWN',
  unknown: 'UNKNOWN',
  loading: 'CHECKING',
}

/** Emerald up / amber degraded / red down; muted while unknown. */
const STATE_STYLE: Record<
  StateKind,
  { dot: string; text: string; pulse: boolean }
> = {
  healthy: { dot: 'bg-primary', text: 'text-primary', pulse: true },
  unhealthy: { dot: 'bg-warning', text: 'text-warning', pulse: true },
  down: { dot: 'bg-error', text: 'text-error', pulse: true },
  unknown: {
    dot: 'bg-base-content/25',
    text: 'text-base-content/40',
    pulse: false,
  },
  loading: {
    dot: 'bg-base-content/25',
    text: 'text-base-content/40',
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
  const [viewers, setViewers] = useState<number | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [fetchError, setFetchError] = useState(false)
  const [checking, setChecking] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchHealth = useCallback(async () => {
    setChecking(true)
    const [healthRes, viewerRes] = await Promise.allSettled([
      fetch(`${API_BASE}/health`),
      fetch(`${API_BASE}/events/count`),
    ])

    // Core answers 503 with the full report when anything is degraded, so
    // read the body whatever the status. Only "nothing answered" or "not a
    // report" is unreachable.
    let report: HealthData | null = null
    if (healthRes.status === 'fulfilled') {
      report = parseHealth(await healthRes.value.json().catch(() => null))
    }
    if (report) {
      setHealth(report)
      setFetchError(false)
    } else {
      setHealth(null)
      setFetchError(true)
    }

    if (viewerRes.status === 'fulfilled' && viewerRes.value.ok) {
      const data: ViewerData | null = await viewerRes.value
        .json()
        .catch(() => null)
      if (typeof data?.count === 'number') setViewers(data.count)
    }

    setLastChecked(new Date())
    setChecking(false)
  }, [])

  useEffect(() => {
    fetchHealth()
    intervalRef.current = setInterval(fetchHealth, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchHealth])

  // Derive infrastructure states
  const infraState = (value: string | undefined): StateKind =>
    fetchError ? 'unknown' : !health ? 'loading' : classifyState(value).state
  const dbState = infraState(health?.database)
  const redisState = infraState(health?.redis)

  // Workers come from the report itself; before the first answer the known
  // three show as CHECKING.
  const serviceNames = health ? Object.keys(health.services) : KNOWN_SERVICES

  const failing = health
    ? [
        health.database !== 'healthy' && 'PostgreSQL',
        health.redis !== 'healthy' && 'Redis',
        ...Object.entries(health.services)
          .filter(([, v]) => v !== 'healthy' && v !== 'idle')
          .map(([n]) => serviceMeta(n).name),
      ].filter(Boolean)
    : []

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
    ? { dot: 'bg-error', text: 'text-error border-error/40' }
    : !health
      ? {
          dot: 'bg-base-content/25',
          text: 'text-base-content/45 border-hairline',
        }
      : health.status === 'healthy'
        ? { dot: 'bg-primary', text: 'text-primary border-primary/40' }
        : { dot: 'bg-warning', text: 'text-warning border-warning/40' }

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
              tag="SEC 02 ／ WORKERS"
              stat={
                health && serviceNames.length > 0
                  ? `${serviceNames.length} REPORTING`
                  : undefined
              }
            />
            {serviceNames.length > 0 ? (
              serviceNames.map((name) => {
                const meta = serviceMeta(name)
                const { state, label } = classifyState(health?.services[name])
                return (
                  <LedgerRow
                    key={name}
                    code={meta.code}
                    name={`${meta.name} Service`}
                    detail={meta.description}
                    right={
                      <StateCell
                        state={
                          fetchError ? 'unknown' : !health ? 'loading' : state
                        }
                        label={health && !fetchError ? label : undefined}
                      />
                    }
                  />
                )
              })
            ) : (
              <p className="border-b border-hairline-minor px-2 py-5 text-sm text-base-content/55">
                This report did not list any workers.
              </p>
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
              detail={
                fetchError
                  ? 'No usable answer from the API'
                  : 'Accepting requests'
              }
              right={
                <span className="flex items-center gap-3">
                  <span
                    className={`font-mono text-[11px] tracking-[0.12em] ${
                      fetchError ? 'text-error' : 'text-primary'
                    }`}
                  >
                    {fetchError ? 'UNREACHABLE' : 'ONLINE'}
                  </span>
                  <button
                    type="button"
                    onClick={fetchHealth}
                    disabled={checking}
                    className="cursor-pointer rounded-[4px] border border-hairline px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] text-base-content/70 transition-colors hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-50"
                  >
                    {checking ? 'CHECKING' : 'RETRY'}
                  </button>
                </span>
              }
            />
            <LedgerRow
              code="MET—SYS"
              name="Overall"
              detail={
                fetchError
                  ? 'No health report to read'
                  : !health
                    ? 'Waiting on first health check'
                    : health.status === 'healthy'
                      ? 'Every check passing'
                      : failing.length > 0
                        ? `Not healthy: ${failing.join(', ')}`
                        : 'One or more checks failing'
              }
              right={
                <span
                  className={`font-mono text-[11px] tracking-[0.12em] ${
                    !health
                      ? 'text-base-content/40'
                      : health.status === 'healthy'
                        ? 'text-primary'
                        : 'text-warning'
                  }`}
                >
                  {fetchError ? 'NO REPORT' : overallLabel(health)}
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
      <span className="hidden font-mono text-[11px] tracking-[0.1em] text-base-content/40 sm:block">
        {code}
      </span>
      <span className="flex items-baseline gap-2 text-[15px] font-bold tracking-[0.01em] text-base-content">
        {name}
        {port != null && (
          <span className="font-mono text-[10px] font-normal text-base-content/35">
            :{port}
          </span>
        )}
      </span>
      <span className="order-last col-span-full min-w-0 text-[13px] text-base-content/50 sm:order-none sm:col-span-1 sm:truncate sm:text-sm">
        {detail}
      </span>
      <span className="justify-self-end">{right}</span>
    </motion.div>
  )
}

/** Pulsing dot + mono state label. */
function StateCell({ state, label }: { state: StateKind; label?: string }) {
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
        {label ?? STATE_LABEL[state]}
      </span>
    </span>
  )
}
