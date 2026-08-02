/**
 * Marketing-site view of the widget catalog.
 *
 * `useCatalog()` fetches GET /catalog (the single authority — see
 * api/internal/widgets/catalog.go) with a sessionStorage cache, and falls
 * back to CATALOG_SNAPSHOT so the pages render offline and during SSR.
 * The snapshot mirrors api/internal/platform/widgets.go; drift is
 * harmless (the live response wins as soon as it arrives) but keep it
 * roughly in sync when the server catalog changes.
 *
 * Widget counts and category counts must always be COMPUTED from the
 * widget list — never hardcode "35" in page copy.
 */

import { useEffect, useState } from 'react'
import type { CatalogWidget } from '@/api/client'
import { catalogApi } from '@/api/client'

export type { CatalogWidget }

export const CATALOG_SNAPSHOT: Array<CatalogWidget> = [
  // prettier-ignore
  ...([
    ['finance_stocks', 'Stocks', 'finance', '#16a34a', 'Live stock & ETF prices with a watchlist you control.'],
    ['finance_crypto', 'Crypto', 'finance', '#f7931a', 'Live crypto prices with a watchlist you control.'],
    ['sports_nfl', 'NFL', 'sports', '#013369', 'Live NFL scores and game states.'],
    ['sports_nba', 'NBA', 'sports', '#c9082a', 'Live NBA scores and game states.'],
    ['sports_nhl', 'NHL', 'sports', '#111827', 'Live NHL scores and game states.'],
    ['sports_mlb', 'MLB', 'sports', '#002d72', 'Live MLB scores and game states.'],
    ['sports_f1', 'F1', 'sports', '#e10600', 'Formula 1 race weekends and results.'],
    ['sports_worldcup', 'World Cup', 'sports', '#2e7d46', 'FIFA World Cup fixtures and scores.'],
    ['sports_ncaaf', 'NCAA Football', 'sports', '#0b427a', 'Live college football scores across the FBS.'],
    ['sports_ncaab', 'NCAA Basketball', 'sports', '#d2691e', 'Live college basketball scores and the road to March.'],
    ['sports_premierleague', 'Premier League', 'sports', '#37003c', "Live scores from England's Premier League."],
    ['sports_laliga', 'La Liga', 'sports', '#e2001a', "Live scores from Spain's La Liga."],
    ['sports_mls', 'MLS', 'sports', '#001838', 'Live Major League Soccer scores.'],
    ['sports_championsleague', 'Champions League', 'sports', '#0e1e5b', 'Live UEFA Champions League scores.'],
    ['sports_ufc', 'UFC', 'sports', '#d20a0a', 'UFC fight cards and results.'],
    ['sports_afl', 'AFL', 'sports', '#003da5', 'Live Australian Football League scores.'],
    ['news_bbc', 'BBC News', 'news', '#b80000', 'World, UK and breaking news from the BBC.'],
    ['news_npr', 'NPR', 'news', '#4667de', 'US and world news, analysis and reporting from NPR.'],
    ['news_guardian', 'The Guardian', 'news', '#052962', 'Independent world news, opinion and reporting.'],
    ['news_aljazeera', 'Al Jazeera', 'news', '#e8a33d', 'Breaking news from the Middle East and around the world.'],
    ['news_propublica', 'ProPublica', 'news', '#c8102e', 'Investigative journalism in the public interest.'],
    ['news_bloomberg', 'Bloomberg', 'news', '#1a1a2e', 'Global markets, finance and business news.'],
    ['news_cnbc', 'CNBC', 'news', '#005594', 'Markets, business and finance headlines.'],
    ['news_nasa', 'NASA', 'news', '#0b3d91', 'Space, science and mission news from NASA.'],
    ['news_hackernews', 'Hacker News', 'news', '#ff6600', 'Top stories from the Hacker News front page.'],
    ['news_theverge', 'The Verge', 'news', '#5200ff', 'Technology, science, art and culture.'],
    ['rss_custom', 'Custom RSS', 'news', '#ee802f', 'Follow any RSS or Atom feed by pasting its URL.'],
    ['fantasy_yahoo', 'Yahoo Fantasy', 'fantasy', '#6001d2', 'Your Yahoo Fantasy leagues, matchups, and standings.'],
    ['predictions', 'Kalshi', 'predictions', '#1fc9a0', 'Live odds from the Kalshi prediction market.'],
    ['clock', 'Clock', 'utility', '#6366f1', 'Local time and world clocks'],
    ['timer', 'Timer', 'utility', '#f59e0b', 'Pomodoro, countdown, and stopwatch tools'],
    ['weather', 'Weather', 'utility', '#0ea5e9', 'Current conditions for your locations'],
    ['sysmon', 'System Monitor', 'utility', '#06b6d4', 'Live CPU, memory, and GPU stats'],
    ['uptime', 'Uptime', 'utility', '#10b981', 'Monitor status from Uptime Kuma'],
    ['github', 'GitHub', 'utility', '#f97316', 'CI/Actions status for your repos'],
  ] as Array<[string, string, string, string, string]>).map(
    ([id, name, category, color, description], order) => ({
      id,
      name,
      category,
      color,
      description,
      required_tier: 'free',
      order,
    }),
  ),
]

