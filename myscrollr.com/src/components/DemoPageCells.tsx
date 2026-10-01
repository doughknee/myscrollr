/**
 * The page cells of the marketing demo bar (SCROLLR-198), ported from
 * desktop/src/components/pages/cells/ (GameCell, NewsCell, QuoteCell,
 * AlsoCell, parts) and chips/Sparkline. Same grammar, same widths, same
 * reservations (CHIP_SPEC §P.9); only the colour tokens differ: the bar
 * sets --fg, --fg-2, --fg-3, --fg-4, --live, --up and --down from the
 * demo palette, and each page sets --accent to its widget's colour.
 *
 * No shell: a cell sits straight on the bar. Nothing moves when a value
 * changes: scores hold the league's characters, the clock box is a fixed
 * width, the price and both ends of the range hold 9ch, the age is a
 * fixed column.
 */

import type { CSSProperties } from 'react'
import type { DemoAlso, DemoGame, DemoNews, DemoQuote } from '@/lib/demoPages'
import {
  BIG_HEADLINE_PX,
  ROOMY_GAME_PX,
  WIDE_GAME_PX,
  mix,
} from '@/lib/demoPages'

/** The clock box: a FIXED 8ch of its 11px face plus 16px of padding. */
const STATUS_WIDTH = 'calc(8ch + 16px)'
const PRICE_CH = 9
const CHANGE_CH = 8

const US_PRO = new Set(['NFL', 'MLB', 'NBA', 'NHL', 'MLS', 'WNBA'])
const TWO_WORD = new Set([
  'Red Sox',
  'White Sox',
  'Blue Jays',
  'Trail Blazers',
  'Maple Leafs',
  'Golden Knights',
  'Blue Jackets',
  'Red Wings',
])

/** Scores hold this many characters (sportsChipLayout reservationFor). */
const SCORE_3 = new Set(['NBA', 'NCAA Basketball', 'AFL', 'EuroLeague'])

function nickname(name: string): string {
  const words = name.trim().split(/\s+/)
  const two = words.slice(-2).join(' ')
  return TWO_WORD.has(two) ? two : words[words.length - 1]
}

/** GameCell's cellName: the nickname in a narrow US-pro column, else the short name. */
function cellName(league: string, name: string, roomy: boolean): string {
  if (roomy || !US_PRO.has(league))
    return name.length <= 20 ? name : nickname(name)
  return nickname(name)
}

export function accentStyle(accent: string): CSSProperties {
  return { '--accent': accent } as CSSProperties
}

/** The hairline between columns. Its parent must be `relative`. */
export function Rule() {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-[9px] left-0 top-[9px] w-px"
      style={{ background: mix(28) }}
    />
  )
}

/**
 * A crest that always holds its box. The demo carries no team logos, so
 * the box holds the team's initials instead of an image.
 */
