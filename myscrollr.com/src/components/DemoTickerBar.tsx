/**
 * The persistent demo ticker bar — a working mini-Scrollr pinned to
 * every marketing page (design_handoff_marketing_site/README.md).
 *
 * Left cell: pulsing dot + mono label. Middle: seamless marquee (chip
 * list duplicated 2x, `translateX(-50%)` loop, pause on hover — see
 * `.demo-marquee` in styles.css). Right cell: live clock. The theme
 * FAMILY, position, density, and direction come from the shared
 * `scrollr-marketing-demo` state; light/dark comes from the site color
 * mode (useTheme), exactly like the app's family + mode split. The
 * /business white-label switcher passes `override` instead and never
 * writes the shared key.
 *
 * Chips render as the desktop app's actual ticker cards
 * (desktop/src/components/chips): tinted rounded cards (accent at ~6%
 * bg / ~25% border), mono 13px, two-tone symbol/price text, tabular
 * game scores with winner emphasis, up/down deltas in the active
 * theme's up/down tokens, uppercase 11px status with a pulsing LIVE
 * dot, 8px gaps, and the theme-accent gradient hairline on the top
 * edge. Source accents re-tint per palette exactly like the app's
 * themes do. Density mirrors the app's compact (1-row, 44px-class) and
 * detailed/comfort (2-row) chip layouts.
 *
 * Reduced motion: the global reduced-motion CSS freezes the marquee at
 * translateX(0), leaving the first chip copy visible as static content.
 */

import { useEffect, useState } from 'react'
import { Ticker } from 'motion-plus/react'
import type { CSSProperties } from 'react'
import type { DemoChip, DemoPalette } from '@/hooks/useDemoTicker'
import {
  paletteRemap,
  resolvePalette,
  useDemoChips,
  useDemoTicker,
} from '@/hooks/useDemoTicker'
import { useTheme } from '@/hooks/useTheme'

export interface DemoTickerBarOverride {
  /** Left-cell label, e.g. 'ACME CAPITAL'. */
  label: string
  /** Accent for the pulsing dot. */
  accent: string
  /** Bar colors (bg/border/text/muted). */
  palette: Pick<DemoPalette, 'bg' | 'border' | 'text' | 'muted'>
  /** Chips to scroll instead of the shared active-widget set. */
  chips: Array<DemoChip>
}

