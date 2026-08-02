/**
 * Shared state + fake-live data for the persistent marketing demo bar.
 *
 * State contract (design_handoff_marketing_site/README.md): localStorage
 * key `scrollr-marketing-demo` holds
 *   { active: string[] (widget ids), theme: string (theme FAMILY id —
 *     light/dark comes from the site color mode), pos: 'top'|'bottom',
 *     density: 'compact'|'detailed', direction: 'left'|'right' }
 * The landing picker and /widgets "ADD TO BAR" buttons write it; every
 * marketing page reads it. The /business white-label bar does NOT write
 * to this key (it passes an override to <DemoTickerBar> instead).
 *
 * Implemented as a module-level external store (same pattern as
 * `useTheme`) so the bar, the landing picker, and the catalog rows stay
 * in sync within a page; a `storage` listener syncs across tabs. SSR
 * and the first client render use the defaults; localStorage is applied
 * after mount to avoid hydration mismatches.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Structured demo chips mirroring the desktop app's ticker chip
 * families (desktop/src/components/chips): TradeChip, GameChip,
 * RssChip, and the consolidated widget chips. DemoTickerBar renders
 * each kind as the same tinted card the real app draws.
 */
export type DemoChip =
  | {
      kind: 'trade'
      accent: string
      symbol: string
      price: string
      delta?: string
      up?: boolean
      /** Row 2 in detailed density, e.g. 'Prev $231.87 · +$2.71'. */
      detail?: string
    }
  | {
      kind: 'game'
      accent: string
      away: string
      awayScore: string
      home: string
      homeScore: string
      status: string
      live?: boolean
      winner?: 'away' | 'home'
      /** League tag for detailed density's row 2, e.g. 'NFL'. */
      league?: string
    }
  | {
      kind: 'news'
      accent: string
      headline: string
      source: string
      /** Row 2 time-ago in detailed density, e.g. '18m ago'. */
      detail?: string
    }
  | {
      kind: 'text'
      accent: string
      label: string
      value?: string
      sub?: string
    }

/** Flatten a chip to plain text (catalog sample column, tests). */
export function chipText(c: DemoChip): string {
  switch (c.kind) {
    case 'trade':
      return [c.symbol, c.price, c.delta].filter(Boolean).join(' ')
    case 'game':
      return `${c.away} ${c.awayScore} — ${c.homeScore} ${c.home} · ${c.status}`
    case 'news':
      return `${c.source} · ${c.headline}`
    case 'text':
      return [c.label, c.value, c.sub].filter(Boolean).join(' · ')
  }
}

export interface DemoPalette {
  /** Bar surface colors — the theme's base-150 / edge / fg-2 / fg-3. */
  bg: string
  border: string
  text: string
  muted: string
  /** Theme accent (app --color-primary): bar dot, hairline, swatch dot. */
  accent: string
  /** Per-source chip accents (app --color-primary/secondary/info/accent-purple). */
  chips: { fin: string; spt: string; news: string; fantasy: string }
  /** Delta colors (app --color-up / --color-down). */
  up: string
  down: string
}

export interface DemoThemeFamily {
  id: string
  name: string
  dark: DemoPalette
  light: DemoPalette
}

/**
 * Real desktop theme families (desktop/src/preferences.ts THEME_FAMILIES
 * + style.css). The app ships 10 families x 2 color modes = 20 themes;
 * the marketing demo carries these 6 families, each in both modes.
 * Every color is the theme's token verbatim (bar bg = base-150 at ~.92
 * alpha for the glassy pinned look).
 */
export const APP_FAMILY_COUNT = 10
export const APP_THEME_COUNT = 20

