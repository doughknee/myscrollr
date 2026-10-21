import { Link } from '@tanstack/react-router'
import { Stamp, VerdictPill } from './ui'
import type { AdminOverview } from '@/api/admin'
import { EXPECTED_REPLICAS, formatAgeWords } from '@/lib/adminFormat'
import { MONITORED_FEEDS, isStale } from '@/lib/overviewVerdicts'

export function SystemHealth({ data }: { data: AdminOverview }) {
  const github = data.github
  return (
    <div className="admin-system-health">
      <section aria-labelledby="system-feeds-title">
        <div className="admin-system-section-heading">
          <div>
            <h2 id="system-feeds-title">Data feeds</h2>
            <p>Last recorded updates to scores, prices and news.</p>
          </div>
          <Stamp at={data.generated_at} />
        </div>
        <ul className="admin-system-feed-list">
          {MONITORED_FEEDS.map((feed) => {
            const reading = data.ingest?.find((row) => row.table === feed.table)
            const verdict = !reading
              ? { tone: 'none' as const, label: 'Unavailable' }
              : !reading.has_data
                ? { tone: 'bad' as const, label: 'No data' }
                : isStale(reading)
                  ? { tone: 'warn' as const, label: 'Stale' }
                  : { tone: 'good' as const, label: 'Within window' }
            return (
              <li key={feed.table}>
                <div>
                  <h3>{feed.name}</h3>
                  <p>
                    {reading?.has_data
                      ? formatAgeWords(reading.age_seconds)
                      : 'No update available'}
                  </p>
                </div>
                <VerdictPill verdict={verdict} />
              </li>
            )
          })}
        </ul>
        <details className="admin-system-notes">
          <summary>How freshness is measured</summary>
          <p>
            These are database update ages at the snapshot time, not upstream
            latency or an uptime guarantee. Scores get a 12-hour window because
            games pause overnight; prices and news get 30 minutes. A quiet
            market can exceed that window without an outage.
          </p>
        </details>
      </section>
      <section aria-labelledby="system-connections-title">
        <div className="admin-system-section-heading">
          <div>
            <h2 id="system-connections-title">Connections</h2>
            <p>Reporting servers and linked GitHub accounts.</p>
          </div>
        </div>
        <dl className="admin-system-connections">
          <div>
            <dt>Core servers reporting</dt>
            <dd>
              {data.connected_now.replicas}{' '}
              <span>of {EXPECTED_REPLICAS} expected</span>
            </dd>
          </div>
          <div>
            <dt>Live stream connections</dt>
            <dd>
              {data.connected_now.count.toLocaleString()}{' '}
              <span>connections, not people</span>
            </dd>
          </div>
          <div>
            <dt>GitHub connections</dt>
            <dd>
              {github ? github.connections.toLocaleString() : 'Unavailable'}
              {github && (
                <span data-attention={github.broken > 0 || undefined}>
                  {github.broken > 0
                    ? `${github.broken} need reconnecting`
                    : github.connections > 0
                      ? 'None flagged for reconnect'
                      : 'None linked yet'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Last successful GitHub response</dt>
            <dd className="admin-system-date">
              {github?.last_ok ? (
                <time dateTime={github.last_ok}>
                  {new Date(github.last_ok).toLocaleString()}
                </time>
              ) : github ? (
                'No successful response recorded'
              ) : (
                'Unavailable'
              )}
            </dd>
          </div>
        </dl>
        <Link to="/status" className="admin-system-status-link">
          Public service status <span aria-hidden>↗</span>
        </Link>
      </section>
    </div>
  )
}