export default function DemoTickerBar({
  override,
}: {
  override?: DemoTickerBarOverride
}) {
  // Position and density always follow the shared store — /business's
  // white-label instance included, so the bar behaves identically on
  // every page (it overrides chips/palette there, never placement).
  const { active, theme: family, pos, density, direction } = useDemoTicker()
  const { theme: mode } = useTheme()
  const sharedChips = useDemoChips(override ? [] : active)

  const themePalette = resolvePalette(family, mode)
  const chips = override ? override.chips : sharedChips
  const pal = override ? override.palette : themePalette
  const label = override ? override.label : 'SCROLLR'
  const accent = override ? override.accent : themePalette.accent
  // The app re-tints source chips + deltas when the theme changes; the
  // white-label override authors its chips in final brand colors.
  const remap = override ? {} : paletteRemap(themePalette)
  const up = override ? '#22c55e' : themePalette.up
  const down = override ? '#ef4444' : themePalette.down
  const detailed = density === 'detailed'

  // Ticker measures widths client-side; the pre-mount render is a
  // static chip run so prerendered HTML carries real content.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Hover pause driven explicitly (hoverFactor proved unreliable in
  // this embed) — velocity drops to 0 while the pointer is over the
  // chip run, matching the old CSS marquee's pause-on-hover.
  const [hovered, setHovered] = useState(false)

  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const iv = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(iv)
  }, [])

  const barStyle: CSSProperties = {
    background: pal.bg,
    [pos === 'bottom' ? 'borderTop' : 'borderBottom']:
      `1px solid ${pal.border}`,
    ['--bar-border' as string]: pal.border,
    ['--bar-text' as string]: pal.text,
    ['--bar-muted' as string]: pal.muted,
  }

  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-demo-ticker-bar={pos}
      className={`fixed left-0 right-0 z-50 flex items-center backdrop-blur-[14px] motion-safe:transition-[height] motion-safe:duration-300 motion-safe:ease-out ${
        detailed ? 'h-16' : 'h-12'
      } ${pos === 'bottom' ? 'bottom-0' : 'top-0'}`}
      style={barStyle}
    >
      {/* The app ticker's signature accent hairline (ScrollrTicker.tsx) */}
      <div
        className="absolute left-0 right-0 top-0 z-10 h-px"
        style={{
          background: `linear-gradient(to right, transparent, ${accent}33, transparent)`,
        }}
      />
      <div
        className="flex h-full flex-shrink-0 items-center gap-2 border-r px-4"
        style={{ borderColor: 'var(--bar-border)' }}
      >
        <span
          className="animate-pulse-dot h-[7px] w-[7px] rounded-full"
          style={{ background: accent }}
        />
        <span
          className="font-mono text-[11px] font-semibold tracking-[0.12em]"
          style={{ color: 'var(--bar-muted)' }}
        >
          {label}
        </span>
      </div>

      <div
        className="flex h-full min-w-0 flex-1 items-center overflow-hidden"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {mounted ? (
          // Motion+ Ticker: velocity matched to the old CSS marquee
          // (measured 32px/s), sign flips for direction, 0 while
          // hovered, respects OS reduced motion, and its reprojection
          // renderer keeps the loop seamless.
          <Ticker
            items={chips.map((c, i) => (
              <ChipCard
                key={i}
                chip={c}
                remap={remap}
                up={up}
                down={down}
                detailed={detailed}
              />
            ))}
            velocity={hovered ? 0 : direction === 'right' ? -32 : 32}
            gap={8}
            className="w-full"
          />
        ) : (
          // SSR + first client render: static chip run so prerendered
          // pages carry real chip content and hydration matches.
          <ChipRun
            chips={chips}
            remap={remap}
            up={up}
            down={down}
            detailed={detailed}
          />
        )}
      </div>

      <div
        className="flex h-full flex-shrink-0 items-center gap-3 border-l px-4 font-mono text-xs"
        style={{ borderColor: 'var(--bar-border)', color: 'var(--bar-muted)' }}
      >
        {now
          ? now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : '--:--'}
      </div>
    </div>
  )
}

// ── App-faithful chip cards ──────────────────────────────────────
// Colors/typography mirror desktop/src/components/chips/* — see the
// module doc comment. Up/down and source accents come from the active
// palette (the app re-tints chips per theme).
const MUTED = '#9292a4' // app --color-fg-3, used for middots/separators

/** hex + alpha suffix helpers matching the app's /[0.06] and /25 tints */
const tint = (hex: string) => hex + '0f' // ~6%
const edge = (hex: string) => hex + '40' // ~25%
const dim = (hex: string) => hex + 'b3' // ~70%
const faint = (hex: string) => hex + '8c' // ~55%

const LIVE = '#ff4757'

interface ChipRenderCtx {
  remap: Record<string, string>
  up: string
  down: string
  detailed: boolean
}

