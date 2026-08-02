/**
 * Landing hero — terminal editorial (Marketing - Redesign v2 mockup).
 * Static two-line headline (no typewriter), OS-aware download CTA via
 * detectPlatform + triggerDownload, and the hero note pointing at the
 * persistent demo bar mounted by __root.tsx.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { PlatformInfo } from '@/lib/detectPlatform'
import { PageHeader } from '@/components/terminal'
import { detectPlatform } from '@/lib/detectPlatform'
import { triggerDownload } from '@/lib/getDownloadInfo'

export function TerminalHero() {
  return (
    <PageHeader
      size="lg"
      eyebrowLeft="／／ LIVE DESKTOP TICKER"
      eyebrowRight="FREE · OPEN SOURCE · MACOS / WINDOWS / LINUX"
      line1="The moment it happens,"
      line2="you already know."
      sub={
        "The go-ahead run, the market swing, the breaking story, your fantasy comeback — live in a quiet bar above whatever you're working on. No checking, no feeds, no finding out late."
      }
      actions={<HeroActions />}
    />
  )
}

function HeroActions() {
  const navigate = useNavigate()
  // SSR + first client render use the generic label; the real platform
  // resolves in the mount effect (same hydration-safety pattern as
  // DownloadButton — see that file for the React #418 rationale).
  const [info, setInfo] = useState<PlatformInfo | null>(null)

  useEffect(() => {
    setInfo(detectPlatform())
  }, [])

  const label =
    info && !info.isMobile ? `Download for ${info.label}` : 'Download Scrollr'

  const handleDownload = () => {
    const p = info ?? detectPlatform()
    if (p.isMobile) {
      // Phones can't install a desktop app — send them to the download
      // page, which explains and lists all three platforms.
      navigate({ to: '/download' })
    } else {
      triggerDownload(p.platform)
    }
  }

  return (
    <div className="flex flex-col items-start gap-4 sm:items-end">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownload}
          className="relative cursor-pointer rounded-[4px] bg-primary px-8 py-4 font-bold text-primary-content shadow-[0_0_60px_rgba(52,211,153,.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        >
          {label}
          {/* Corner sticker — dark ink chip with the accent text, the
              inverse of the button (same pairing as the bar chips). */}
          <span className="absolute -right-2.5 -top-2.5 rotate-[7deg] rounded-[3px] bg-[#101018] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-primary shadow-[0_2px_8px_rgba(0,0,0,.35)]">
            FREE
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            // Smooth unless the user prefers reduced motion — the global
            // reduced-motion CSS forces scroll-behavior: auto.
            document
              .getElementById('catalog')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
          className="cursor-pointer rounded-[4px] border border-base-content/25 px-[26px] py-4 font-semibold text-base-content transition-colors duration-150 hover:border-primary hover:text-base-content"
        >
          See the widgets ↓
        </button>
      </div>
      <div className="text-left font-mono text-xs leading-[1.7] text-base-content/45 sm:text-right">
        {'the ticker is already running at the bottom of this page ↓'}
        <br />
        {"that's the app — it stays on top of everything, including this site"}
      </div>
    </div>
  )
}
