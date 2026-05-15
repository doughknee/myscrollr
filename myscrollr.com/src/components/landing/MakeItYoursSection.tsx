import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Palette } from 'lucide-react'
import { ProductScreenshot } from '@/components/ProductScreenshot'
import { useTheme } from '@/hooks/useTheme'
import { useInViewport } from '@/hooks/useInViewport'

// ── Constants ────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const
const CYCLE_MS = 3500

// ── Theme catalogue ──────────────────────────────────────────────
//
// Each theme has a slug that matches its `themes/<slug>-{dark,light}@*.webp`
// path under `/public/screenshots/`. The accent hex powers the tinted glow
// around the active preview and the active-chip color. Hex values are
// approximate "signature" colors picked from each theme's official palette —
// not pixel-exact, but instantly recognizable to anyone who knows the theme.

interface ThemeEntry {
  slug:
    | 'catppuccin'
    | 'dracula'
    | 'everforest'
    | 'gruvbox'
    | 'nord'
    | 'one'
    | 'rose-pine'
    | 'solarized'
    | 'tokyo-night'
  /** Display name shown in the chip. */
  label: string
  /** Signature accent color, used for the active-state glow + chip dot. */
  accent: string
}

const THEMES: ReadonlyArray<ThemeEntry> = [
  { slug: 'tokyo-night', label: 'Tokyo Night', accent: '#7aa2f7' },
  { slug: 'catppuccin', label: 'Catppuccin', accent: '#cba6f7' },
  { slug: 'dracula', label: 'Dracula', accent: '#bd93f9' },
  { slug: 'nord', label: 'Nord', accent: '#88c0d0' },
  { slug: 'gruvbox', label: 'Gruvbox', accent: '#fabd2f' },
  { slug: 'one', label: 'One', accent: '#61afef' },
  { slug: 'rose-pine', label: 'Rosé Pine', accent: '#eb6f92' },
  { slug: 'everforest', label: 'Everforest', accent: '#a7c080' },
  { slug: 'solarized', label: 'Solarized', accent: '#268bd2' },
] as const

// ── Stacked-deck offsets ─────────────────────────────────────────
//
// The decorative fan-out beneath the switcher renders all 9 theme
// screenshots overlapping at varied rotations + offsets. Hand-tuned to
// look intentional rather than algorithmic. Values are degrees / px.

const DECK_OFFSETS: ReadonlyArray<{ x: number; y: number; rotate: number }> = [
  { x: -240, y: 28, rotate: -10 },
  { x: -180, y: 12, rotate: -7 },
  { x: -120, y: 4, rotate: -4.5 },
  { x: -60, y: 0, rotate: -2 },
  { x: 0, y: -4, rotate: 0 },
  { x: 60, y: 0, rotate: 2 },
  { x: 120, y: 4, rotate: 4.5 },
  { x: 180, y: 12, rotate: 7 },
  { x: 240, y: 28, rotate: 10 },
]

// ── Component ────────────────────────────────────────────────────

export function MakeItYoursSection() {
  const { theme } = useTheme()
  // useTheme() widens its return to `string` because of the server
  // snapshot fallback (`() => 'dark'`). Narrow at the boundary so all
  // downstream typing is exact without changing the hook.
  const siteTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark'
  const [activeIndex, setActiveIndex] = useState(0)
  const [userInteracted, setUserInteracted] = useState(false)
  const [sectionRef, inView] = useInViewport<HTMLElement>({
    rootMargin: '200px 0px',
  })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-cycle while in view and the user hasn't interacted. We intentionally
  // don't restart after manual selection so the picker behaves like a "pinned"
  // choice — same UX pattern as a theme picker in any settings panel.
  useEffect(() => {
    if (!inView || userInteracted) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % THEMES.length)
    }, CYCLE_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [inView, userInteracted])

  const handleSelect = useCallback((index: number) => {
    setActiveIndex(index)
    setUserInteracted(true)
  }, [])

  const active = THEMES[activeIndex]

  return (
    <section
      ref={sectionRef}
      id="themes"
      className="relative scroll-m-20 overflow-hidden"
    >
      <div
        className="mx-auto px-5 sm:px-6 lg:px-8 py-20 lg:py-28 relative"
        style={{ maxWidth: 1400 }}
      >
        {/* Section header ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-12 lg:mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-base-200/60 text-base-content/60 text-[10px] font-bold rounded-lg border border-base-300/40 uppercase tracking-wide mb-6">
            <Palette size={12} />9 themes &middot; light + dark on every channel
          </span>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            Make it{' '}
            <span className="text-gradient-primary">unmistakably yours</span>
          </h2>
          <p className="text-base text-base-content/45 max-w-xl leading-relaxed text-center">
            Pick a palette that matches the rest of your setup. Every theme
            ships with full light and dark variants and applies across every
            channel, widget, and config panel.
          </p>
        </motion.div>

        {/* Theme switcher ─────────────────────────────────────── */}
        <ThemeSwitcher
          themes={THEMES}
          activeIndex={activeIndex}
          accent={active.accent}
          siteTheme={siteTheme}
          onSelect={handleSelect}
        />

        {/* Decorative deck ────────────────────────────────────── */}
        <ThemeDeck siteTheme={siteTheme} />
      </div>
    </section>
  )
}

// ── Theme switcher ──────────────────────────────────────────────

interface ThemeSwitcherProps {
  themes: ReadonlyArray<ThemeEntry>
  activeIndex: number
  accent: string
  siteTheme: 'light' | 'dark'
  onSelect: (index: number) => void
}

