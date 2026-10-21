import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { num, pct } from './ui'
import type { WidgetRow, WidgetsReport } from '@/api/adminDashboard'
import { comparisonDisplay, formatHours } from '@/lib/adminFormat'

type View = 'audience' | 'time' | 'setup'
type Sort = 'users' | 'user_hours' | 'screen_hours'
const columns: Record<View, Array<string>> = {
  audience: ['Users', 'Share', 'Repeat users'],
  time: ['Users', 'User-hours', 'Screen-hours'],
  setup: ['Added', 'Removed', 'Enabled'],
}

/** A fixed-width reading surface: secondary metrics change, the layout does not. */
export function AnalyticsWidgetTable({ widgets }: { widgets: WidgetsReport }) {
  const [view, setView] = useState<View>('audience')
  const [sort, setSort] = useState<Sort>('users')
  const [query, setQuery] = useState('')
  const allRows = widgets.rows ?? []
  const term = query.trim().toLowerCase()
  const rows = [...allRows]
    .filter((row) =>
      `${row.name} ${row.widget_type} ${row.category}`
        .toLowerCase()
        .includes(term),
    )
    .sort((a, b) => b[sort] - a[sort])
  const categories = widgets.categories ?? []

  if (!allRows.length && !categories.length) {
    return (
      <p className="signup-trend-empty">
        No widget was displayed on a measured ticker in this window.
      </p>
    )
  }

  return (
    <section
      className="analytics-widget-browser"
      aria-label="Widget measurements"
    >
      <div
        className="analytics-widget-views"
        role="group"
        aria-label="Widget metrics"
      >
        {(['audience', 'time', 'setup'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {
              {
                audience: 'Audience',
                time: 'Time on screen',
                setup: 'Configuration',
              }[value]
            }
          </button>
        ))}
      </div>
      <div className="analytics-widget-tools">
        <label className="analytics-widget-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            aria-label="Find a widget"
            placeholder="Find a widget…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            aria-label="Clear widget search"
            disabled={!query}
            onClick={() => setQuery('')}
          >
            <X size={14} aria-hidden />
          </button>
        </label>
        <select
          aria-label="Sort widgets by"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="users">Most users</option>
          <option value="user_hours">Most user-hours</option>
          <option value="screen_hours">Most screen-hours</option>
        </select>
      </div>
      <p className="analytics-widget-count" role="status">
        {term
          ? `${num(rows.length)} of ${num(allRows.length)} widgets`
          : `${num(allRows.length)} widgets`}{' '}
        · {num(widgets.measured_ticker_users)} measured ticker users
      </p>
      <div className="analytics-widget-table-wrap">
        <table className="analytics-widget-table">
          <caption className="sr-only">
            Widget {view} measurements, sorted by {sort.replaceAll('_', ' ')}
          </caption>
          <colgroup>
            <col className="analytics-widget-name-column" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Widget</th>
              {columns[view].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.widget_type}>
                <th scope="row">
                  <span title={row.name || row.widget_type}>
                    {row.name || row.widget_type}
                  </span>
                  <small>{row.category}</small>
                </th>
                {view === 'setup' ? (
                  <>
                    <td>
                      {widgets.changes_available ? `+${num(row.added)}` : '—'}
                    </td>
                    <td>
                      {widgets.changes_available ? `−${num(row.removed)}` : '—'}
                    </td>
                    <td>
                      {num(row.enabled)}
                      <small
                        aria-label={`of ${num(row.configured)} configured widgets`}
                      >
                        of {num(row.configured)} total
                      </small>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {num(row.users)}
                      <WidgetChange row={row} />
                    </td>
                    {view === 'audience' ? (
                      <>
                        <td>
                          {pct(row.share)}
                          <span className="analytics-widget-share" aria-hidden>
                            <span
                              style={{
                                width: `${Math.max(0, Math.min(1, row.share)) * 100}%`,
                              }}
                            />
                          </span>
                        </td>
                        <td>
                          {row.repeat_users === null
                            ? '—'
                            : num(row.repeat_users)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{formatHours(row.user_hours)}</td>
                        <td>{formatHours(row.screen_hours)}</td>
                      </>
                    )}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="analytics-widget-no-results">
            No widgets match “{query.trim()}”. Try a name or category.
          </p>
        )}
      </div>
      <p className="analytics-widget-footnote">
        {view === 'audience'
          ? 'Share is of measured ticker users. Repeat users show “—” for windows under 7 days.'
          : view === 'time'
            ? 'User-hours count time per person; screen-hours include multiple screens.'
            : widgets.changes_available
              ? 'Added and removed are changes in this window. Enabled and configured are current totals.'
              : widgets.changes_note ||
                'Added and removed are unavailable for this population. Enabled and configured are current totals.'}
      </p>
      {categories.length > 0 && (
        <details className="analytics-widget-categories">
          <summary>
            Category totals <span>{num(categories.length)} categories</span>
          </summary>
          <div className="analytics-category-table-wrap">
            <table className="analytics-widget-table analytics-category-table">
              <caption className="sr-only">
                Category totals for the full selected population
              </caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Users</th>
                  <th scope="col">Share</th>
                  <th scope="col">User-hours</th>
                  <th scope="col">Screen-hours</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.category}>
                    <th scope="row">
                      <span>{category.category}</span>
                      <small>{num(category.widgets)} types</small>
                    </th>
                    <td>{num(category.users)}</td>
                    <td>{pct(category.share)}</td>
                    <td>{formatHours(category.user_hours)}</td>
                    <td>{formatHours(category.screen_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function WidgetChange({ row }: { row: WidgetRow }) {
  const change = comparisonDisplay(row.comparison)
  const label =
    change.delta === null
      ? change.note
      : `${change.delta}${change.pct ? ` (${change.pct})` : ''} users versus the previous period${change.note ? `. ${change.note}` : ''}`
  return (
    <small className="analytics-widget-change" title={label} aria-label={label}>
      {change.delta === null ? 'No comparison' : `${change.delta} vs prior`}
    </small>
  )
}
