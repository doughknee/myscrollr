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

const GITHUB_URL = 'https://github.com/brandon-relentnet/myscrollr'

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
    info && !info.isMobile
      ? `Download for ${info.label} — free`
      : 'Download Scrollr — free'

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
          className="cursor-pointer rounded-[4px] bg-primary px-8 py-4 font-bold text-primary-content shadow-[0_0_60px_rgba(52,211,153,.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        >
          {label}
        </button>
        <a
          href={GITHUB_URL}
          rel="noopener noreferrer"
          className="rounded-[4px] border border-base-content/25 px-[26px] py-4 font-semibold text-base-content transition-colors duration-150 hover:border-primary hover:text-base-content"
        >
          Source ↗
        </a>
      </div>
      <div className="text-left font-mono text-xs leading-[1.7] text-base-content/45 sm:text-right">
        {'the ticker is already running at the bottom of this page ↓'}
        <br />
        {"that's the app — it stays on top of everything, including this site"}
      </div>
    </div>
  )
}
