/**
 * Shared state for the persistent marketing demo bar (its data: lib/demoData.ts).
 *
 * State contract (design_handoff_marketing_site/README.md): localStorage
 * key `scrollr-marketing-demo` holds
 *   { active: string[] (widget ids), theme: string (theme FAMILY id —
 *     light/dark comes from the site color mode), pos: 'top'|'bottom' }
 * Older saves also carry density and direction; the bar has one height
 * and pages do not scroll (SCROLLR-198), so both are ignored.
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

import { useCallback, useSyncExternalStore } from 'react'

export interface DemoPalette {
  /** Bar surface colors — the theme's base-150 / edge. */
  bg: string
  border: string
  /** Text, strongest to faintest — the theme's fg / fg-2 / fg-3 / fg-4. */
  fg: string
  text: string
  muted: string
  fg4: string
  /** Theme accent (app --color-primary): swatch dot. */
  accent: string
  /** The app's --color-up / --color-down / --color-live. */
  up: string
  down: string
  live: string
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
    dark: { bg: 'rgba(23,23,38,.92)', border: '#282838', fg: '#e2e2ec', text: '#b7b7c6', muted: '#9292a4', fg4: '#78788a', accent: '#34d399', up: '#22c55e', down: '#ef4444', live: '#ff4757' },
    light: { bg: 'rgba(246,247,251,.94)', border: '#d5d7e2', fg: '#1a1b2e', text: '#4a4a5a', muted: '#7a7a8a', fg4: '#a0a0b0', accent: '#34d399', up: '#22c55e', down: '#ef4444', live: '#ff4757' },
  },
  {
    id: 'catppuccin', name: 'CATPPUCCIN',
    dark: { bg: 'rgba(24,24,37,.92)', border: '#313244', fg: '#cdd6f4', text: '#bac2de', muted: '#a6adc8', fg4: '#7f849c', accent: '#a6e3a1', up: '#a6e3a1', down: '#f38ba8', live: '#f38ba8' },
    light: { bg: 'rgba(230,233,239,.94)', border: '#ccd0da', fg: '#4c4f69', text: '#5c5f77', muted: '#6c6f85', fg4: '#8c8fa1', accent: '#40a02b', up: '#40a02b', down: '#d20f39', live: '#d20f39' },
  },
  {
    id: 'dracula', name: 'DRACULA',
    dark: { bg: 'rgba(33,34,44,.92)', border: '#44475a', fg: '#f8f8f2', text: '#d8d8d2', muted: '#a8a8a2', fg4: '#6272a4', accent: '#50fa7b', up: '#50fa7b', down: '#ff5555', live: '#ff5555' },
    light: { bg: 'rgba(239,239,230,.94)', border: '#c2c2b2', fg: '#282a36', text: '#44475a', muted: '#6272a4', fg4: '#828bbc', accent: '#2a9d6f', up: '#2a9d6f', down: '#c43a3a', live: '#c43a3a' },
  },
  {
    id: 'tokyo-night', name: 'TOKYO NIGHT',
    dark: { bg: 'rgba(22,22,30,.92)', border: '#2f334d', fg: '#c0caf5', text: '#a9b1d6', muted: '#9aa5ce', fg4: '#565f89', accent: '#7aa2f7', up: '#9ece6a', down: '#f7768e', live: '#f7768e' },
    light: { bg: 'rgba(213,214,220,.94)', border: '#c4c8da', fg: '#3760bf', text: '#4c5079', muted: '#6172b0', fg4: '#848cb5', accent: '#2e7de9', up: '#587539', down: '#f52a65', live: '#f52a65' },
  },
  {
    id: 'nord', name: 'NORD',
    dark: { bg: 'rgba(41,46,57,.92)', border: '#3b4252', fg: '#eceff4', text: '#e5e9f0', muted: '#d8dee9', fg4: '#8d96a8', accent: '#88c0d0', up: '#a3be8c', down: '#bf616a', live: '#bf616a' },
    light: { bg: 'rgba(229,233,240,.94)', border: '#d8dee9', fg: '#2e3440', text: '#434c5e', muted: '#4c566a', fg4: '#6f7889', accent: '#5e81ac', up: '#6a8857', down: '#bf616a', live: '#bf616a' },
  },
  {
    id: 'gruvbox', name: 'GRUVBOX',
    dark: { bg: 'rgba(50,48,47,.92)', border: '#3c3836', fg: '#ebdbb2', text: '#d5c4a1', muted: '#bdae93', fg4: '#a89984', accent: '#b8bb26', up: '#b8bb26', down: '#fb4934', live: '#fb4934' },
    light: { bg: 'rgba(242,229,188,.94)', border: '#ebdbb2', fg: '#3c3836', text: '#504945', muted: '#665c54', fg4: '#7c6f64', accent: '#79740e', up: '#79740e', down: '#9d0006', live: '#9d0006' },
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

export interface DemoTickerState {
  active: Array<string>
  /** Theme FAMILY id (light/dark comes from the site color mode). */
  theme: string
  pos: 'top' | 'bottom'
}

const STORAGE_KEY = 'scrollr-marketing-demo'
const DEFAULT_STATE: DemoTickerState = {
  active: ['sports_nfl', 'finance_stocks', 'news_bbc', 'clock'],
  theme: 'scrollr',
  pos: 'bottom',
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

  return { ...snapshot, toggle, setTheme, setPos }
}
