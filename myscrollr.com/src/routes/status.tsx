import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  Server,
  ShieldAlert,
  Users,
  XCircle,
  Zap,
} from 'lucide-react'
import { motion } from 'motion/react'
import type { ComponentType } from 'react'
import { seo } from '@/lib/seo'
import { API_BASE } from '@/api/client'

export const Route = createFileRoute('/status')({
  head: () =>
    seo({
      title: 'System Status — Scrollr',
      description:
        'Live system status for the Scrollr platform. Monitor infrastructure, ingestion workers, and API health.',
      path: '/status',
      noindex: true,
    }),
  component: StatusPage,
})

// ── Signature easing (matches homepage) ────────────────────────
const EASE = [0.22, 1, 0.36, 1] as const

// ── Hex colors for card accents ────────────────────────────────
const HEX = {
  primary: '#34d399',
  secondary: '#ff4757',
  info: '#00b8db',
  accent: '#a855f7',
  warning: '#f59e0b',
} as const

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

/** Known channel metadata — used for descriptions and port display. */
interface ChannelMeta {
  description: string
  port?: number
  hex: string
  Icon: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

const CHANNEL_META: Partial<Record<string, ChannelMeta>> = {
  finance: {
    description: 'TwelveData WebSocket — real-time market data',
    port: 3001,
    hex: HEX.primary,
    Icon: TrendingUpIcon,
  },
  sports: {
    description: 'ESPN API — scores polling every 60s',
    port: 3002,
    hex: HEX.secondary,
    Icon: ActivityIcon,
  },
  fantasy: {
    description: 'Yahoo Fantasy — Go-native sync, no Rust ingestion',
    port: 8084,
    hex: HEX.accent,
    Icon: UsersIcon,
  },
  rss: {
    description: 'RSS/Atom/JSON — feed aggregation every 5 min',
    port: 3004,
    hex: HEX.info,
    Icon: GlobeIcon,
  },
}

// Lucide icon wrappers for the type system
function TrendingUpIcon(props: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return <Zap {...props} />
}
function ActivityIcon(props: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return <Activity {...props} />
}
function UsersIcon(props: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return <Users {...props} />
}
function GlobeIcon(props: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return <Globe {...props} />
}

// --- Helpers ---

const POLL_INTERVAL = 30_000

function stateToLabel(state: ServiceState): string {
  const map: Record<ServiceState, string> = {
    healthy: 'Operational',
    unhealthy: 'Degraded',
    down: 'Down',
    unknown: 'Unknown',
    loading: 'Checking...',
  }
  return map[state]
}

function overallLabel(health: HealthData | null): string {
  if (!health) return 'Checking...'
  if (health.status === 'healthy') return 'All Systems Operational'
  if (health.status === 'degraded') return 'Partial Degradation'
  return 'Major Outage'
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

  return (
    <div className="min-h-screen pt-20">
      {/* ── Hero ── */}
      <section className="relative pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
        <div className="container relative z-10">
          <motion.div
            className="text-center"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              System <span className="text-gradient-primary">Status</span>
            </h1>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto mb-8">
              Live infrastructure health for the Scrollr platform.
              Auto-refreshes every {POLL_INTERVAL / 1000} seconds.
            </p>

            {/* Overall badge + last checked */}
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <OverallBadge health={health} fetchError={fetchError} />
              {lastChecked && (
                <span className="text-xs font-mono text-base-content/30 flex items-center gap-1.5">
                  <Clock size={12} />
                  {lastChecked.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Infrastructure + Integration Grid ── */}
      <section className="relative overflow-hidden">
        <div className="container py-16 lg:py-24">
          <motion.div
            className="text-center mb-12 sm:mb-16"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Service <span className="text-gradient-primary">Health</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Infrastructure and ingestion worker status across all services
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Infrastructure Card */}
            <motion.div
              className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-8 overflow-hidden group"
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              {/* Accent top line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${HEX.primary} 50%, transparent)`,
                }}
              />
              {/* Corner dot grid */}
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              {/* Hover glow orb */}
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `${HEX.primary}10` }}
              />

              {/* Header with icon badge */}
              <div className="flex items-center gap-3 mb-8">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: `${HEX.primary}15`,
                    boxShadow: `0 0 20px ${HEX.primary}15, 0 0 0 1px ${HEX.primary}20`,
                  }}
                >
                  <Database size={20} className="text-base-content/80" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-base-content">
                  Infrastructure
                </h3>
              </div>

              <div className="space-y-3">
                <ServiceRow
                  name="PostgreSQL"
                  description="Primary data store + CDC source"
                  state={dbState}
                  hex={HEX.primary}
                />
                <ServiceRow
                  name="Redis"
                  description="Cache, Pub/Sub, token storage"
                  state={redisState}
                  hex={HEX.secondary}
                />
              </div>

              {/* Watermark */}
              <Database
                size={130}
                strokeWidth={0.4}
                className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
              />
            </motion.div>

            {/* Integration Services Card */}
            <motion.div
              className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-8 overflow-hidden group"
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
            >
              {/* Accent top line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${HEX.info} 50%, transparent)`,
                }}
              />
              {/* Corner dot grid */}
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              {/* Hover glow orb */}
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `${HEX.info}10` }}
              />

              {/* Header with icon badge */}
              <div className="flex items-center gap-3 mb-8">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: `${HEX.info}15`,
                    boxShadow: `0 0 20px ${HEX.info}15, 0 0 0 1px ${HEX.info}20`,
                  }}
                >
                  <Server size={20} className="text-base-content/80" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-base-content">
                  Channel Services
                </h3>
                {channels.length > 0 && (
                  <span className="text-[10px] font-mono text-base-content/30 bg-base-300/50 px-2 py-0.5 rounded-lg ml-auto">
                    {channels.length} registered
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {channels.length > 0 ? (
                  channels.map((ch) => {
                    const meta = CHANNEL_META[ch.name]
                    return (
                      <ServiceRow
                        key={ch.name}
                        name={`${ch.display_name} Service`}
                        description={
                          meta?.description ??
                          (ch.capabilities.join(', ') || 'Channel service')
                        }
                        state={getServiceState(ch.name)}
                        port={meta?.port}
                        hex={meta?.hex ?? HEX.primary}
                      />
                    )
                  })
                ) : !fetchError ? (
                  <>
                    {['finance', 'sports', 'fantasy', 'rss'].map((name) => {
                      const meta = CHANNEL_META[name]
                      return (
                        <ServiceRow
                          key={name}
                          name={`${name.charAt(0).toUpperCase() + name.slice(1)} Service`}
                          description={meta?.description ?? 'Channel service'}
                          state={getServiceState(name)}
                          port={meta?.port}
                          hex={meta?.hex ?? HEX.primary}
                        />
                      )
                    })}
                  </>
                ) : (
                  <div className="text-xs text-base-content/30 text-center py-8">
                    Unable to discover channels
                  </div>
                )}
              </div>

              {/* Watermark */}
              <Server
                size={130}
                strokeWidth={0.4}
                className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Metrics Strip ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
        <div className="container py-16 lg:py-24">
          <motion.div
            className="text-center mb-12 sm:mb-16"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Live <span className="text-gradient-primary">Metrics</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Real-time platform telemetry at a glance
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <MetricCard
              Icon={Users}
              label="SSE Viewers"
              value={viewers !== null ? String(viewers) : '--'}
              sublabel="Active connections"
              hex={HEX.info}
              delay={0}
            />
            <MetricCard
              Icon={Zap}
              label="API Status"
              value={fetchError ? 'Unreachable' : 'Online'}
              sublabel={fetchError ? 'Cannot reach API' : 'Accepting requests'}
              hex={fetchError ? HEX.warning : HEX.primary}
              delay={0.1}
            />
            <MetricCard
              Icon={Activity}
              label="Overall"
              value={
                !health
                  ? 'Checking'
                  : health.status === 'healthy'
                    ? 'Healthy'
                    : 'Degraded'
              }
              sublabel={overallLabel(health)}
              hex={
                health !== null && health.status !== 'healthy'
                  ? HEX.warning
                  : HEX.primary
              }
              delay={0.2}
            />
          </div>
        </div>
      </section>

      {/* ── External Links ── */}
      <section className="relative overflow-hidden">
        <div className="container py-16 lg:py-24">
          <motion.div
            className="text-center mb-12 sm:mb-16"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              API <span className="text-gradient-primary">Resources</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Direct access to platform endpoints and documentation
            </p>
          </motion.div>

          <motion.div
            className="flex flex-wrap justify-center gap-4"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <ExternalLink
              href={`${API_BASE}/swagger/index.html`}
              label="API Documentation"
            />
            <ExternalLink href={`${API_BASE}/health`} label="Health JSON" />
            <ExternalLink href={`${API_BASE}/`} label="API Root" />
          </motion.div>
        </div>
      </section>
    </div>
  )
}