/** Uppercase 11px status label, red + pulsing dot when live. */
function GameStatus({ status, live }: { status: string; live?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 text-[11px] uppercase tracking-wider ${
        live ? 'font-semibold' : ''
      }`}
      style={{ color: live ? LIVE : MUTED }}
    >
      {live && (
        <span className="animate-pulse-dot h-[5px] w-[5px] rounded-full bg-[#ff4757] [animation-duration:1.4s]" />
      )}
      {status}
    </span>
  )
}

function ChipCard({
  chip,
  remap,
  up,
  down,
  detailed,
}: { chip: DemoChip } & ChipRenderCtx) {
  const a = remap[chip.accent] ?? chip.accent

  // Row 1 — same content in both densities, except game status and
  // text sub move down to row 2 in detailed (matches the app's
  // comfort chips).
  const row1 = (
    <span className="flex items-center gap-2">
      {chip.kind === 'trade' && (
        <>
          <span className="font-semibold" style={{ color: a }}>
            {chip.symbol}
          </span>
          <span style={{ color: dim(a) }}>{chip.price}</span>
          {chip.delta && (
            <span
              className="text-xs font-medium"
              style={{ color: chip.up ? up : down }}
            >
              {chip.delta}
            </span>
          )}
        </>
      )}

      {chip.kind === 'game' && (
        <>
          <span
            className={chip.winner === 'away' ? 'font-bold' : 'font-semibold'}
            style={{ color: a }}
          >
            {chip.away}
          </span>
          <span
            className={`tabular-nums ${chip.winner === 'away' ? 'font-bold' : ''}`}
            style={{ color: chip.winner === 'away' ? a : dim(a) }}
          >
            {chip.awayScore}
          </span>
          <span style={{ color: MUTED }}>-</span>
          <span
            className={`tabular-nums ${chip.winner === 'home' ? 'font-bold' : ''}`}
            style={{ color: chip.winner === 'home' ? a : dim(a) }}
          >
            {chip.homeScore}
          </span>
          <span
            className={chip.winner === 'home' ? 'font-bold' : 'font-semibold'}
            style={{ color: a }}
          >
            {chip.home}
          </span>
          {!detailed && (
            <span className="ml-0.5">
              <GameStatus status={chip.status} live={chip.live} />
            </span>
          )}
        </>
      )}

      {chip.kind === 'news' && (
        <>
          <span className="font-medium" style={{ color: a }}>
            {chip.headline}
          </span>
          {!detailed && (
            <>
              <span style={{ color: MUTED }}>·</span>
              <span className="text-xs" style={{ color: dim(a) }}>
                {chip.source}
              </span>
            </>
          )}
        </>
      )}

      {chip.kind === 'text' && (
        <>
          <span className="font-semibold" style={{ color: a }}>
            {chip.label}
          </span>
          {chip.value && <span style={{ color: dim(a) }}>{chip.value}</span>}
          {!detailed && chip.sub && (
            <span
              className="text-[11px] uppercase tracking-wider"
              style={{ color: faint(a) }}
            >
              {chip.sub}
            </span>
          )}
        </>
      )}
    </span>
  )

  // Row 2 — detailed density only (the app's comfort second line).
  let row2: React.ReactNode = null
  if (detailed) {
    if (chip.kind === 'trade' && chip.detail) {
      row2 = <span style={{ color: faint(a) }}>{chip.detail}</span>
    } else if (chip.kind === 'game') {
      row2 = (
        <span className="flex items-center gap-1.5" style={{ color: faint(a) }}>
          {chip.league && (
            <>
              <span className="font-semibold">{chip.league}</span>
              <span style={{ color: MUTED }}>·</span>
            </>
          )}
          <GameStatus status={chip.status} live={chip.live} />
        </span>
      )
    } else if (chip.kind === 'news') {
      row2 = (
        <span className="flex items-center gap-1.5" style={{ color: faint(a) }}>
          <span>{chip.source}</span>
          {chip.detail && (
            <>
              <span style={{ color: MUTED }}>·</span>
              <span>{chip.detail}</span>
            </>
          )}
        </span>
      )
    } else if (chip.kind === 'text' && chip.sub) {
      row2 = (
        <span className="uppercase tracking-wider" style={{ color: faint(a) }}>
          {chip.sub}
        </span>
      )
    }
  }

  return (
    <span
      className={`demo-chip whitespace-nowrap rounded-[4px] border px-3 font-mono text-[13px] leading-5 ${
        detailed
          ? 'flex flex-col items-start gap-0.5 py-1.5'
          : 'flex items-center py-1'
      }`}
      style={{ background: tint(a), borderColor: edge(a) }}
    >
      {row1}
      {row2 && <span className="text-[11px] leading-4">{row2}</span>}
    </span>
  )
}

function ChipRun({
  chips,
  ...ctx
}: { chips: Array<DemoChip> } & ChipRenderCtx) {
  // A real flex container (not a fragment) so the run has its own
  // width including a trailing gap — the -50% marquee loop then lands
  // exactly on the seam between the two copies.
  return (
    <span className="flex items-center gap-2 pr-2">
      {chips.map((c, i) => (
        <ChipCard key={i} chip={c} {...ctx} />
      ))}
    </span>
  )
}