// prettier-ignore
export const DEMO_THEMES: Array<DemoThemeFamily> = [
  {
    id: 'scrollr', name: 'SCROLLR',
    dark: { bg: 'rgba(23,23,38,.92)', border: '#282838', text: '#b7b7c6', muted: '#9292a4', accent: '#34d399', chips: { fin: '#34d399', spt: '#ff4757', news: '#00d4ff', fantasy: '#a855f7' }, up: '#22c55e', down: '#ef4444' },
    light: { bg: 'rgba(246,247,251,.94)', border: '#d5d7e2', text: '#4a4a5a', muted: '#7a7a8a', accent: '#34d399', chips: { fin: '#34d399', spt: '#ff4757', news: '#00b8db', fantasy: '#a855f7' }, up: '#22c55e', down: '#ef4444' },
  },
  {
    id: 'catppuccin', name: 'CATPPUCCIN',
    dark: { bg: 'rgba(24,24,37,.92)', border: '#313244', text: '#bac2de', muted: '#a6adc8', accent: '#a6e3a1', chips: { fin: '#a6e3a1', spt: '#f38ba8', news: '#89dceb', fantasy: '#cba6f7' }, up: '#a6e3a1', down: '#f38ba8' },
    light: { bg: 'rgba(230,233,239,.94)', border: '#ccd0da', text: '#5c5f77', muted: '#6c6f85', accent: '#40a02b', chips: { fin: '#40a02b', spt: '#d20f39', news: '#04a5e5', fantasy: '#8839ef' }, up: '#40a02b', down: '#d20f39' },
  },
  {
    id: 'dracula', name: 'DRACULA',
    dark: { bg: 'rgba(33,34,44,.92)', border: '#44475a', text: '#d8d8d2', muted: '#a8a8a2', accent: '#50fa7b', chips: { fin: '#50fa7b', spt: '#ff5555', news: '#8be9fd', fantasy: '#bd93f9' }, up: '#50fa7b', down: '#ff5555' },
    light: { bg: 'rgba(239,239,230,.94)', border: '#c2c2b2', text: '#44475a', muted: '#6272a4', accent: '#2a9d6f', chips: { fin: '#2a9d6f', spt: '#c43a3a', news: '#2a8aa5', fantasy: '#7a52d8' }, up: '#2a9d6f', down: '#c43a3a' },
  },
  {
    id: 'tokyo-night', name: 'TOKYO NIGHT',
    dark: { bg: 'rgba(22,22,30,.92)', border: '#2f334d', text: '#a9b1d6', muted: '#9aa5ce', accent: '#7aa2f7', chips: { fin: '#7aa2f7', spt: '#f7768e', news: '#7dcfff', fantasy: '#bb9af7' }, up: '#9ece6a', down: '#f7768e' },
    light: { bg: 'rgba(213,214,220,.94)', border: '#c4c8da', text: '#4c5079', muted: '#6172b0', accent: '#2e7de9', chips: { fin: '#2e7de9', spt: '#f52a65', news: '#007197', fantasy: '#9854f1' }, up: '#587539', down: '#f52a65' },
  },
  {
    id: 'nord', name: 'NORD',
    dark: { bg: 'rgba(41,46,57,.92)', border: '#3b4252', text: '#e5e9f0', muted: '#d8dee9', accent: '#88c0d0', chips: { fin: '#88c0d0', spt: '#bf616a', news: '#81a1c1', fantasy: '#b48ead' }, up: '#a3be8c', down: '#bf616a' },
    light: { bg: 'rgba(229,233,240,.94)', border: '#d8dee9', text: '#434c5e', muted: '#4c566a', accent: '#5e81ac', chips: { fin: '#5e81ac', spt: '#bf616a', news: '#5d8eaf', fantasy: '#9c6c8d' }, up: '#6a8857', down: '#bf616a' },
  },
  {
    id: 'gruvbox', name: 'GRUVBOX',
    dark: { bg: 'rgba(50,48,47,.92)', border: '#3c3836', text: '#d5c4a1', muted: '#bdae93', accent: '#b8bb26', chips: { fin: '#b8bb26', spt: '#fb4934', news: '#83a598', fantasy: '#d3869b' }, up: '#b8bb26', down: '#fb4934' },
    light: { bg: 'rgba(242,229,188,.94)', border: '#ebdbb2', text: '#504945', muted: '#665c54', accent: '#79740e', chips: { fin: '#79740e', spt: '#9d0006', news: '#076678', fantasy: '#8f3f71' }, up: '#79740e', down: '#9d0006' },
  },
]

/** Resolve a family id + color mode to its palette. */
export function resolvePalette(
  familyId: string,
  mode: 'light' | 'dark',
): DemoPalette {
  const fam = DEMO_THEMES.find((f) => f.id === familyId) ?? DEMO_THEMES[0]
  return fam[mode]
}

/**
 * Accent remap for a palette: chips are authored in the default
 * (scrollr-dark) accents; the app re-tints every source chip when the
 * theme changes, so the demo bar does the same. Utility-widget and
 * predictions accents are theme-static in the app and pass through.
 */