// --- Sub-components ---

function OverallBadge({
  health,
  fetchError,
}: {
  health: HealthData | null
  fetchError: boolean
}) {
  if (fetchError) {
    return (
      <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-lg bg-error/10 border border-error/20">
        <XCircle size={16} className="text-error" />
        <span className="text-xs font-semibold text-error">
          API Unreachable
        </span>
      </div>
    )
  }

  if (!health) {
    return (
      <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-lg bg-base-300/50 border border-base-300/25">
        <div className="h-3 w-3 rounded-full bg-base-content/20 animate-pulse" />
        <span className="text-xs font-semibold text-base-content/40">
          Checking systems...
        </span>
      </div>
    )
  }

  const isHealthy = health.status === 'healthy'

  return (
    <div
      className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-lg border ${
        isHealthy
          ? 'bg-success/10 border-success/20'
          : 'bg-warning/10 border-warning/20'
      }`}
    >
      {isHealthy ? (
        <CheckCircle2 size={16} className="text-success" />
      ) : (
        <ShieldAlert size={16} className="text-warning" />
      )}
      <span
        className={`text-xs font-semibold ${isHealthy ? 'text-success' : 'text-warning'}`}
      >
        {overallLabel(health)}
      </span>
    </div>
  )
}

function ServiceRow({
  name,
  description,
  state,
  port,
  hex,
}: {
  name: string
  description: string
  state: ServiceState
  port?: number
  hex: string
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-base-200/40 border border-base-300/25 rounded-xl group/row hover:border-base-300/50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-base-content">{name}</span>
          {port && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded-lg"
              style={{
                background: `${hex}10`,
                color: hex,
              }}
            >
              :{port}
            </span>
          )}
        </div>
        <p className="text-[10px] text-base-content/30 mt-0.5 truncate">
          {description}
        </p>
      </div>
      <StatusIndicator state={state} />
    </div>
  )
}

function StatusIndicator({ state }: { state: ServiceState }) {
  const config: Record<
    ServiceState,
    { dot: string; text: string; ping?: boolean }
  > = {
    healthy: { dot: 'bg-success', text: 'text-success', ping: true },
    unhealthy: { dot: 'bg-warning', text: 'text-warning' },
    down: { dot: 'bg-error', text: 'text-error' },
    unknown: { dot: 'bg-base-content/20', text: 'text-base-content/30' },
    loading: { dot: 'bg-base-content/20', text: 'text-base-content/30' },
  }

  const { dot, text, ping } = config[state]

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <span className="relative flex h-2 w-2">
        {ping && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${dot}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${dot} ${state === 'loading' ? 'animate-pulse' : ''}`}
        />
      </span>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wide ${text}`}
      >
        {stateToLabel(state)}
      </span>
    </div>
  )
}

function MetricCard({
  Icon,
  label,
  value,
  sublabel,
  hex,
  delay = 0,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  sublabel: string
  hex: string
  delay?: number
}) {
  return (
    <motion.div
      className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden group"
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
        }}
      />
      {/* Corner dot grid */}
      <div
        className="absolute top-0 right-0 w-16 h-16 opacity-[0.04] text-base-content"
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />
      {/* Hover glow orb */}
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `${hex}10` }}
      />

      <div className="flex items-start gap-4 relative z-10">
        {/* Icon badge */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `${hex}15`,
            boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
          }}
        >
          <Icon size={20} className="text-base-content/80" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-base-content/30 mb-1">
            {label}
          </p>
          <p className="text-lg font-black tracking-tight text-base-content">
            {value}
          </p>
          <p className="text-[10px] text-base-content/20 mt-0.5">{sublabel}</p>
        </div>
      </div>
    </motion.div>
  )
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-outline btn-sm gap-2"
    >
      <Globe size={14} />
      {label}
      <ArrowUpRight size={12} className="opacity-50" />
    </a>
  )
}