function ThemeSwitcher({
  themes,
  activeIndex,
  accent,
  siteTheme,
  onSelect,
}: ThemeSwitcherProps) {
  const active = themes[activeIndex]

  return (
    <div className="relative">
      {/* Preview frame: stack every theme screenshot, fade only the active.
          Mirrors the HeroProductShowcase crossfade pattern so the first paint
          shows the active variant decoded; subsequent swaps are instant
          because all 9 images are already in the cache. */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative mx-auto"
        style={{ maxWidth: 980 }}
      >
        {/* Tinted ambient glow that follows the active theme. */}
        <div
          aria-hidden="true"
          className="absolute -inset-10 rounded-[2rem] blur-3xl pointer-events-none transition-[background-color] duration-700"
          style={{ backgroundColor: `${accent}1a` }}
        />

        <div
          className="relative rounded-2xl border bg-base-100/40 backdrop-blur-sm overflow-hidden transition-[border-color,box-shadow] duration-500"
          style={{
            borderColor: `${accent}40`,
            boxShadow: `0 30px 60px -30px ${accent}40, 0 0 0 1px ${accent}10 inset`,
            aspectRatio: '1600 / 954',
          }}
        >
          {themes.map((theme, idx) => {
            const isActive = idx === activeIndex
            return (
              <div
                key={theme.slug}
                id={`theme-preview-${theme.slug}`}
                role="tabpanel"
                aria-hidden={!isActive}
                className="absolute inset-0"
                style={{
                  opacity: isActive ? 1 : 0,
                  transition: 'opacity 400ms ease-out',
                  pointerEvents: 'none',
                }}
              >
                <ProductScreenshot
                  basename={`themes/${theme.slug}`}
                  themeOverride={siteTheme}
                  alt={
                    isActive
                      ? `Scrollr settings panel rendered in the ${theme.label} ${siteTheme} theme.`
                      : ''
                  }
                  aspect="1600 / 954"
                  pictureClassName="absolute inset-0"
                  imgClassName="block h-full w-full object-cover"
                  priority={idx === 0}
                />
              </div>
            )
          })}
        </div>

        {/* Caption underneath the preview ───────────────────── */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-base-content/55">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="font-mono">
            {active.label} &middot; {siteTheme === 'dark' ? 'Dark' : 'Light'}
          </span>
        </div>
      </motion.div>

      {/* Chip row ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.55, ease: EASE, delay: 0.15 }}
        className="mt-8 flex flex-wrap justify-center gap-2"
        role="tablist"
        aria-label="Theme preview"
      >
        {themes.map((theme, idx) => {
          const isActive = idx === activeIndex
          return (
            <button
              key={theme.slug}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`theme-preview-${theme.slug}`}
              onClick={() => onSelect(idx)}
              className="group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-[background-color,border-color,color] duration-200"
              style={{
                backgroundColor: isActive ? `${theme.accent}1a` : undefined,
                borderColor: isActive ? `${theme.accent}66` : undefined,
                color: isActive ? theme.accent : undefined,
              }}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full transition-transform duration-200"
                style={{
                  backgroundColor: theme.accent,
                  transform: isActive ? 'scale(1.25)' : 'scale(1)',
                }}
              />
              <span
                className={
                  isActive
                    ? ''
                    : 'text-base-content/55 group-hover:text-base-content/80'
                }
              >
                {theme.label}
              </span>
            </button>
          )
        })}
      </motion.div>
    </div>
  )
}

// ── Decorative deck ─────────────────────────────────────────────

interface ThemeDeckProps {
  siteTheme: 'light' | 'dark'
}

/**
 * Renders all 9 theme screenshots as a fanned-out stack beneath the
 * switcher. Purely decorative — no interaction, no animation beyond the
 * scroll-in transform. Uses pure CSS transforms so it stays on the
 * compositor (S-tier per the motion-audit skill).
 *
 * On mobile (<sm) we hide it entirely; the fan-out doesn't read at
 * small sizes and just looks like a pile of thumbnails.
 */
function ThemeDeck({ siteTheme }: ThemeDeckProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, ease: EASE, delay: 0.25 }}
      className="hidden sm:block relative mx-auto mt-24 lg:mt-32"
      style={{ maxWidth: 1200, height: 260 }}
      aria-hidden="true"
    >
      {/* Soft top fade so the deck reads as bleeding off the bottom of
          the section. */}
      <div
        className="absolute inset-x-0 -top-6 h-12 pointer-events-none z-10"
        style={{
          background:
            'linear-gradient(to bottom, var(--color-base-100), transparent)',
        }}
      />

      <div className="relative h-full flex items-start justify-center">
        {THEMES.map((theme, idx) => {
          const offset = DECK_OFFSETS[idx]
          return (
            <div
              key={`deck-${theme.slug}`}
              className="absolute top-0"
              style={{
                width: 280,
                aspectRatio: '1600 / 954',
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${offset.rotate}deg)`,
                zIndex: idx === 4 ? 9 : 9 - Math.abs(idx - 4),
              }}
            >
              <div
                className="h-full w-full rounded-xl overflow-hidden border border-base-300/40 bg-base-200"
                style={{
                  boxShadow:
                    '0 20px 40px -20px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04)',
                }}
              >
                <ProductScreenshot
                  basename={`themes/${theme.slug}`}
                  themeOverride={siteTheme}
                  alt=""
                  aspect="1600 / 954"
                  pictureClassName="block h-full w-full"
                  imgClassName="block h-full w-full object-cover"
                />
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