export function paletteRemap(pal: DemoPalette): Record<string, string> {
  return {
    [C.fin]: pal.chips.fin,
    [C.spt]: pal.chips.spt,
    [C.news]: pal.chips.news,
    [C.fantasy]: pal.chips.fantasy,
  }
}

export interface DemoTickerState {
  active: Array<string>
  /** Theme FAMILY id (light/dark comes from the site color mode). */
  theme: string
  pos: 'top' | 'bottom'
  /** App ticker density: compact = 1-row chips, detailed = 2-row. */
  density: 'compact' | 'detailed'
  /** Marquee scroll direction. */
  direction: 'left' | 'right'
}

const STORAGE_KEY = 'scrollr-marketing-demo'
const DEFAULT_STATE: DemoTickerState = {
  active: ['finance_stocks', 'sports_nfl', 'news_bbc'],
  theme: 'scrollr',
  pos: 'bottom',
  density: 'compact',
  direction: 'left',
}

let state: DemoTickerState = DEFAULT_STATE
let loadedFromStorage = false
let listeners: Array<() => void> = []

function emit() {
  for (const l of listeners) l()
}

function sanitize(raw: unknown): Partial<DemoTickerState> {
  if (typeof raw !== 'object' || raw === null) return {}
  const saved = raw as Record<string, unknown>
  const patch: Partial<DemoTickerState> = {}
  if (
    Array.isArray(saved.active) &&
    saved.active.length &&
    saved.active.every((id) => typeof id === 'string')
  ) {
    patch.active = saved.active
  }
  if (
    typeof saved.theme === 'string' &&
    DEMO_THEMES.some((f) => f.id === saved.theme)
  ) {
    patch.theme = saved.theme
  }
  if (saved.pos === 'top' || saved.pos === 'bottom') patch.pos = saved.pos
  if (saved.density === 'compact' || saved.density === 'detailed') {
    patch.density = saved.density
  }
  if (saved.direction === 'left' || saved.direction === 'right') {
    patch.direction = saved.direction
  }
  return patch
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const patch = sanitize(JSON.parse(raw))
    if (Object.keys(patch).length) {
      state = { ...state, ...patch }
      emit()
    }
  } catch {
    // private mode / malformed JSON — keep defaults
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // private mode / quota — demo state just won't stick
  }
}

function setState(patch: Partial<DemoTickerState>) {
  state = { ...state, ...patch }
  persist()
  emit()
}

function subscribe(listener: () => void) {
  listeners.push(listener)
  if (typeof window !== 'undefined' && !loadedFromStorage) {
    loadedFromStorage = true
    loadFromStorage()
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) loadFromStorage()
    })
  }
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function useDemoTicker() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_STATE,
  )

  const toggle = useCallback((id: string) => {
    setState({
      active: state.active.includes(id)
        ? state.active.filter((x) => x !== id)
        : state.active.concat(id),
    })
  }, [])

  const setTheme = useCallback((theme: string) => setState({ theme }), [])
  const setPos = useCallback((pos: 'top' | 'bottom') => setState({ pos }), [])
  const setDensity = useCallback(
    (density: 'compact' | 'detailed') => setState({ density }),
    [],
  )
  const setDirection = useCallback(
    (direction: 'left' | 'right') => setState({ direction }),
    [],
  )

  return {
    ...snapshot,
    toggle,
    setTheme,
    setPos,
    setDensity,
    setDirection,
  }
}

// ── Fake-live chip data ──────────────────────────────────────────
//
// Ported from the mockups' `chipsFor()`. Values jitter on a 3s tick via
// a deterministic sine so numbers wander believably without Math.random.

/**
 * Chip accents mirror the app's per-source chip colors
 * (desktop/src/components/chips/chipColors.ts + style.css tokens):
 * finance=primary, sports=secondary, rss=info, fantasy=purple,
 * predictions=teal, utilities per-widget.
 */
const C = {
  fin: '#34d399',
  spt: '#ff4757',
  news: '#00d4ff',
  fantasy: '#a855f7',
  predictions: '#1fc9a0',
  clock: '#6366f1',
  timer: '#f59e0b',
  weather: '#0ea5e9',
  sysmon: '#06b6d4',
  uptime: '#10b981',
  github: '#f97316',
}

function jitter(tick: number, base: number, seed: number, spread: number) {
  return base + Math.sin(tick * 0.9 + seed) * spread
}

function trade(
  accent: string,
  symbol: string,
  price: string,
  delta: string,
  up: boolean,
  detail?: string,
): DemoChip {
  return { kind: 'trade', accent, symbol, price, delta, up, detail }
}

