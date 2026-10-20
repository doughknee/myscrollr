import { useState } from 'react'
import type { Bucket } from '@/api/adminDashboard'
import { bucketLabel } from '@/lib/adminFormat'

/** A count chart: one selectable, keyboard-accessible bar per reported bucket. */
export function SignupTrend({
  buckets,
  step,
}: {
  buckets: Array<Bucket> | null | undefined
  step: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const rows = buckets ?? []
  const active = rows.find((row) => row.start === selected) ?? rows.at(-1)
  const peak = Math.max(
    2,
    Math.ceil(Math.max(0, ...rows.map((row) => row.value)) / 2) * 2,
  )

  return (
    <figure className="signup-trend">
      <figcaption className="signup-trend-heading">
        <div>
          <h3>New accounts over time</h3>
          <p>Account registrations · UTC</p>
        </div>
        <span className="signup-trend-readout" aria-live="polite">
          {active ? (
            <>
              <strong>{active.value.toLocaleString()}</strong>{' '}
              {bucketLabel(active.start, step)}
              {active.partial ? ' · partial' : ''}
            </>
          ) : (
            'No observations'
          )}
        </span>
      </figcaption>
      {rows.length ? (
        <>
          <div className="signup-trend-plot">
            <div className="signup-trend-axis" aria-hidden="true">
              <span>{peak}</span>
              <span>{Math.round(peak / 2)}</span>
              <span>0</span>
            </div>
            <div
              className="signup-trend-bars"
              role="group"
              aria-label="Sign-ups per bucket"
            >
              {rows.map((row) => (
                <button
                  type="button"
                  key={row.start}
                  aria-label={`${bucketLabel(row.start, step)}: ${row.value} registrations${row.partial ? ', partial bucket' : ''}`}
                  aria-pressed={active?.start === row.start}
                  onClick={() => setSelected(row.start)}
                  onFocus={() => setSelected(row.start)}
                  title={`${bucketLabel(row.start, step)}: ${row.value}${row.partial ? ' (partial)' : ''}`}
                >
                  <span
                    className={row.partial ? 'is-partial' : undefined}
                    style={{ height: `${(row.value / peak) * 100}%` }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="signup-trend-dates">
            <span>{bucketLabel(rows[0].start, step)}</span>
            <span>{bucketLabel(rows[rows.length - 1].start, step)}</span>
          </div>
          <p className="signup-trend-hint">
            Select a bar to inspect its count.
            {rows.some((row) => row.partial)
              ? ' Striped bars cover partial buckets.'
              : ''}
          </p>
        </>
      ) : (
        <p className="signup-trend-empty">No observations in this window.</p>
      )}
    </figure>
  )
}
