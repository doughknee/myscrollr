/**
 * The app's real ticker, live (SCROLLR-310): an iframe of /bar/, the
 * desktop's ticker bundle built for the web (desktop/embed.html), fed by
 * api.myscrollr.com/public/feed. Replaces the site's own demo bar.
 *
 * The prerender ships the static PNG (`make marketing` shoots it from the
 * same build); the iframe mounts after hydration and fades in when the bar
 * reports it has drawn with data. Its report also says which widgets it
 * chose, which the catalog pills show until the visitor picks their own.
 */

import { useEffect, useRef, useState } from 'react'
import { adoptShown } from '@/hooks/useBar'

export interface LiveBarProps {
  /** Catalog ids; omitted = the bar's own default (games tonight + starter). */
  widgets?: Array<string>
  /** `<family>-<light|dark>`, e.g. `nord-light`. */
  theme: string
  mode?: 'pages' | 'continuous'
  keypad?: boolean
  height?: number
  /** Below the fold: let the browser defer the frame. */
  lazy?: boolean
}

export function barSrc({
  widgets,
  theme,
  mode = 'pages',
  keypad = true,
}: Omit<LiveBarProps, 'height' | 'lazy'>): string {
  const q = new URLSearchParams()
  if (widgets) q.set('widgets', widgets.join(','))
  q.set('theme', theme)
  if (mode !== 'pages') q.set('mode', mode)
  if (!keypad) q.set('keypad', '0')
  return `/bar/?${q.toString()}`
}

export function LiveBar({ height = 64, lazy = false, ...bar }: LiveBarProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [mounted, setMounted] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Never inside a frame: a host without /bar/ falls back to a page
    // that would frame itself again (dev servers, the shell fallback).
    setMounted(window.self === window.top)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const data = e.data as { scrollrBar?: string; widgets?: unknown }
      if (data.scrollrBar !== 'ready') return
      setReady(true)
      if (Array.isArray(data.widgets)) {
        adoptShown(data.widgets.filter((w) => typeof w === 'string'))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const mode = bar.theme.endsWith('-light') ? 'light' : 'dark'
  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <img
        src={`/marketing/bar-${mode}.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-left"
      />
      {mounted && (
        <iframe
          ref={frame}
          title="Scrollr ticker, live"
          src={barSrc(bar)}
          loading={lazy ? 'lazy' : 'eager'}
          className={`absolute inset-0 h-full w-full border-0 transition-opacity duration-300 ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