/**
 * Marketing accent per category — the terminal design colors chips and
 * source squares by category (sports red, news cyan, ...), not by the
 * widget's own brand color. Utilities keep their per-widget color.
 */
export const CATEGORY_ACCENT: Record<string, string> = {
  sports: '#ff4757',
  news: '#00d4ff',
  finance: '#34d399',
  fantasy: '#fbbf24',
  predictions: '#a855f7',
}

export function widgetAccent(w: CatalogWidget): string {
  return CATEGORY_ACCENT[w.category] ?? w.color
}

/** Mono source codes for ledger rows (marketing-only, e.g. `FIN—ST`). */
export const WIDGET_ABBR: Record<string, string> = {
  finance_stocks: 'FIN—ST',
  finance_crypto: 'FIN—CR',
  sports_nfl: 'SPT—NFL',
  sports_nba: 'SPT—NBA',
  sports_nhl: 'SPT—NHL',
  sports_mlb: 'SPT—MLB',
  sports_f1: 'SPT—F1',
  sports_worldcup: 'SPT—WC',
  sports_ncaaf: 'SPT—CFB',
  sports_ncaab: 'SPT—CBB',
  sports_premierleague: 'SPT—EPL',
  sports_laliga: 'SPT—LL',
  sports_mls: 'SPT—MLS',
  sports_championsleague: 'SPT—UCL',
  sports_ufc: 'SPT—UFC',
  sports_afl: 'SPT—AFL',
  news_bbc: 'RSS—BBC',
  news_npr: 'RSS—NPR',
  news_guardian: 'RSS—GDN',
  news_aljazeera: 'RSS—AJ',
  news_propublica: 'RSS—PP',
  news_bloomberg: 'RSS—BBG',
  news_cnbc: 'RSS—CNBC',
  news_nasa: 'RSS—NASA',
  news_hackernews: 'RSS—HN',
  news_theverge: 'RSS—TV',
  rss_custom: 'RSS—YOU',
  fantasy_yahoo: 'FAN—YH',
  predictions: 'PRD—KL',
  clock: 'UTL—CK',
  timer: 'UTL—TM',
  weather: 'UTL—WX',
  sysmon: 'UTL—SYS',
  uptime: 'UTL—UP',
  github: 'UTL—GH',
}

export function widgetAbbr(w: CatalogWidget): string {
  return WIDGET_ABBR[w.id] ?? w.id.toUpperCase().slice(0, 8)
}

/** Canonical category display order + labels for grouped views. */
export const CATEGORY_ORDER: Array<{ id: string; label: string }> = [
  { id: 'sports', label: 'SPORTS' },
  { id: 'news', label: 'NEWS & FEEDS' },
  { id: 'finance', label: 'FINANCE' },
  { id: 'utility', label: 'UTILITIES' },
  { id: 'fantasy', label: 'FANTASY' },
  { id: 'predictions', label: 'PREDICTION MARKETS' },
]

export function categoryCounts(
  widgets: Array<CatalogWidget>,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const w of widgets) counts[w.category] = (counts[w.category] ?? 0) + 1
  return counts
}

const CACHE_KEY = 'catalog-cache'
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * The widget catalog, live from GET /catalog with the bundled snapshot
 * as the initial/fallback value. Same sessionStorage-cache pattern as
 * `useGitHubStats`.
 */
export function useCatalog(): Array<CatalogWidget> {
  const [widgets, setWidgets] = useState<Array<CatalogWidget>>(CATALOG_SNAPSHOT)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as {
          widgets: Array<CatalogWidget>
          ts: number
        }
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.widgets.length) {
          setWidgets(parsed.widgets)
          return
        }
      }
    } catch {
      // private mode / malformed cache — fall through to fetch
    }

    let cancelled = false
    catalogApi
      .get()
      .then((res) => {
        if (cancelled || !res.widgets.length) return
        setWidgets(res.widgets)
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ widgets: res.widgets, ts: Date.now() }),
          )
        } catch {
          // quota / private mode — skip
        }
      })
      .catch(() => {
        // offline / dev without API — snapshot already rendered
      })
    return () => {
      cancelled = true
    }
  }, [])

  return widgets
}
