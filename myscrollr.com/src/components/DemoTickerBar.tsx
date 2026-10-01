/**
 * The persistent demo ticker bar: the desktop app's widget pages
 * (SCROLLR-198), pinned to every marketing page.
 *
 * A port of desktop/src/components/pages/PagedBar.tsx and EdgeZone.tsx
 * for one window: one widget at a time, laid across the bar in equal
 * columns that fill the width, held for its dwell, then swiped to the
 * next; the widget's name in its own colour on the label at the left;
 * the edge at the right with one slot per utility (Clock cycles its
 * zones, one per swipe). Rules kept from the app (CHIP_SPEC §P):
 *  - A page on screen is FROZEN: which items, in what order, at what
 *    column width, is fixed at swipe-in. Values change in place; a
 *    resize or a new item reaches the next page.
 *  - Hover holds the page and its dwell line.
 *  - Reduced motion (the OS setting) turns every swipe, wipe and roll
 *    into a 0.4 s crossfade.
 *  - One height, 64px. No colour modes: each widget uses its own colour.
 *
 * Site-only differences: the data is demo data (lib/demoData.ts); a
 * widget switched on in the catalog picker is shown straight away; and
 * on a phone-width bar the edge gives its room to the page.
 *
 * SSR renders the empty bar: the data reads the clock, and the bar is
 * fixed and aria-hidden, so it costs no layout shift and no content.
 * The /business white-label switcher passes `override` and never writes
 * the shared `scrollr-marketing-demo` key.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties } from 'react'
import type { DemoPalette } from '@/hooks/useDemoTicker'
import type {
  DemoBarData,
  DemoItem,
  DemoPageWidget,
  DemoSlot,
  DemoUtility,
  FrozenPage,
  Turn,
} from '@/lib/demoPages'
import { resolvePalette, useDemoTicker } from '@/hooks/useDemoTicker'
import { useTheme } from '@/hooks/useTheme'
import { useCatalog } from '@/lib/catalog'
import { demoBar } from '@/lib/demoData'
import {
  LABEL_W,
  accentFor,
  contentWidth,
  freezePage,
  mix,
  newNav,
  nextTurn,
  pageItems,
  planAll,
  refreshPage,
  visitTurn,
} from '@/lib/demoPages'
import {
  AlsoCell,
  GameCell,
  NewsCell,
  QuoteCell,
  Rule,
  accentStyle,
} from '@/components/DemoPageCells'

export interface DemoTickerBarOverride {
  /** The brand's bar colours. */
  palette: DemoPalette
  /** The brand's pages and edge. */
  data: DemoBarData
}

const SWIPE_S = 0.6
const LABEL_S = 0.45
const FADE_S = 0.4
const EASE = [0.32, 0.72, 0, 1] as const
/** Narrower than this, the edge gives its room to the page (a phone). */
const EDGE_MIN_BAR = 520

const EMPTY: DemoBarData = { widgets: [], edge: [] }
const keyOf = (i: DemoItem) => i.key

interface Shown {
  seq: number
  widget: DemoPageWidget
  page: FrozenPage<DemoItem>
  index: number
  count: number
  colW: number
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** A 2px line that fills over the page's dwell and stops while held. */
function DwellLine({
  seq,
  dwell,
  held,
}: {
  seq: number
  dwell: number
  held: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  // The Web Animations API, not Motion's animate(): Motion skips the
  // animation under the site's reduced-motion setting, and this line is
  // a linear progress fill, not motion (the app keeps it there too).
  const ctl = useRef<Animation | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const c = ref.current.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: dwell * 1000, easing: 'linear', fill: 'forwards' },
    )
    ctl.current = c
    return () => c.cancel()
  }, [seq, dwell])
  useEffect(() => {
    const c = ctl.current
    if (!c) return
    if (held) c.pause()
    else if (c.playState === 'paused') c.play()
  }, [held, seq, dwell])
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="absolute bottom-0 left-0 z-10 h-[2px] w-full origin-left"
      style={{ background: 'var(--accent)', transform: 'scaleX(0)' }}
    />
  )
}

