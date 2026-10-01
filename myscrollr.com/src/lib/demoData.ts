/**
 * What the marketing demo bar shows (SCROLLR-198): made-up but believable
 * data for every catalog widget, shaped as the desktop's pages and edge
 * (desktop/src/components/pages/widgetPages.ts `buildPageWidgets`,
 * EdgeZone.tsx `buildEdge`).
 *
 * The NFL, Stocks, Crypto, BBC and NPR rows are the desktop shim's
 * `dashboard.pages.json` fixture, so the site and
 * `desktop/ticker-shim.html?pages=1&fixture=pages` can be compared side
 * by side. Nothing here is fetched; values move on a 3 s tick through a
 * deterministic sine (no Math.random, so SSR and hydration agree).
 */

import type {
  DemoBarData,
  DemoGame,
  DemoItem,
  DemoPageWidget,
  DemoSlot,
  DemoUtility,
  Tier,
} from '@/lib/demoPages'
import {
  ALSO_MIN_COL,
  ALSO_TAB,
  NEWS_MIN_COL,
  QUOTE_MIN_COL,
  TIER,
  gameMinCol,
  reserveOf,
} from '@/lib/demoPages'
import { seededRandom } from '@/lib/seededRandom'

/** Catalog colours, by widget id (the site's CatalogWidget.color). */
export type HexOf = (id: string) => string | undefined

const MIN = 60_000
const HOUR = 3_600_000

// ── Sports ─────────────────────────────────────────────────────────

/**
 * [away, home, awayScore, homeScore, state, kick-off (minutes from now),
 *  live top line, live clock seconds, venue, away record, home record]
 */
export type GameRow = [
  string,
  string,
  string,
  string,
  'pre' | 'live' | 'final',
  number,
  string,
  number,
  string,
  string,
  string,
]

export interface League {
  league: string
  /** The label's name (desktop leagueCode). */
  code: string
  /** A live game within this many points tints (CLOSE_THRESHOLDS). */
  close: number
  /** Live clock: counting down m:ss, counting up minutes, or innings. */
  clock: 'down' | 'up' | 'inning'
  /** Your team (favoriteTeams): its game goes first with the line on top. */
  mine?: string
  games: Array<GameRow>
}

