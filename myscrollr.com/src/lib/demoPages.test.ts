import { describe, expect, it } from 'vitest'
import { CATALOG_SNAPSHOT } from '@/lib/catalog'
import { demoBar, sampleText } from '@/lib/demoData'
import {
  LABEL_W,
  TIER,
  columnsFor,
  contentWidth,
  dwellFor,
  freezePage,
  liftForTint,
  newNav,
  nextTurn,
  pageItems,
  paginate,
  planAll,
  planWidget,
  refreshPage,
  reserveOf,
  visitPages,
} from '@/lib/demoPages'

// The same numbers desktop/src/components/pages/pagePlan.test.ts pins: the
// site's bar is a port, and these are where a port drifts.
const range = (n: number) => [...Array(n).keys()]

describe('the page arithmetic matches the app', () => {
  it('columns', () => {
    expect(columnsFor(1920 - LABEL_W, 212)).toBe(8)
    expect(columnsFor(contentWidth(1280), 212)).toBe(5)
    expect(columnsFor(contentWidth(1280), 244)).toBe(4)
    expect(columnsFor(0, 172)).toBe(1)
  })

  it('pages are balanced, larger first, in order', () => {
    expect(paginate(range(14), 12).map((p) => p.length)).toEqual([7, 7])
    expect(paginate(range(56), 5).map((p) => p.length)).toEqual([
      5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4,
    ])
    expect(paginate(range(6), 5).flat()).toEqual(range(6))
  })

  it('live items lead and count as sticky pages', () => {
    const tiers = [3, 0, 1, 0, 0, 2] as const
    const plan = planWidget(range(6), (i) => tiers[i], 2)
    expect(plan.pages).toEqual([
      [1, 3],
      [4, 2],
      [5, 0],
    ])
    expect(plan.sticky).toBe(2)
  })

  it('a visit shows the sticky pages, then two more, wrapping', () => {
    expect(visitPages(3, 1, 1).pages).toEqual([0, 1, 2])
    expect(visitPages(6, 1, 1)).toEqual({ pages: [0, 1, 2], next: 3 })
    expect(visitPages(6, 5, 1)).toEqual({ pages: [0, 5, 1], next: 2 })
  })

  it('dwell is 6..12 s', () => {
    expect(dwellFor(2)).toBe(6)
    expect(dwellFor(8)).toBe(9)
    expect(dwellFor(20)).toBe(12)
  })

  it('a frozen page takes new values, never new items or order', () => {
    const key = (x: { k: string }) => x.k
    const f = freezePage(
      [
        { k: 'a', v: 1 },
        { k: 'b', v: 1 },
      ],
      key,
    )
    const r = refreshPage(
      f,
      [
        { k: 'c', v: 9 },
        { k: 'b', v: 2 },
      ],
      key,
    )
    expect(pageItems(r)).toEqual([
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ])
  })

  it('reserves the widest value and lifts navy for the dark bar', () => {
    expect(reserveOf('7:21 PM', 2)).toBe('00:00 PM')
    expect(reserveOf('61°F', 3)).toBe('000°F')
    expect(liftForTint('#e10600')).toBe('#e10600')
    expect(liftForTint('#013369')).not.toBe('#013369')
  })
})

describe('the demo bar', () => {
  const hexOf = (id: string) => CATALOG_SNAPSHOT.find((w) => w.id === id)?.color
  const nameOf = (id: string) =>
    CATALOG_SNAPSHOT.find((w) => w.id === id)?.name ?? id
  const now = new Date('2026-10-04T18:40:00Z')

  it('lays the default bar out like the shim at 1280: NFL 8 live, yours first', () => {
    const { widgets, edge } = demoBar(
      ['sports_nfl', 'finance_stocks', 'news_bbc', 'clock'],
      hexOf,
      nameOf,
      0,
      now,
    )
    expect(widgets.map((w) => w.code)).toEqual(['NFL', 'STOCKS', 'BBC'])
    expect(edge.map((u) => u.tab)).toEqual(['clock'])
    expect(edge[0].items).toHaveLength(4)
    const nfl = widgets[0]
    expect(nfl.sub).toBe('8 LIVE')
    expect(nfl.items[0].mine).toBe(true)
    const plans = planAll(widgets, 1280, 102)
    expect(plans.get('sports_nfl')?.pages.map((p) => p.length)).toEqual([
      5, 5, 4,
    ])
    expect(plans.get('sports_nfl')?.sticky).toBe(2)
  })

  it('visits every widget in bar order and wraps', () => {
    const { widgets } = demoBar(
      ['news_bbc', 'finance_stocks'],
      hexOf,
      nameOf,
      0,
      now,
    )
    const plans = planAll(widgets, 1280)
    const nav = newNav()
    let t = nextTurn(null, widgets, plans, nav)
    const seen: Array<string> = []
    for (let i = 0; i < 5 && t; i++) {
      seen.push(`${t.tab}:${t.page}`)
      t = nextTurn(t, widgets, plans, nav)
    }
    expect(seen).toEqual([
      'news_bbc:0',
      'news_bbc:1',
      'finance_stocks:0',
      'finance_stocks:1',
      'news_bbc:0',
    ])
  })

  it('every catalog widget shows something: a page, an edge slot or an Also line', () => {
    for (const w of CATALOG_SNAPSHOT) {
      const { widgets, edge } = demoBar([w.id], hexOf, nameOf, 0, now)
      expect(widgets.length + edge.length, w.id).toBe(1)
      expect(sampleText(w.id, hexOf, nameOf, 0, now), w.id).not.toBe('')
    }
    const quiet = demoBar(['sports_f1'], hexOf, nameOf, 0, now).widgets[0]
    expect(quiet.code).toBe('ALSO')
    expect(quiet.items[0].tier).toBe(TIER.status)
  })
})