function Cell({
  item,
  colW,
  dark,
}: {
  item: DemoItem
  colW: number
  dark: boolean
}) {
  const c = item.cell
  switch (c.kind) {
    case 'game':
      return <GameCell game={c} width={colW} mine={item.mine} />
    case 'news':
      return <NewsCell item={c} width={colW} />
    case 'quote':
      return <QuoteCell quote={c} />
    case 'also':
      return <AlsoCell item={c} accent={accentFor(c.hex, dark)} />
  }
}

// ── The edge (EdgeZone.tsx) ────────────────────────────────────────

function SlotFace({ it, sizer }: { it: DemoSlot; sizer?: boolean }) {
  const tone =
    it.tone === 'live'
      ? 'text-[var(--live)]'
      : it.tone === 'down' || it.tone === 'error'
        ? 'text-[var(--down)]'
        : 'text-[var(--fg)]'
  return (
    <span
      className={`flex min-w-0 flex-col justify-center gap-[4px] px-3 text-left font-mono ${
        sizer
          ? 'invisible col-start-1 row-start-1 h-0 overflow-hidden'
          : 'h-full'
      } ${!sizer && it.dim ? 'opacity-70' : ''}`}
    >
      <span className="truncate whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.08em] text-[var(--fg-3)]">
        {it.label}
        {!sizer && it.dim && it.id.startsWith('clock') ? ' ☾' : ''}
      </span>
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        {it.icon && <span className="text-[12px] leading-none">{it.icon}</span>}
        <span
          className={`text-[16px] font-bold leading-none tabular-nums ${tone}`}
        >
          {sizer ? it.reserve : it.value}
        </span>
      </span>
      {!sizer && (
        <span className="w-0 min-w-full truncate whitespace-nowrap text-[9.5px] leading-none text-[var(--fg-4)]">
          {it.detail ?? ''}
        </span>
      )}
    </span>
  )
}

/** One utility: every item sized in, the one for this turn shown, rolled in with the swipe. */
const Slot = memo(function Slot({
  u,
  tick,
  reduced,
}: {
  u: DemoUtility
  tick: number
  reduced: boolean
}) {
  const it = u.items[tick % u.items.length]
  const roll = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: FADE_S, ease: 'linear' as const },
      }
    : {
        initial: { y: '100%' },
        animate: { y: '0%' },
        exit: { y: '-100%' },
        transition: { duration: LABEL_S, ease: EASE },
      }
  return (
    <span
      data-chip=""
      className="relative grid h-full max-w-[180px] shrink-0 overflow-hidden"
    >
      {u.items.map((x) => (
        <SlotFace key={x.id} it={x} sizer />
      ))}
      <AnimatePresence initial={false}>
        <motion.span
          key={it.id}
          data-item={it.id}
          className="absolute inset-0"
          {...roll}
        >
          <SlotFace it={it} />
        </motion.span>
      </AnimatePresence>
    </span>
  )
})

// ── The bar ────────────────────────────────────────────────────────