function Crest({ name, size }: { name: string; size: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold leading-none text-[var(--fg-3)] ${
        size === 'lg' ? 'h-[22px] w-[22px] text-[8px]' : 'h-4 w-4 text-[6.5px]'
      }`}
      style={{
        background: 'color-mix(in srgb, var(--fg-4) 22%, transparent)',
      }}
    >
      {initials}
    </span>
  )
}

export function GameCell({
  game: g,
  width,
  mine = false,
}: {
  game: DemoGame
  width: number
  mine?: boolean
}) {
  const live = g.state === 'live'
  const pre = g.state === 'pre'
  const final = g.state === 'final'
  const away = Number(g.awayScore)
  const home = Number(g.homeScore)
  const scored = !pre && g.awayScore !== '' && g.homeScore !== ''
  const awayLeads = !scored || away >= home
  const homeLeads = !scored || home >= away
  const wide = width >= WIDE_GAME_PX
  const roomy = width >= ROOMY_GAME_PX
  const scoreCh = `${SCORE_3.has(g.league) ? 3 : 2}ch`

  const score = (side: 'away' | 'home', v: string, lead: boolean) => (
    <span
      data-part={`${side}-score`}
      className={`text-right font-mono leading-none tabular-nums ${
        wide ? 'text-[20px]' : 'text-[15px]'
      } ${lead ? 'font-bold text-[var(--fg)]' : 'font-medium text-[var(--fg-3)]'}`}
      style={{ minWidth: scoreCh }}
    >
      {scored ? v : ''}
    </span>
  )
  const name = (n: string, lead: boolean, end?: boolean) => (
    <span
      className={`min-w-0 truncate text-[13.5px] leading-none ${
        end ? 'text-right' : 'text-left'
      } ${
        pre
          ? 'font-semibold text-[var(--fg)]'
          : lead
            ? 'font-bold text-[var(--fg)]'
            : 'font-medium text-[var(--fg-3)]'
      }`}
    >
      {cellName(g.league, n, roomy)}
    </span>
  )
  const record = (r: string) => (
    <span className="truncate font-mono text-[11px] leading-none text-[var(--fg-4)] tabular-nums">
      {r}
    </span>
  )

  return (
    <span
      data-chip=""
      data-live={live ? '' : undefined}
      className={`relative flex h-full w-full min-w-0 items-stretch pl-3 pr-2 text-left ${
        final ? 'opacity-80' : ''
      }`}
      style={{ background: g.close ? mix(10) : undefined }}
    >
      <span
        aria-hidden="true"
        data-part="mine"
        className="absolute left-0 right-0 top-0 h-[2px]"
        style={{ background: mine ? 'var(--accent)' : 'transparent' }}
      />
      {wide ? (
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_14px_auto_minmax(0,1fr)] items-center gap-x-2.5 pr-3">
          <span className="flex min-w-0 items-center justify-end gap-2">
            <span className="flex min-w-0 flex-col items-end gap-[4px]">
              {name(g.away.name, awayLeads, true)}
              {record(g.away.record)}
            </span>
            <Crest name={g.away.name} size="lg" />
          </span>
          {score('away', g.awayScore, awayLeads)}
          <span className="text-center font-mono text-[12px] text-[var(--fg-4)]">
            {pre ? '@' : '–'}
          </span>
          {score('home', g.homeScore, homeLeads)}
          <span className="flex min-w-0 items-center gap-2">
            <Crest name={g.home.name} size="lg" />
            <span className="flex min-w-0 flex-col gap-[4px]">
              {name(g.home.name, homeLeads)}
              {record(g.home.record)}
            </span>
          </span>
        </span>
      ) : (
        <span className="grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)_auto] grid-rows-[17px_17px_14px] items-center gap-x-2 py-[6px] pr-2.5">
          <Crest name={g.away.name} size="md" />
          {name(g.away.name, awayLeads)}
          {score('away', g.awayScore, awayLeads)}
          <Crest name={g.home.name} size="md" />
          {name(g.home.name, homeLeads)}
          {score('home', g.homeScore, homeLeads)}
          {/* Before kick-off, where; after it, the table. */}
          <span className="col-span-3 truncate font-mono text-[11px] leading-none text-[var(--fg-4)] tabular-nums">
            {pre
              ? g.venue
              : [g.away.record, g.home.record].filter(Boolean).join('  ·  ')}
          </span>
        </span>
      )}
      <span
        data-part="status"
        className="relative flex shrink-0 flex-col items-center justify-center gap-[4px] overflow-hidden whitespace-nowrap pl-3 pr-1 font-mono text-[11px] leading-none"
        style={{ width: STATUS_WIDTH }}
      >
        <Rule />
        <span
          className={`relative font-bold tracking-[0.04em] ${
            live
              ? 'text-[var(--live)]'
              : final
                ? 'text-[var(--fg-4)]'
                : 'text-[var(--fg-2)]'
          }`}
        >
          {/* Always mounted, hung off the text's left edge. */}
          <span
            data-part="live-dot"
            className={`absolute right-full top-1/2 mr-1 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-[var(--live)] ${
              live ? '' : 'invisible'
            }`}
          />
          {g.top}
        </span>
        <span
          className={`text-[10.5px] tabular-nums ${
            live ? 'text-[var(--fg-2)]' : 'text-[var(--fg-3)]'
          }`}
        >
          {g.bottom || ' '}
        </span>
      </span>
    </span>
  )
}

export function NewsCell({ item, width }: { item: DemoNews; width: number }) {
  const big = width >= BIG_HEADLINE_PX
  return (
    <span
      data-chip=""
      className="grid h-full w-full min-w-0 grid-cols-[26px_minmax(0,1fr)] items-center gap-x-2.5 px-3.5 py-[6px] text-left"
    >
      <span className="self-start pt-[3px] text-right font-mono text-[11px] font-semibold leading-none text-[var(--fg-3)] tabular-nums">
        {item.age}
      </span>
      <span className="flex min-w-0 flex-col justify-center gap-[3px]">
        <span
          className={`line-clamp-2 text-left font-semibold text-[var(--fg)] ${
            big ? 'text-[15px] leading-[18px]' : 'text-[13px] leading-[16px]'
          }`}
        >
          {item.title}
        </span>
        <span className="truncate text-left text-[11px] leading-[13px] text-[var(--fg-3)]">
          {item.summary || item.source}
        </span>
      </span>
    </span>
  )
}

/** "▲ 0.89%" / "▼ 12.40%". */
function changeText(pct: number): string {
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`
}

/** desktop utils/format formatPriceBare: 2 decimals, more under $1. */
function price(n: number): string {
  const digits = n < 1 ? 4 : 2
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function amplitudeFor(points: Array<number>): number {
  const min = Math.min(...points)
  const max = Math.max(...points)
  if (!(min > 0)) return 1
  return Math.max(0.18, Math.min(1, (((max - min) / min) * 100) / 4))
}

function Sparkline({ points, up }: { points: Array<number>; up: boolean }) {
  const min = Math.min(...points)
  const range = Math.max(...points) - min
  const usable = 30 - 3
  const drawable = usable * amplitudeFor(points)
  const top = 1.5 + (usable - drawable) / 2
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100
      const y = range === 0 ? 15 : top + (1 - (p - min) / range) * drawable
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-4 min-w-0 flex-1 ${up ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function QuoteCell({ quote: q }: { quote: DemoQuote }) {
  const up = !(q.pct < 0)
  const pos = Math.max(
    0,
    Math.min(100, ((q.price - q.low) / (q.high - q.low || 1)) * 100),
  )
  return (
    <span
      data-chip=""
      className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[15px_18px_12px] items-center gap-x-2 px-3.5 py-[7px] text-left font-mono"
    >
      <span className="truncate text-[11px] font-bold leading-none tracking-[0.06em] text-[var(--fg-2)]">
        {q.symbol.replace('/USD', '')}
      </span>
      <span
        className={`text-right text-[11.5px] font-semibold leading-none tabular-nums ${
          up ? 'text-[var(--up)]' : 'text-[var(--down)]'
        }`}
        style={{ minWidth: `${CHANGE_CH}ch` }}
      >
        {changeText(q.pct)}
      </span>
      <span
        className="truncate text-[15px] font-bold leading-none text-[var(--fg)] tabular-nums"
        style={{ minWidth: `${PRICE_CH}ch` }}
      >
        {price(q.price)}
      </span>
      <span className="flex w-[52px] justify-self-end">
        <Sparkline points={q.series} up={up} />
      </span>
      {/* The day's range: low, where the price sits, high. */}
      <span className="col-span-2 flex items-center gap-1.5 text-[9.5px] leading-none text-[var(--fg-4)] tabular-nums">
        <span
          className="shrink-0 text-right"
          style={{ minWidth: `${PRICE_CH}ch` }}
        >
          {price(q.low)}
        </span>
        <span
          className="relative h-px flex-1"
          style={{
            background: 'color-mix(in srgb, var(--fg-4) 40%, transparent)',
          }}
        >
          <span
            className="absolute -top-[2px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-[var(--fg-2)]"
            style={{ left: `${pos}%` }}
          />
        </span>
        <span
          className="shrink-0 text-left"
          style={{ minWidth: `${PRICE_CH}ch` }}
        >
          {price(q.high)}
        </span>
      </span>
    </span>
  )
}

export function AlsoCell({ item, accent }: { item: DemoAlso; accent: string }) {
  return (
    <span
      data-chip=""
      className="flex h-full w-full min-w-0 items-center gap-3 px-4 text-left font-mono"
      style={accentStyle(accent)}
    >
      <span
        className="shrink-0 rounded-[3px] px-1.5 py-[3px] text-[11px] font-bold leading-4 tracking-[0.08em]"
        style={{ background: mix(18), color: 'var(--accent)' }}
      >
        {item.code}
      </span>
      <span className="min-w-0 truncate text-[12.5px] font-medium leading-none text-[var(--fg-2)]">
        {item.text}
      </span>
    </span>
  )
}
