import { useCallback, useEffect, useRef, useState } from 'react'
import { Apple, ChevronDown, Download, Monitor } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { LinuxFormat } from '@/lib/getDownloadInfo'
import type { PlatformInfo } from '@/lib/detectPlatform'
import { detectIsIntelMac, detectPlatform } from '@/lib/detectPlatform'
import { FALLBACK_RELEASES_URL, triggerDownload } from '@/lib/getDownloadInfo'

const LINUX_FORMATS: ReadonlyArray<{
  format: LinuxFormat
  label: string
  hint: string
}> = [
  {
    format: 'appimage',
    label: 'AppImage',
    hint: 'Universal · runs on most distros',
  },
  { format: 'deb', label: '.deb', hint: 'Debian / Ubuntu' },
  { format: 'rpm', label: '.rpm', hint: 'Fedora / RHEL / openSUSE' },
] as const

/**
 * Primary "Download Scrollr" CTA used in the Hero, How It Works, and
 * Call To Action sections. Replaces the previous static GitHub-releases
 * link with a click-to-download flow that uses a build-time-resolved
 * version (see `lib/getDownloadInfo.ts` for the rationale) to point
 * the browser straight at the right Tauri-built asset.
 *
 * Behavior breakdown:
 *
 * - **macOS**: single button. If we can confirm Intel architecture
 *   asynchronously, an inline warning surfaces ABOVE the button before
 *   the download is initiated.
 * - **Windows**: single button.
 * - **Linux**: button + dropdown for `.AppImage` / `.deb` / `.rpm`.
 * - **Mobile (iOS / Android / etc.)**: replaces the single CTA with a
 *   stacked card listing all three desktop platforms plus a "switch
 *   to desktop to install" subtitle.
 *
 * Synchronous click semantics: because the version is baked in at
 * build time, the click handler navigates directly to the asset URL
 * inside the user-gesture event without any awaitable network call.
 * No loading state, no timeout, no in-page fallback needed.
 */
export function DownloadButton() {
  const [info, setInfo] = useState<PlatformInfo>(() => detectPlatform())
  const [isIntelMac, setIsIntelMac] = useState(false)

  // Re-detect on mount because the component initially renders with
  // SSR-safe defaults; once we have a real `navigator` the picture
  // can change (specifically: mobile detection).
  useEffect(() => {
    setInfo(detectPlatform())
  }, [])

  // Architecture detection is async and only resolves on Chromium browsers.
  // Silent best-effort: if we can confirm Intel, we warn; otherwise we say nothing.
  useEffect(() => {
    if (info.platform !== 'macos') return
    let cancelled = false
    detectIsIntelMac().then((isIntel) => {
      if (!cancelled) setIsIntelMac(isIntel)
    })
    return () => {
      cancelled = true
    }
  }, [info.platform])

  if (info.isMobile) {
    return <MobilePlatformPicker />
  }

  if (info.platform === 'linux') {
    return <LinuxDownloadButton />
  }

  return (
    <div className="flex flex-col gap-2">
      {info.platform === 'macos' && isIntelMac ? <IntelMacWarning /> : null}
      <SingleDownloadButton platform={info.platform} label={info.label} />
    </div>
  )
}

// ── Single-platform button (macOS / Windows) ─────────────────────

interface SingleDownloadButtonProps {
  platform: 'macos' | 'windows'
  label: string
}

