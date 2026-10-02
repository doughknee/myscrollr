/**
 * What the visitor did to the site's live bar (SCROLLR-310): which widgets
 * are on it, the theme family, the edge it is pinned to, pages or a
 * continuous scroll. The bar itself is the app's real ticker in an iframe
 * (LiveBar); this store only builds its URL and the controls around it.
 *
 * localStorage `scrollr-marketing-demo` holds { active, customized, theme,
 * pos, scroll } (the pre-hydration theme script in __root.tsx reads
 * `theme`). Until the visitor toggles a widget, `customized` is false and
 * the bar shows the embed's own default; the embed reports that set back
 * (LiveBar → `adoptShown`) so the catalog pills match what is on the bar.
 *
 * A module-level external store, as before: SSR and the first client render
 * use the defaults, storage is applied after mount (no hydration mismatch),
 * and a `storage` listener keeps tabs in sync.
 */

import { useCallback, useSyncExternalStore } from 'react'

export interface ThemeSwatch {
  bg: string
  border: string
  text: string
  accent: string
  up: string
}

export interface ThemeFamily {
  id: string
  name: string
  dark: ThemeSwatch
  light: ThemeSwatch
}

/** The app ships 10 families, each light and dark. */
export const APP_FAMILY_COUNT = 10

/** The families offered on the site, with each one's bar colours for the swatch. */
// prettier-ignore
export const BAR_THEMES: Array<ThemeFamily> = [
  { id: 'scrollr', name: 'SCROLLR',
    dark: { bg: 'rgba(23,23,38,.92)', border: '#282838', text: '#b7b7c6', accent: '#34d399', up: '#22c55e' },
    light: { bg: 'rgba(246,247,251,.94)', border: '#d5d7e2', text: '#4a4a5a', accent: '#34d399', up: '#22c55e' } },
  { id: 'catppuccin', name: 'CATPPUCCIN',
    dark: { bg: 'rgba(24,24,37,.92)', border: '#313244', text: '#bac2de', accent: '#a6e3a1', up: '#a6e3a1' },
    light: { bg: 'rgba(230,233,239,.94)', border: '#ccd0da', text: '#5c5f77', accent: '#40a02b', up: '#40a02b' } },
  { id: 'dracula', name: 'DRACULA',
    dark: { bg: 'rgba(33,34,44,.92)', border: '#44475a', text: '#d8d8d2', accent: '#50fa7b', up: '#50fa7b' },
    light: { bg: 'rgba(239,239,230,.94)', border: '#c2c2b2', text: '#44475a', accent: '#2a9d6f', up: '#2a9d6f' } },
  { id: 'tokyo-night', name: 'TOKYO NIGHT',
    dark: { bg: 'rgba(22,22,30,.92)', border: '#2f334d', text: '#a9b1d6', accent: '#7aa2f7', up: '#9ece6a' },
    light: { bg: 'rgba(213,214,220,.94)', border: '#c4c8da', text: '#4c5079', accent: '#2e7de9', up: '#587539' } },
  { id: 'nord', name: 'NORD',
    dark: { bg: 'rgba(41,46,57,.92)', border: '#3b4252', text: '#e5e9f0', accent: '#88c0d0', up: '#a3be8c' },
    light: { bg: 'rgba(229,233,240,.94)', border: '#d8dee9', text: '#434c5e', accent: '#5e81ac', up: '#6a8857' } },
  { id: 'gruvbox', name: 'GRUVBOX',
    dark: { bg: 'rgba(50,48,47,.92)', border: '#3c3836', text: '#d5c4a1', accent: '#b8bb26', up: '#b8bb26' },
    light: { bg: 'rgba(242,229,188,.94)', border: '#ebdbb2', text: '#504945', accent: '#79740e', up: '#79740e' } },
]

export interface BarState {
  active: Array<string>
  /** False until the visitor toggles a widget: the embed's default is shown. */
  customized: boolean
  theme: string
  pos: 'top' | 'bottom'
  scroll: 'pages' | 'continuous'
}

const STORAGE_KEY = 'scrollr-marketing-demo'
const DEFAULT_STATE: BarState = {
  // The embed's starter until it reports what it chose.
  active: ['finance_stocks', 'news_npr', 'clock'],
  customized: false,
  theme: 'scrollr',
  pos: 'bottom',
  scroll: 'pages',
}

let state: BarState = DEFAULT_STATE
let loadedFromStorage = false
let listeners: Array<() => void> = []

function emit() {
  for (const l of listeners) l()
}

function sanitize(raw: unknown): Partial<BarState> {
  if (typeof raw !== 'object' || raw === null) return {}
  const saved = raw as Record<string, unknown>
  const patch: Partial<BarState> = {}
  // Only a list the visitor built counts; older saves carried the demo's default.
  if (
    saved.customized === true &&
    Array.isArray(saved.active) &&
    saved.active.every((id) => typeof id === 'string')
  ) {
    patch.active = saved.active
    patch.customized = true
  }
  if (
    typeof saved.theme === 'string' &&
    BAR_THEMES.some((f) => f.id === saved.theme)
  ) {
    patch.theme = saved.theme
  }
  if (saved.pos === 'top' || saved.pos === 'bottom') patch.pos = saved.pos
  if (saved.scroll === 'pages' || saved.scroll === 'continuous') {
    patch.scroll = saved.scroll
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

function setState(patch: Partial<BarState>, save = true) {
  state = { ...state, ...patch }
  if (save) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // private mode / quota — the choice just won't stick
    }
  }
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

/** The embed reports the widgets it chose; shown on the pills until the visitor picks. */
export function adoptShown(ids: Array<string>) {
  if (!state.customized && ids.join() !== state.active.join()) {
    setState({ active: ids }, false)
  }
}

export function useBar() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_STATE,
  )

  const toggle = useCallback((id: string) => {
    setState({
      customized: true,
      active: state.active.includes(id)
        ? state.active.filter((x) => x !== id)
        : state.active.concat(id),
    })
  }, [])
  const setTheme = useCallback((theme: string) => setState({ theme }), [])
  const setPos = useCallback((pos: BarState['pos']) => setState({ pos }), [])
  const setScroll = useCallback(
    (scroll: BarState['scroll']) => setState({ scroll }),
    [],
  )

  return { ...snapshot, toggle, setTheme, setPos, setScroll }
}
