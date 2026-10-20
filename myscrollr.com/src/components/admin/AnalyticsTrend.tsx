import { useState } from 'react'
import type { Bucket } from '@/api/adminDashboard'
import { bucketLabel } from '@/lib/adminFormat'

/** Reported buckets only: linear segments, zero baseline, no invented smoothing. */
export function AnalyticsTrend({
  buckets,
  step,
  title,
  unit,
  kind = 'bars',
  format = (value: number) => value.toLocaleString(),
}: {
  buckets: Array<Bucket> | null | undefined
  step: string
  title: string
  unit: string
  kind?: 'bars' | 'line'
  format?: (value: number) => string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const rows = buckets ?? []
  const allZero = rows.length > 0 && rows.every((row) => row.value === 0)
  const active = rows.find((row) => row.start === selected) ?? rows.at(-1)
  const max = Math.max(
    2,
    Math.ceil(Math.max(0, ...rows.map((r) => r.value)) / 2) * 2,
  )
  const min = Math.min(0, ...rows.map((r) => r.value))
  const y = (value: number) => 200 - ((value - min) / (max - min)) * 180
  const x = (index: number) => ((index + 0.5) / rows.length) * 600
  const points = rows.map((row, index) => `${x(index)},${y(row.value)}`)
  const activeIndex = active ? rows.indexOf(active) : -1

  return (
    <figure className="analytics-trend">
      <figcaption>
        <div>
          <h3>{title}</h3>
          <p>{unit} · UTC</p>
        </div>
        <div className="analytics-trend-readout" aria-live="polite">
          {active ? (
            <>
              <strong>{format(active.value)}</strong>
              <span>
                {bucketLabel(active.start, step)}
                {active.partial ? ' · partial' : ''}
              </span>
            </>
          ) : (
            <span>No observations</span>
          )}
        </div>
      </figcaption>
      {rows.length ? (
        <>
          <div className="analytics-trend-canvas">
            <div className="analytics-trend-scale" aria-hidden="true">
              <span>{allZero ? '' : format(max)}</span>
              <span>{allZero ? '' : format((max + min) / 2)}</span>
              <span>{format(min)}</span>
            </div>
            <div className="analytics-trend-drawing">
              <svg
                viewBox="0 0 600 220"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {(allZero ? [0] : [max, (max + min) / 2, min]).map((value) => (
                  <line
                    key={value}
                    x1="0"
                    x2="600"
                    y1={y(value)}
                    y2={y(value)}
                    className="analytics-gridline"
                  />
                ))}
                {min < 0 && (
                  <line
                    x1="0"
                    x2="600"
                    y1={y(0)}
                    y2={y(0)}
                    className="analytics-zero"
                  />
                )}
                {kind === 'line' ? (
                  <>
                    <path
                      d={`M${x(0)},${y(0)} L${points.join(' L')} L${x(rows.length - 1)},${y(0)} Z`}
                      className="analytics-trend-fill"
                    />
                    <polyline
                      points={points.join(' ')}
                      className="analytics-trend-line"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : (
                  rows.map((row, index) => (
                    <rect
                      key={row.start}
                      x={(index * 600) / rows.length + 3}
                      y={Math.min(y(0), y(row.value))}
                      width={Math.max(1, 600 / rows.length - 6)}
                      height={Math.max(1, Math.abs(y(row.value) - y(0)))}
                      rx="3"
                      className={
                        row === active
                          ? 'analytics-bar is-selected'
                          : 'analytics-bar'
                      }
                      opacity={row.partial ? 0.5 : 1}
                    />
                  ))
                )}
                {active && (
                  <>
                    <line
                      x1={x(activeIndex)}
                      x2={x(activeIndex)}
                      y1="10"
                      y2="205"
                      className="analytics-crosshair"
                    />
                    {kind === 'line' && (
                      <circle
                        cx={x(activeIndex)}
                        cy={y(active.value)}
                        r="4"
                        className="analytics-trend-dot"
                      />
                    )}
                  </>
                )}
              </svg>
              <div
                className="analytics-trend-targets"
                role="group"
                aria-label={title}
              >
                {rows.map((row) => (
                  <button
                    key={row.start}
                    type="button"
                    aria-label={`${bucketLabel(row.start, step)}: ${format(row.value)}${row.partial ? ', partial bucket' : ''}`}
                    aria-pressed={row === active}
                    onClick={() => setSelected(row.start)}
                    onFocus={() => setSelected(row.start)}
                    onPointerEnter={() => setSelected(row.start)}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="analytics-trend-footer">
            <span>{bucketLabel(rows[0].start, step)}</span>
            <span>{bucketLabel(rows[rows.length - 1].start, step)}</span>
          </div>
          <p className="analytics-trend-hint">
            {allZero
              ? 'Every reported bucket is zero. Select a date to inspect.'
              : 'Hover or select a date to inspect.'}
            {rows.some((row) => row.partial)
              ? ' Partial buckets are included and labelled.'
              : ''}
          </p>
        </>
      ) : (
        <p className="signup-trend-empty">No observations in this window.</p>
      )}
    </figure>
  )
}