// prettier-ignore
const SPORTS: Record<string, League> = {
  sports_nfl: {
    league: 'NFL', code: 'NFL', close: 8, clock: 'down', mine: 'Chicago Bears',
    games: [
      ['New York Jets', 'Chicago Bears', '24', '20', 'live', -100, 'Q4', 134, 'Soldier Field', '1-2', '2-1'],
      ['New England Patriots', 'Buffalo Bills', '14', '21', 'live', -100, 'Q3', 271, 'Highmark Stadium', '1-2', '3-0'],
      ['Jacksonville Jaguars', 'Cincinnati Bengals', '9', '16', 'live', -100, 'Q3', 730, 'Paycor Stadium', '2-1', '2-1'],
      ['Arizona Cardinals', 'New York Giants', '10', '10', 'live', -100, 'Q3', 65, 'MetLife Stadium', '1-2', '2-1'],
      ['Los Angeles Rams', 'Philadelphia Eagles', '27', '6', 'live', -100, 'Q4', 712, 'Lincoln Financial Field', '1-2', '2-1'],
      ['Green Bay Packers', 'Tampa Bay Buccaneers', '31', '28', 'live', -100, 'Q4', 39, 'Raymond James Stadium', '1-2', '0-3'],
      ['Tennessee Titans', 'Baltimore Ravens', '3', '7', 'live', -100, 'Q2', 48, 'M&T Bank Stadium', '0-3', '2-1'],
      ['Dallas Cowboys', 'Houston Texans', '17', '13', 'live', -100, 'Q3', 520, 'Reliant Stadium', '1-2', '0-3'],
      ['Indianapolis Colts', 'Washington Commanders', '23', '19', 'final', -310, '', 0, 'Tottenham Hotspur Stadium', '1-2', '1-2'],
      ['Miami Dolphins', 'Minnesota Vikings', '', '', 'pre', 85, '', 0, 'U.S. Bank Stadium', '0-3', '3-0'],
      ['Denver Broncos', 'San Francisco 49ers', '', '', 'pre', 105, '', 0, "Levi's Stadium", '2-1', '3-0'],
      ['Los Angeles Chargers', 'Seattle Seahawks', '', '', 'pre', 105, '', 0, 'Lumen Field', '0-3', '2-1'],
      ['Kansas City Chiefs', 'Las Vegas Raiders', '', '', 'pre', 105, '', 0, 'Allegiant Stadium', '3-0', '3-0'],
      ['Detroit Lions', 'Carolina Panthers', '', '', 'pre', 340, '', 0, 'Bank of America Stadium', '2-1', '1-2'],
    ],
  },
  sports_nba: {
    league: 'NBA', code: 'NBA', close: 6, clock: 'down',
    games: [
      ['Los Angeles Lakers', 'Boston Celtics', '102', '99', 'live', -130, 'Q4', 105, 'TD Garden', '31-14', '33-12'],
      ['Denver Nuggets', 'Phoenix Suns', '88', '91', 'live', -110, 'Q3', 402, 'Footprint Center', '29-16', '25-20'],
      ['Golden State Warriors', 'Miami Heat', '', '', 'pre', 150, '', 0, 'Kaseya Center', '26-19', '24-21'],
    ],
  },
  sports_nhl: {
    league: 'NHL', code: 'NHL', close: 1, clock: 'down',
    games: [
      ['Edmonton Oilers', 'Dallas Stars', '3', '2', 'live', -140, 'P3', 344, 'American Airlines Center', '30-15-4', '28-17-5'],
      ['Toronto Maple Leafs', 'Boston Bruins', '', '', 'pre', 95, '', 0, 'TD Garden', '27-18-4', '29-16-3'],
    ],
  },
  sports_mlb: {
    league: 'MLB', code: 'MLB', close: 2, clock: 'inning',
    games: [
      ['New York Yankees', 'Boston Red Sox', '5', '3', 'live', -150, '7', 0, 'Fenway Park', '88-60', '81-67'],
      ['Los Angeles Dodgers', 'San Diego Padres', '2', '2', 'live', -90, '5', 0, 'Petco Park', '90-58', '84-64'],
      ['Chicago Cubs', 'St. Louis Cardinals', '6', '4', 'final', -420, '', 0, 'Busch Stadium', '79-69', '72-76'],
    ],
  },
  sports_worldcup: {
    league: 'FIFA World Cup', code: 'WC', close: 1, clock: 'up',
    games: [
      ['Brazil', 'France', '1', '1', 'live', -80, '2H', 78 * 60, 'MetLife Stadium', '', ''],
      ['Argentina', 'Germany', '', '', 'pre', 160, '', 0, 'SoFi Stadium', '', ''],
    ],
  },
  sports_ncaaf: {
    league: 'NCAA Football', code: 'NCAAF', close: 8, clock: 'down',
    games: [
      ['Georgia', 'Alabama', '21', '17', 'live', -120, 'Q3', 412, 'Bryant-Denny Stadium', '5-0', '4-1'],
      ['Ohio State', 'Michigan', '', '', 'pre', 200, '', 0, 'Michigan Stadium', '5-0', '4-1'],
    ],
  },
  sports_ncaab: {
    league: 'NCAA Basketball', code: 'NCAAB', close: 6, clock: 'down',
    games: [
      ['Duke', 'North Carolina', '71', '68', 'live', -100, '2H', 228, 'Dean E. Smith Center', '22-4', '20-6'],
    ],
  },
  sports_premierleague: {
    league: 'Premier League', code: 'EPL', close: 1, clock: 'up',
    games: [
      ['Arsenal', 'Liverpool', '2', '2', 'live', -90, '2H', 81 * 60, 'Anfield', '5-1-1', '6-0-1'],
      ['Chelsea', 'Manchester City', '0', '1', 'live', -60, '1H', 38 * 60, 'Etihad Stadium', '3-2-2', '5-1-1'],
      ['Tottenham Hotspur', 'Newcastle United', '3', '1', 'final', -300, '', 0, 'St James’ Park', '4-1-2', '3-2-2'],
    ],
  },
  sports_laliga: {
    league: 'La Liga', code: 'LIGA', close: 1, clock: 'up',
    games: [
      ['Real Madrid', 'Barcelona', '1', '0', 'live', -50, 'HT', 45 * 60, 'Camp Nou', '6-1-0', '5-1-1'],
    ],
  },
  sports_mls: {
    league: 'MLS', code: 'MLS', close: 1, clock: 'up',
    games: [
      ['Inter Miami', 'LA Galaxy', '2', '1', 'live', -70, '2H', 63 * 60, 'Dignity Health Sports Park', '18-6-8', '15-9-8'],
    ],
  },
  sports_championsleague: {
    league: 'Champions League', code: 'UCL', close: 1, clock: 'up',
    games: [
      ['Bayern Munich', 'Manchester City', '0', '0', 'live', -65, '2H', 55 * 60, 'Etihad Stadium', '', ''],
    ],
  },
  sports_afl: {
    league: 'AFL', code: 'AFL', close: 6, clock: 'down',
    games: [
      ['Collingwood Magpies', 'Carlton Blues', '88', '76', 'final', -260, '', 0, 'MCG', '16-7', '14-9'],
    ],
  },
}