function game(
  accent: string,
  away: string,
  awayScore: string,
  home: string,
  homeScore: string,
  status: string,
  opts: { live?: boolean; winner?: 'away' | 'home'; league?: string } = {},
): DemoChip {
  return {
    kind: 'game',
    accent,
    away,
    awayScore,
    home,
    homeScore,
    status,
    ...opts,
  }
}

function news(headline: string, source: string, detail?: string): DemoChip {
  return { kind: 'news', accent: C.news, headline, source, detail }
}

export function chipsFor(
  id: string,
  tick: number,
  now: Date | null,
): Array<DemoChip> {
  const t = tick
  switch (id) {
    case 'finance_stocks':
      return [
        trade(
          C.fin,
          'AAPL',
          '$' + jitter(t, 232.14, 1, 0.4).toFixed(2),
          '▲+1.2%',
          true,
          'Prev $229.39 · +$2.75',
        ),
        trade(
          C.fin,
          'NVDA',
          '$' + jitter(t, 1204.1, 2, 3.2).toFixed(2),
          '▲+3.1%',
          true,
          'Prev $1,167.90 · +$36.20',
        ),
        trade(
          C.fin,
          'TSLA',
          '$' + jitter(t, 311.4, 3, 1.1).toFixed(2),
          '▼-0.6%',
          false,
          'Prev $313.28 · -$1.88',
        ),
      ]
    case 'finance_crypto':
      return [
        trade(
          C.fin,
          'BTC',
          '$' + Math.round(jitter(t, 118240, 4, 180)).toLocaleString(),
          '▲+2.4%',
          true,
          'Prev $115,469 · +$2,771',
        ),
        trade(
          C.fin,
          'ETH',
          '$' + Math.round(jitter(t, 4120, 5, 14)).toLocaleString(),
          '▼-0.8%',
          false,
          'Prev $4,153 · -$33',
        ),
      ]
    case 'sports_nfl':
      return [
        game(
          C.spt,
          'KC',
          '24',
          'BUF',
          '21',
          'Q4 ' +
            (2 - (t % 3)) +
            ':' +
            String(59 - ((t * 7) % 60)).padStart(2, '0'),
          { live: true, winner: 'away', league: 'NFL' },
        ),
        game(C.spt, 'DAL', '14', 'PHI', '17', 'Q3', {
          winner: 'home',
          league: 'NFL',
        }),
      ]
    case 'sports_nba':
      return [
        game(C.spt, 'LAL', '102', 'BOS', '99', '4Q 1:45', {
          live: true,
          winner: 'away',
          league: 'NBA',
        }),
      ]
    case 'sports_nhl':
      return [
        game(C.spt, 'EDM', '3', 'DAL', '2', 'OT', {
          live: true,
          winner: 'away',
          league: 'NHL',
        }),
      ]
    case 'sports_mlb':
      return [
        game(C.spt, 'NYY', '5', 'BOS', '3', '▲7', {
          live: true,
          winner: 'away',
          league: 'MLB',
        }),
      ]
    case 'sports_f1':
      return [
        {
          kind: 'text',
          accent: C.spt,
          label: 'F1',
          value: 'VER P1 +2.4s',
          sub: 'LAP 44/57',
        },
      ]
    case 'sports_worldcup':
      return [
        game(C.spt, 'BRA', '1', 'FRA', '1', '78′', {
          live: true,
          league: 'WORLD CUP',
        }),
      ]
    case 'sports_ncaaf':
      return [
        game(C.spt, 'UGA', '21', 'ALA', '17', 'Q3', {
          winner: 'away',
          league: 'NCAAF',
        }),
      ]
    case 'sports_ncaab':
      return [
        game(C.spt, 'DUKE', '71', 'UNC', '68', '2H', {
          winner: 'away',
          league: 'NCAAB',
        }),
      ]
    case 'sports_premierleague':
      return [
        game(C.spt, 'ARS', '2', 'LIV', '2', '81′', {
          live: true,
          league: 'EPL',
        }),
      ]
    case 'sports_laliga':
      return [
        game(C.spt, 'RMA', '1', 'BAR', '0', 'HT', {
          winner: 'away',
          league: 'LA LIGA',
        }),
      ]
    case 'sports_mls':
      return [
        game(C.spt, 'MIA', '2', 'LA', '1', '63′', {
          live: true,
          winner: 'away',
          league: 'MLS',
        }),
      ]
    case 'sports_championsleague':
      return [
        game(C.spt, 'BAY', '0', 'MCI', '0', '55′', {
          live: true,
          league: 'UCL',
        }),
      ]
    case 'sports_ufc':
      return [
        {
          kind: 'text',
          accent: C.spt,
          label: 'UFC',
          value: 'MAIN CARD 10PM ET',
          sub: '3 FIGHTS LEFT',
        },
      ]
    case 'sports_afl':
      return [
        game(C.spt, 'COLL', '88', 'CARL', '76', 'Q4', {
          winner: 'away',
          league: 'AFL',
        }),
      ]
    case 'news_bbc':
      return [
        news(
          'SpaceX sets reuse record with 30th booster flight',
          'BBC News',
          '18m ago',
        ),
      ]
    case 'news_npr':
      return [
        news('Drought reshapes the Colorado River compact', 'NPR', '32m ago'),
      ]
    case 'news_guardian':
      return [
        news('Wimbledon expansion plan approved', 'The Guardian', '44m ago'),
      ]
    case 'news_aljazeera':
      return [news('Markets rally across the Gulf', 'Al Jazeera', '1h ago')]
    case 'news_propublica':
      return [
        news('Inside the fight over hospital billing', 'ProPublica', '2h ago'),
      ]
    case 'news_bloomberg':
      return [
        news(
          'Treasury yields slip ahead of jobs report',
          'Bloomberg',
          '12m ago',
        ),
      ]
    case 'news_cnbc':
      return [news('Chipmakers extend rally on AI demand', 'CNBC', '26m ago')]
    case 'news_nasa':
      return [news('Artemis IV stack rolls to the pad', 'NASA', '3h ago')]
    case 'news_hackernews':
      return [
        news(
          'Show HN: A 2KB reactive framework · 342▲',
          'Hacker News',
          '51m ago',
        ),
      ]
    case 'news_theverge':
      return [
        news('The best mechanical keyboards right now', 'The Verge', '1h ago'),
      ]
    case 'rss_custom':
      return [
        news('anything with an RSS URL goes here', 'YOUR FEED', 'just now'),
      ]
    case 'fantasy_yahoo':
      return [
        {
          kind: 'text',
          accent: C.fantasy,
          label: 'You ' + jitter(t, 112.4, 7, 0.8).toFixed(1) + ' — Mike 98.7',
          sub: 'YAHOO FANTASY · SUN',
        },
      ]
    case 'predictions':
      return [
        {
          kind: 'text',
          accent: C.predictions,
          label: 'Sept rate cut',
          value: Math.round(jitter(t, 71, 6, 2)) + '¢',
          sub: 'KALSHI',
        },
      ]
    case 'clock':
      return [
        {
          kind: 'text',
          accent: C.clock,
          label: 'LOCAL',
          // `now` is null during SSR + first client render; a stable
          // placeholder avoids a server/client timezone hydration mismatch.
          value: now
            ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : '--:--',
        },
      ]
    case 'timer':
      return [
        {
          kind: 'text',
          accent: C.timer,
          label: 'TIMER',
          value: '25:00',
          sub: 'FOCUS',
        },
      ]
    case 'weather':
      return [
        {
          kind: 'text',
          accent: C.weather,
          label: 'AUSTIN',
          value: '72°F ☀',
          sub: 'SUNNY',
        },
      ]
    case 'sysmon':
      return [
        {
          kind: 'text',
          accent: C.sysmon,
          label: 'CPU',
          value: Math.round(jitter(t, 12, 8, 4)) + '%',
          sub: 'MEM 48%',
        },
      ]
    case 'uptime':
      return [
        {
          kind: 'text',
          accent: C.uptime,
          label: 'api.myscrollr.com',
          value: '99.99% UP',
        },
      ]
    case 'github':
      return [
        {
          kind: 'text',
          accent: C.github,
          label: 'GITHUB',
          value: '3 PRS AWAIT REVIEW',
        },
      ]
    default:
      return []
  }
}

/**
 * Jittering fake-live chips for the given widget ids. Re-renders every
 * 3 seconds (content change only — motion is handled by CSS, which the
 * global reduced-motion override freezes).
 */
export function useDemoChips(ids: Array<string>): Array<DemoChip> {
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const iv = setInterval(() => {
      setTick((v) => v + 1)
      setNow(new Date())
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  return ids.flatMap((id) => chipsFor(id, tick, now))
}