function SingleDownloadButton({ platform, label }: SingleDownloadButtonProps) {
  const handleClick = useCallback(() => {
    triggerDownload(platform)
  }, [platform])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Download Scrollr for ${label}`}
      className="group relative inline-flex cursor-pointer items-center gap-3 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-content! shadow-lg transition-all duration-200 hover:brightness-110 hover:shadow-xl active:scale-[0.98]"
    >
      <Download
        className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5"
        aria-hidden="true"
      />
      Download for {label}
    </button>
  )
}

// ── Linux button + format dropdown ───────────────────────────────

function LinuxDownloadButton() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Click-outside + escape close
  useEffect(() => {
    if (!open) return

    const handlePointer = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const handleSelect = useCallback((format: LinuxFormat) => {
    setOpen(false)
    triggerDownload('linux', format)
  }, [])

  // Default click on the main button surface uses the AppImage variant.
  const handleDefaultClick = useCallback(() => {
    handleSelect('appimage')
  }, [handleSelect])

  return (
    <div ref={containerRef} className="relative inline-flex">
      <div className="inline-flex rounded-full bg-primary text-primary-content! shadow-lg transition-shadow hover:shadow-xl">
        <button
          type="button"
          onClick={handleDefaultClick}
          aria-label="Download Scrollr AppImage for Linux"
          className="group inline-flex cursor-pointer items-center gap-3 rounded-l-full pl-7 pr-4 py-3.5 text-sm font-semibold transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
        >
          <Download
            className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
          Download for Linux
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose Linux package format"
          aria-expanded={open}
          aria-haspopup="menu"
          className="cursor-pointer rounded-r-full border-l border-primary-content/15 px-3 py-3.5 transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            role="menu"
            className="absolute left-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
          >
            {LINUX_FORMATS.map(({ format, label, hint }) => (
              <button
                key={format}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(format)}
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-base-200"
              >
                <span className="text-sm font-semibold text-base-content">
                  {label}
                </span>
                <span className="text-xs text-base-content/50">{hint}</span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// ── Intel Mac warning ────────────────────────────────────────────

function IntelMacWarning() {
  return (
    <div className="flex max-w-md items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
      <span aria-hidden="true">⚠</span>
      <span>
        Apple Silicon only. Scrollr does not run on Intel Macs yet. The download
        will not launch on your machine.
      </span>
    </div>
  )
}

// ── Mobile platform picker ───────────────────────────────────────

const MOBILE_PLATFORMS: ReadonlyArray<{
  id: 'macos' | 'windows' | 'linux'
  label: string
  icon: React.ReactNode
}> = [
  { id: 'macos', label: 'macOS', icon: <Apple className="h-5 w-5" /> },
  { id: 'windows', label: 'Windows', icon: <Monitor className="h-5 w-5" /> },
  {
    id: 'linux',
    label: 'Linux',
    icon: (
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12.5 2c-1.7 0-3 2.3-3 5.2 0 1.5.3 2.8.8 3.9-.8.4-1.5.9-2 1.5C7 14 6.3 16.2 6.3 18.5c0 .3 0 .6.1.9-1 .4-1.7 1-1.7 1.7 0 .5.4.9 1 1.2.7.3 1.6.5 2.6.5 1.2 0 2.3-.3 3-.7.4.1.8.2 1.2.2s.8-.1 1.2-.2c.7.4 1.8.7 3 .7 1 0 1.9-.2 2.6-.5.6-.3 1-.7 1-1.2 0-.7-.7-1.3-1.7-1.7 0-.3.1-.6.1-.9 0-2.3-.7-4.5-2-5.9-.5-.6-1.2-1.1-2-1.5.5-1.1.8-2.4.8-3.9C15.5 4.3 14.2 2 12.5 2z" />
      </svg>
    ),
  },
] as const

function MobilePlatformPicker() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-base-content/60">
        Scrollr is a desktop app. Visit this page on macOS, Windows, or Linux to
        download.
      </p>
      <div className="flex flex-col gap-2">
        {MOBILE_PLATFORMS.map((p) => (
          <a
            key={p.id}
            href={FALLBACK_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-200/40 px-4 py-3 text-sm font-semibold text-base-content transition-all hover:border-primary/30 hover:bg-base-200/80"
          >
            <span className="flex items-center gap-3">
              <span className="text-base-content/60 group-hover:text-primary">
                {p.icon}
              </span>
              {p.label}
            </span>
            <Download
              className="h-4 w-4 text-base-content/40 group-hover:text-primary"
              aria-hidden="true"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