/** What a league with no games on says on the Also page. */
const QUIET: Record<string, string> = {
  sports_f1: 'next race Sun 4:00 PM',
  sports_ufc: 'next card Sat 10:00 PM',
}

// Ported from desktop/src/utils/gameHelpers.ts LEAGUE_CODES + leagueCode.
// prettier-ignore
const LEAGUE_CODES: Record<string, string> = {
  AFL: 'AFL', Bundesliga: 'BULI', 'Champions League': 'UCL', EuroLeague: 'EL',
  'FIFA World Cup': 'WC', 'World Cup': 'WC', 'Formula 1': 'F1', F1: 'F1',
  'Handball Bundesliga': 'HBL', 'Handball Champions League': 'HCL',
  'La Liga': 'LIGA', 'Ligue 1': 'L1', 'NCAA Basketball': 'NCAAB',
  'NCAA Football': 'NCAAF', 'Premier League': 'EPL', 'Premiership Rugby': 'PREM',
  'Serie A': 'SERIE', 'Six Nations': '6N', Starligue: 'SLG', 'Super Rugby': 'SUPER',
  UFC: 'UFC', 'Volleyball Champions League': 'VCL', 'Volleyball Nations League': 'VNL',
}

export function leagueCode(league: string): string {
  const known = LEAGUE_CODES[league] as string | undefined
  if (known) return known
  const t = league.trim()
  if (t.length <= 5) return t.toUpperCase()
  const words = t.split(/\s+/)
  if (words.length > 1)
    return words
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 5)
  return t.slice(0, 5).toUpperCase()
}

const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

const ordinal = (n: number) =>
  n +
  (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th')

/** Kick-off for a game not started: GameCell's `statusLines`. */
function preLines(start: Date, now: Date): [string, string] {
  const diff = start.getTime() - now.getTime()
  const time = start
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([AP])M/i, '$1')
  if (diff < 86_400_000 && start.toDateString() === now.toDateString()) {
    const h = Math.floor(diff / HOUR)
    const m = Math.floor((diff % HOUR) / MIN)
    return [
      time,
      diff <= 0
        ? 'SOON'
        : h
          ? `in ${h}h${String(m).padStart(2, '0')}`
          : `in ${m}m`,
    ]
  }
  return [
    start.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    time,
  ]
}