export default function DemoTickerBar({
  override,
}: {
  override?: DemoTickerBarOverride
}) {
  const { active, theme: family, pos } = useDemoTicker()
  const { theme: mode } = useTheme()
  const catalog = useCatalog()
  const reduced = useReducedMotion()
  const dark = override ? true : mode === 'dark'
  const pal = override ? override.palette : resolvePalette(family, mode)

  // The demo's clock: values move every 3 s; null until mounted (SSR).
  const [now, setNow] = useState<Date | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setNow(new Date())
    const iv = setInterval(() => {
      setTick((v) => v + 1)
      setNow(new Date())
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const data = useMemo(() => {
    if (override) return override.data
    if (!now) return EMPTY
    return demoBar(
      active,
      (id) => catalog.find((w) => w.id === id)?.color,
      (id) => catalog.find((w) => w.id === id)?.name ?? id,
      tick,
      now,
    )
  }, [override, active, catalog, tick, now])
  const widgets = data.widgets
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets

  // Live width for the NEXT page; the page on screen keeps its own.
  const widthRef = useRef(0)
  const [width, setWidth] = useState(0)
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!bar) return
    const read = () => {
      widthRef.current = bar.clientWidth
      setWidth(bar.clientWidth)
    }
    const ro = new ResizeObserver(read)
    ro.observe(bar)
    read()
    return () => ro.disconnect()
  }, [bar])
  const showEdge = width >= EDGE_MIN_BAR && data.edge.length > 0
  const edgeEl = useRef<HTMLDivElement>(null)
  const edgeW = () => edgeEl.current?.offsetWidth ?? 0

  const [turn, setTurn] = useState<Turn | null>(null)
  const turnRef = useRef<Turn | null>(null)
  const [planWidth, setPlanWidth] = useState(0)
  const [planEdge, setPlanEdge] = useState(0)
  const [held, setHeld] = useState(false)
  const heldRef = useRef(false)
  const nav = useRef(newNav())

  const show = useCallback((t: Turn | null) => {
    turnRef.current = t
    setPlanWidth(widthRef.current)
    setPlanEdge(edgeW())
    setTurn(t)
  }, [])

  const advance = useCallback(() => {
    const ws = widgetsRef.current
    show(
      nextTurn(
        turnRef.current,
        ws,
        planAll(ws, widthRef.current, edgeW()),
        nav.current,
      ),
    )
  }, [show])

  useEffect(() => {
    if (!turnRef.current && widgets.length > 0 && width > 0) advance()
  }, [turn, widgets.length, width, advance])

  // The page clock: restarts only on a new turn and stands still while held.
  useEffect(() => {
    if (!turn) return
    let left = turn.dwell * 1000
    let last = performance.now()
    const id = window.setInterval(() => {
      const t = performance.now()
      if (!heldRef.current) left -= t - last
      last = t
      if (left > 0) return
      window.clearInterval(id)
      advance()
    }, 100)
    return () => window.clearInterval(id)
  }, [turn, advance])

  // Watch the bar change: a widget switched on in the picker comes up
  // now; the one on screen switched off (or a new brand) moves on.
  const tabsKey = widgets.map((w) => w.tab).join(' ')
  const prevActive = useRef(active)
  useEffect(() => {
    const before = prevActive.current
    prevActive.current = active
    const cur = turnRef.current
    if (!cur) return
    const ws = widgetsRef.current
    const added = active.filter((id) => !before.includes(id))
    const target = added
      .map((id) =>
        ws.find(
          (w) => w.tab === id || w.items.some((i) => i.key === `q:${id}`),
        ),
      )
      .find(Boolean)
    if (target) {
      show(
        visitTurn(
          cur,
          target.tab,
          planAll(ws, widthRef.current, edgeW()),
          nav.current,
        ),
      )
    } else if (!ws.some((w) => w.tab === cur.tab)) {
      advance()
    }
  }, [active, tabsKey, show, advance])

  const onHover = (on: boolean) => {
    heldRef.current = on
    setHeld(on)
  }

  // ── The frozen page ─────────────────────────────────────────────
  const plans = useMemo(
    () => planAll(widgets, planWidth, planEdge),
    [widgets, planWidth, planEdge],
  )
  const shown = useRef<Shown | null>(null)
  if (turn && shown.current?.seq !== turn.seq) {
    const w = widgets.find((x) => x.tab === turn.tab)
    const plan = plans.get(turn.tab)
    if (w && plan && plan.pages.length > 0) {
      const index = Math.min(turn.page, plan.pages.length - 1)
      const items = plan.pages[index]
      shown.current = {
        seq: turn.seq,
        widget: w,
        page: freezePage(items, keyOf),
        index,
        count: plan.pages.length,
        colW: contentWidth(planWidth, planEdge) / items.length,
      }
    }
  }
  const cur = shown.current
  const live = cur ? widgets.find((x) => x.tab === cur.widget.tab) : undefined
  if (cur && live) cur.page = refreshPage(cur.page, live.items, keyOf)

  const accent = accentFor(cur?.widget.hex, dark)
  const items = cur ? pageItems(cur.page) : []
  const fade = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: FADE_S, ease: 'linear' as const },
  }
  const swipe = {
    initial: { x: '100%' },
    animate: { x: '0%' },
    exit: { x: '-100%' },
    transition: { duration: SWIPE_S, ease: EASE },
  }
  const wipe = {
    initial: { y: '100%' },
    animate: { y: '0%' },
    exit: { y: '-100%' },
    transition: { duration: LABEL_S, ease: EASE },
  }

  const barStyle = {
    background: pal.bg,
    [pos === 'bottom' ? 'borderTop' : 'borderBottom']:
      `1px solid ${pal.border}`,
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    '--fg': pal.fg,
    '--fg-2': pal.text,
    '--fg-3': pal.muted,
    '--fg-4': pal.fg4,
    '--up': pal.up,
    '--down': pal.down,
    '--live': pal.live,
  } as CSSProperties

  return (
    <div
      ref={setBar}
      role="presentation"
      aria-hidden="true"
      data-demo-ticker-bar={pos}
      data-pages=""
      data-motion-style={reduced ? 'fade' : 'swipe'}
      className={`fixed left-0 right-0 z-50 flex h-16 items-stretch overflow-hidden backdrop-blur-[14px] ${
        pos === 'bottom' ? 'bottom-0' : 'top-0'
      }`}
      style={barStyle}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      {cur && (
        <>
          {/* The label: the widget's name in its colour. Pages of the
              same widget keep it; a new widget wipes it upward. */}
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ ...accentStyle(accent), width: LABEL_W }}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={cur.widget.tab}
                data-label={cur.widget.tab}
                className="absolute inset-0 flex flex-col justify-center gap-[3px] pl-3.5 pr-2"
                style={{
                  ...accentStyle(accent),
                  background: mix(dark ? 16 : 12),
                  borderRight: `1px solid ${mix(40)}`,
                }}
                {...(reduced ? fade : wipe)}
              >
                <span
                  className={`truncate font-extrabold leading-none tracking-[0.04em] ${
                    cur.widget.code.length > 6 ? 'text-[15px]' : 'text-[19px]'
                  }`}
                  style={{ color: 'var(--accent)' }}
                >
                  {cur.widget.code}
                </span>
                <span className="flex items-center justify-between gap-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--fg-3)]">
                  <span className="truncate">{(live ?? cur.widget).sub}</span>
                  {cur.count > 5 && (
                    <span
                      className="shrink-0 tabular-nums"
                      style={{ color: 'var(--accent)' }}
                    >
                      {cur.index + 1}/{cur.count}
                    </span>
                  )}
                  {cur.count > 1 && cur.count <= 5 && (
                    <span className="flex shrink-0 gap-[3px]">
                      {Array.from({ length: cur.count }, (_, i) => (
                        <span
                          key={i}
                          className="h-[4px] w-[4px] rounded-full"
                          style={{
                            background:
                              i === cur.index ? 'var(--accent)' : mix(30),
                          }}
                        />
                      ))}
                    </span>
                  )}
                </span>
              </motion.div>
            </AnimatePresence>
            {turn && (
              <DwellLine seq={turn.seq} dwell={turn.dwell} held={held} />
            )}
          </div>

          {/* The page: equal columns, full width, swiped in whole. */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              <motion.div
                key={cur.seq}
                data-page={`${cur.widget.tab}:${cur.index + 1}/${cur.count}`}
                className="absolute inset-0 grid"
                style={{
                  ...accentStyle(accent),
                  gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))`,
                }}
                {...(reduced ? fade : swipe)}
              >
                {items.map((item, i) => (
                  <div
                    key={item.key}
                    className="relative min-w-0"
                    data-widget={cur.widget.tab}
                  >
                    {i > 0 && <Rule />}
                    <Cell item={item} colW={cur.colW} dark={dark} />
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
      {/* The fixed edge: outside the page block. */}
      {showEdge && (
        <div
          ref={edgeEl}
          data-edge=""
          className="relative ml-auto flex h-full shrink-0"
          style={{ borderLeft: `1px solid ${pal.border}` }}
        >
          {data.edge.map((u, i) => (
            <div
              key={u.tab}
              className="relative flex h-full"
              data-widget={u.tab}
              style={accentStyle(accentFor(u.hex, dark))}
            >
              {i > 0 && <Rule />}
              <Slot u={u} tick={turn?.seq ?? 0} reduced={reduced} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