function dayLabel(d: Date): string {
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' })
  const mon = d.toLocaleDateString(undefined, { month: 'short' })
  return `${wd} ${d.getDate()} ${mon}`.toUpperCase()
}

export function sportsWidget(
  tab: string,
  l: League,
  hex: string | undefined,
  tick: number,
  now: Date,
): DemoPageWidget {
  const t = now.getTime()
  const games = l.games.map((g, i) => {
    const [away, home, as, hs, state, startMin, top, sec, venue, ar, hr] = g
    const start = new Date(t + startMin * MIN)
    let lines: [string, string]
    if (state === 'final') lines = ['FINAL', '']
    else if (state === 'pre') lines = preLines(start, now)
    else if (l.clock === 'inning') lines = [ordinal(Number(top)), 'INN']
    else if (top === 'HT') lines = ['HT', '']
    else if (l.clock === 'up')
      lines = [top, `${Math.floor((sec + tick * 3) / 60)}'`]
    // A quarter or period runs out and starts again: the demo never ends.
    else lines = [top, mmss((((sec - tick * 3) % 900) + 900) % 900)]
    const mine = l.mine === away || l.mine === home
    const live = state === 'live'
    const game: DemoGame = {
      kind: 'game',
      league: l.league,
      away: { name: away, record: ar },
      home: { name: home, record: hr },
      awayScore: as,
      homeScore: hs,
      state,
      top: lines[0],
      bottom: lines[1],
      venue,
      close: live && Math.abs(Number(as) - Number(hs)) <= l.close,
    }
    // widgetPages.ts gameTier
    let tier: Tier
    if (mine || live) tier = TIER.live
    else if (state === 'pre') {
      tier =
        startMin <= 180
          ? TIER.fresh
          : start.toDateString() === now.toDateString()
            ? TIER.recent
            : TIER.quiet
    } else tier = TIER.recent
    return { key: `g:${tab}:${i}`, tier, mine, cell: game, start }
  })
  // Yours first, then every other live game, both in kick-off order; then the rest.
  const byKick = (a: (typeof games)[number], b: (typeof games)[number]) =>
    a.start.getTime() - b.start.getTime()
  const ordered = [
    ...games.filter((g) => g.mine).sort(byKick),
    ...games.filter((g) => !g.mine && g.cell.state === 'live').sort(byKick),
    // The ticker's sortForDisplay: upcoming soonest first, then results newest first.
    ...games.filter((g) => !g.mine && g.cell.state === 'pre').sort(byKick),
    ...games
      .filter((g) => !g.mine && g.cell.state === 'final')
      .sort((a, b) => byKick(b, a)),
  ]
  const liveCount = ordered.filter((g) => g.cell.state === 'live').length
  return {
    tab,
    code: l.code,
    sub: liveCount ? `${liveCount} LIVE` : dayLabel(ordered[0].start),
    hex,
    minCol: gameMinCol(l.code),
    items: ordered.map(({ start: _start, ...item }) => item),
  }
}

// ── Finance ────────────────────────────────────────────────────────

/** [symbol, price, % change] from the shim fixture. */
// prettier-ignore
const QUOTES: Record<string, Array<[string, number, number]>> = {
  finance_stocks: [
    ['AAPL', 253.69, -0.89], ['MSFT', 576.05, -0.5], ['NVDA', 168.17, -1.0],
    ['AMZN', 256.31, 0.03], ['TSLA', 465.34, 0.76], ['GOOGL', 332.72, -0.57],
    ['META', 842.02, -0.08], ['JPM', 294.78, 1.38], ['SPY', 982.32, -0.004],
    ['QQQ', 808.7, 0.88],
  ],
  finance_crypto: [
    ['BTC/USD', 79850.21, -1.74], ['ETH/USD', 2253.46, 1.52], ['SOL/USD', 114.3, 1.33],
    ['XRP/USD', 1.3476, -0.14], ['DOGE/USD', 0.0919, 1.32], ['ADA/USD', 0.2653, 1.11],
    ['LINK/USD', 8.555, -0.43], ['AVAX/USD', 12.7954, 2.22],
  ],
}

function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A day's line from the previous close to `last`: a seeded walk, so every render agrees. */
function series(symbol: string, last: number, pct: number): Array<number> {
  const prev = last / (1 + pct / 100)
  const rnd = seededRandom(hashOf(symbol))
  const out: Array<number> = []
  let wander = 0
  for (let i = 0; i < 29; i++) {
    wander += (rnd() - 0.5) * 0.004 * last
    out.push(
      prev + ((last - prev) * i) / 29 + wander * Math.sin((i / 29) * Math.PI),
    )
  }
  out.push(last)
  return out
}

/** A watchlist page from [symbol, price, % change] rows. */
export function financeWidget(
  tab: string,
  code: string,
  hex: string | undefined,
  quotes: Array<[string, number, number]>,
  tick: number,
): DemoPageWidget {
  const rows = quotes.map(([symbol, base, pct], i) => {
    // A third of the prices move on each tick, as the shim's live sim does.
    const moves = (i + tick) % 3 === 0
    const price = moves ? base * (1 + Math.sin(tick * 0.9 + i) * 0.0009) : base
    const line = series(symbol, base, pct)
    line[line.length - 1] = price
    return {
      symbol,
      price,
      pct: pct + ((price - base) / base) * 100,
      low: Math.min(...line),
      high: Math.max(...line),
      series: line,
    }
  })
  const up = rows.filter((r) => !(r.pct < 0)).length
  return {
    tab,
    code,
    sub: `▲${up}  ▼${rows.length - up}`,
    hex,
    minCol: QUOTE_MIN_COL,
    // The watchlist, in its order: tier 1 (fresh), never sticky.
    items: rows.map((r) => ({
      key: `f:${r.symbol}`,
      tier: TIER.fresh,
      cell: { kind: 'quote', ...r },
    })),
  }
}

// ── News ───────────────────────────────────────────────────────────

/** [source, [minutes ago, headline, summary?]...] */
// prettier-ignore
const NEWS: Record<string, [string, Array<[number, string, string?]>]> = {
  news_bbc: ['BBC News', [
    [12, 'Central bank holds rates as inflation cools for third month'],
    [48, 'Storm warnings issued across the north-east ahead of weekend'],
    [95, 'Rail strike talks resume after week of cancelled services'],
  ]],
  news_npr: ['NPR News', [
    [25, 'Senate advances spending bill with hours to spare before deadline'],
    [70, "A small town's library reopens after a five-year rebuild"],
    [140, 'Scientists map the ocean floor near a newly found vent field'],
  ]],
  news_guardian: ['The Guardian', [[44, 'Wimbledon expansion plan approved'], [130, 'Heatwave tests the national grid']]],
  news_aljazeera: ['Al Jazeera', [[60, 'Markets rally across the Gulf']]],
  news_propublica: ['ProPublica', [[120, 'Inside the fight over hospital billing']]],
  news_bloomberg: ['Bloomberg', [[12, 'Treasury yields slip ahead of jobs report'], [55, 'Oil steadies as supply talks drag on']]],
  news_cnbc: ['CNBC', [[26, 'Chipmakers extend rally on AI demand']]],
  news_nasa: ['NASA', [[180, 'Artemis IV stack rolls to the pad']]],
  news_hackernews: ['Hacker News', [
    [51, 'Show HN: A 2KB reactive framework'],
    [90, 'Why we moved our build cache to object storage'],
    [150, 'The quiet death of the RSS reader, and its comeback'],
  ]],
  news_theverge: ['The Verge', [[60, 'The best mechanical keyboards right now']]],
  news_drudge: ['Drudge Report', [[8, 'Senate sets late vote on spending bill']]],
  news_cnn: ['CNN', [[15, 'Storm system brings heavy rain to the Gulf Coast']]],
  news_fox: ['Fox News', [[22, 'Lawmakers trade offers as shutdown deadline nears']]],
  news_axios: ['Axios', [[34, 'What the new rate pause means for mortgages']]],
  news_politico: ['Politico', [[41, 'Inside the late-night deal on the spending bill']]],
  news_abc: ['ABC News', [[19, 'Firefighters gain ground on wildfire near the coast']]],
  news_pbs: ['PBS NewsHour', [[65, 'How small towns are rebuilding their libraries']]],
  news_thehill: ['The Hill', [[27, 'House leaders schedule vote on stopgap funding']]],
  news_reason: ['Reason', [[90, 'The case for fewer occupational licenses']]],
  rss_custom: ['Your Feed', [[1, 'Anything with an RSS or Atom URL goes here']]],
}

/** desktop/src/utils/rssText.ts sourceTab */
function sourceTab(name: string): string {
  const n = name.trim().replace(/^the\s+/i, '')
  const up = n.toUpperCase()
  return up.length <= 12 ? up : up.split(/\s+/)[0]
}

function newsWidget(
  tab: string,
  hex: string | undefined,
  source: string,
  rows: Array<[number, string, string?]>,
): DemoPageWidget {
  return {
    tab,
    code: sourceTab(source).split(' ')[0],
    sub: 'HEADLINES',
    hex,
    minCol: NEWS_MIN_COL,
    items: rows.map(([mins, title, summary], i) => ({
      key: `n:${tab}:${i}`,
      tier: mins < 120 ? TIER.fresh : mins < 360 ? TIER.recent : TIER.quiet,
      cell: {
        kind: 'news',
        title,
        summary: summary ?? '',
        source,
        age: mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`,
      },
    })),
  }
}

// ── The edge: utilities (EdgeZone.tsx slotOf) ──────────────────────

const ZONES: Array<[string, string | undefined]> = [
  ['Local', undefined],
  ['New York', 'America/New_York'],
  ['London', 'Europe/London'],
  ['Tokyo', 'Asia/Tokyo'],
]

function clockSlots(now: Date): Array<DemoSlot> {
  return ZONES.map(([label, tz]) => {
    const value = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    }).format(now)
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        ...(tz ? { timeZone: tz } : {}),
      }).format(now),
    )
    return {
      id: `clock-${label}`,
      label,
      value,
      reserve: reserveOf(value, 2),
      detail: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(tz ? { timeZone: tz } : {}),
      }).format(now),
      dim: hour >= 20 || hour < 6,
    }
  })
}

// prettier-ignore
const WEATHER: Array<[string, string, number, number, number, string]> = [
  ['Austin', '☀', 72, 61, 78, 'Sunny'],
  ['Chicago', '⛅', 58, 49, 63, 'Partly cloudy'],
  ['London', '🌧', 54, 50, 57, 'Light rain'],
]

function utility(tab: string, tick: number, now: Date): Array<DemoSlot> {
  switch (tab) {
    case 'clock':
      return clockSlots(now)
    case 'weather':
      return WEATHER.map(([label, icon, t, lo, hi]) => ({
        id: `weather-${label}`,
        label,
        icon,
        value: `${t}°F`,
        reserve: reserveOf(`${t}°F`, 3),
        detail: `${lo}°F / ${hi}°F`,
      }))
    case 'timer': {
      const left = Math.max(0, 25 * 60 - ((tick * 3) % (25 * 60)))
      const value = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
      return [
        {
          id: 'timer',
          label: 'Timer',
          value,
          reserve: reserveOf(value, 3),
          detail: 'Pomodoro · 1/4 sessions',
        },
      ]
    }
    case 'sysmon': {
      const cpu = Math.round(12 + Math.sin(tick * 0.9 + 8) * 4)
      return [
        {
          id: 'cpu',
          label: 'CPU',
          value: `${cpu}%`,
          reserve: '000%',
          detail: '3.6 GHz · 54°C',
        },
        {
          id: 'mem',
          label: 'Memory',
          value: '48%',
          reserve: '000%',
          detail: '15.4 / 32 GB',
        },
      ]
    }
    case 'uptime':
      return [
        {
          id: 'uptime',
          label: 'api.myscrollr.com',
          value: '99.99%',
          reserve: '000.00%',
          detail: '84 ms avg',
        },
      ]
    case 'github':
      return [
        {
          id: 'gh',
          label: 'scrollr/desktop',
          value: '✓ 4m',
          reserve: '✓ 00m',
          detail: 'CI',
        },
      ]
    default:
      return []
  }
}

const UTILITIES = ['clock', 'timer', 'weather', 'sysmon', 'uptime', 'github']

// ── The bar ────────────────────────────────────────────────────────

/**
 * Every widget on the bar as pages, in bar order, then one Also page for
 * the quiet ones; the utilities go to the edge, in the edge's fixed order.
 */
export function demoBar(
  ids: ReadonlyArray<string>,
  hexOf: HexOf,
  nameOf: (id: string) => string,
  tick: number,
  now: Date,
): DemoBarData {
  const widgets: Array<DemoPageWidget> = []
  const also: Array<DemoItem> = []
  for (const tab of ids) {
    if (UTILITIES.includes(tab)) continue
    const hex = hexOf(tab)
    const sport = SPORTS[tab] as League | undefined
    const news = NEWS[tab] as (typeof NEWS)[string] | undefined
    if (sport) widgets.push(sportsWidget(tab, sport, hex, tick, now))
    else if (tab in QUOTES)
      widgets.push(
        financeWidget(
          tab,
          tab === 'finance_stocks' ? 'STOCKS' : 'CRYPTO',
          hex,
          QUOTES[tab],
          tick,
        ),
      )
    else if (news) widgets.push(newsWidget(tab, hex, news[0], news[1]))
    else {
      // Nothing on: the status chip's words, on the shared Also page.
      const name = nameOf(tab)
      const isSport = tab.startsWith('sports_')
      also.push({
        key: `q:${tab}`,
        tier: TIER.status,
        cell: {
          kind: 'also',
          code: isSport ? leagueCode(name) : sourceTab(name),
          text:
            QUIET[tab] ??
            (isSport ? 'next match Sat 3:30 PM' : 'nothing to show right now'),
          hex,
        },
      })
    }
  }
  if (also.length) {
    widgets.push({
      tab: ALSO_TAB,
      code: 'ALSO',
      sub: 'NOTHING ON',
      minCol: ALSO_MIN_COL,
      items: also,
    })
  }
  const edge: Array<DemoUtility> = UTILITIES.filter((u) => ids.includes(u)).map(
    (tab) => ({ tab, hex: hexOf(tab), items: utility(tab, tick, now) }),
  )
  return { widgets, edge }
}

/** One line of plain text for a widget (the /widgets catalog's sample column). */
export function sampleText(
  id: string,
  hexOf: HexOf,
  nameOf: (id: string) => string,
  tick: number,
  now: Date,
): string {
  const { widgets, edge } = demoBar([id], hexOf, nameOf, tick, now)
  const slot = edge.at(0)?.items.at(0)
  if (slot)
    return [slot.label, slot.value, slot.detail].filter(Boolean).join(' · ')
  const c = widgets.at(0)?.items.at(0)?.cell
  if (!c) return ''
  switch (c.kind) {
    case 'game':
      return `${c.away.name} ${c.awayScore} — ${c.homeScore} ${c.home.name} · ${[c.top, c.bottom].filter(Boolean).join(' ')}`
    case 'quote':
      return `${c.symbol.replace('/USD', '')} ${c.price.toFixed(2)} ${c.pct >= 0 ? '▲' : '▼'}${Math.abs(c.pct).toFixed(2)}%`
    case 'news':
      return `${c.source} · ${c.title}`
    case 'also':
      return `${c.code} · ${c.text}`
  }
}
