import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { DesktopPlatform, LinuxFormat } from '@/lib/getDownloadInfo'
import { seo } from '@/lib/seo'
import {
  breadcrumbs,
  organization,
  softwareApplication,
} from '@/lib/structured-data'
import { LATEST_DESKTOP_VERSION } from '@/lib/latestVersion.generated'
import { detectPlatform } from '@/lib/detectPlatform'
import {
  FALLBACK_RELEASES_URL,
  getDownloadInfo,
  triggerDownload,
} from '@/lib/getDownloadInfo'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  StepsGrid,
  TerminalContainer,
} from '@/components/terminal'
import { EASE } from '@/lib/animations'

export const Route = createFileRoute('/download')({
  head: () =>
    seo({
      title: 'Download Scrollr for macOS, Windows, Linux',
      description:
        'Free download of Scrollr, the quiet desktop ticker for live finance, sports, news, and fantasy data. Native builds for macOS, Windows, and Linux.',
      path: '/download',
      image: 'https://myscrollr.com/og/download.png',
      jsonLd: [
        organization,
        softwareApplication,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Download', path: '/download' },
        ]),
      ],
    }),
  component: DownloadPage,
})

// ── Constants ──────────────────────────────────────────────────

const RELEASES_URL = 'https://github.com/brandon-relentnet/myscrollr/releases'

const CTA: Record<DesktopPlatform, string> = {
  macos: 'Download for macOS',
  windows: 'Download for Windows',
  linux: 'Download for Linux',
}

const ARCH_NOTE: Record<DesktopPlatform, string> = {
  macos: 'APPLE SILICON',
  windows: 'X64',
  linux: 'X86_64 · APPIMAGE',
}

const LINUX_FORMATS: ReadonlyArray<{ format: LinuxFormat; label: string }> = [
  { format: 'appimage', label: '.APPIMAGE' },
  { format: 'deb', label: '.DEB' },
  { format: 'rpm', label: '.RPM' },
]

const STEPS = [
  {
    num: '01',
    title: 'Install & open',
    body: 'No account wall, no onboarding tour. The bar appears with zero-setup starters already scrolling.',
  },
  {
    num: '02',
    title: 'Pick your widgets',
    body: 'Open the catalog, add your leagues, tickers, and feeds. Three run free, each in ten seconds.',
  },
  {
    num: '03',
    title: "Forget it's there",
    body: 'It pins above every window on any monitor. From now on, the news finds you.',
  },
]

const CTA_BUTTON_CLASS =
  'inline-flex cursor-pointer items-center gap-3 rounded-[4px] bg-primary px-[34px] py-[17px] text-[17px] font-bold text-[#101018] shadow-[0_0_60px_color-mix(in_srgb,var(--color-primary)_18%,transparent)] transition-colors hover:bg-[#6ee7b7]'

// ── OS detection ───────────────────────────────────────────────

/**
 * Detected (or forced) platform. `null` = no confident answer — SSR,
 * pre-hydration, or a mobile visitor — which renders the releases-page
 * fallback CTA. Per-OS deep links skip detection entirely so the page
 * is deterministic for crawlers.
 */
function useDetectedPlatform(forced?: DesktopPlatform): DesktopPlatform | null {
  const [detected, setDetected] = useState<DesktopPlatform | null>(
    forced ?? null,
  )
  useEffect(() => {
    if (forced) {
      setDetected(forced)
      return
    }
    const info = detectPlatform()
    setDetected(info.isMobile ? null : info.platform)
  }, [forced])
  return detected
}

// ── Component ──────────────────────────────────────────────────

export function DownloadPage({
  forcedPlatform,
}: { forcedPlatform?: DesktopPlatform } = {}) {
  const detected = useDetectedPlatform(forcedPlatform)
  const version = LATEST_DESKTOP_VERSION

  return (
    <div>
      <PageHeader
        eyebrowLeft={`DOWNLOAD ／ DESKTOP V${version}`}
        eyebrowRight="SERVED FROM GITHUB RELEASES · BUILT FROM PUBLIC SOURCE"
        line1="Get Scrollr."
        line2="Free. No sign-up."
        sub="One small native app. Three widgets free forever, no account between you and a running bar."
        actions={
          <div className="flex flex-col items-end gap-3">
            {detected ? (
              <button
                type="button"
                onClick={() => triggerDownload(detected)}
                className={CTA_BUTTON_CLASS}
              >
                {CTA[detected]} ↓
              </button>
            ) : (
              <a
                href={FALLBACK_RELEASES_URL}
                rel="noopener noreferrer"
                className={CTA_BUTTON_CLASS}
              >
                Download Scrollr ↓
              </a>
            )}
            <div className="text-right font-mono text-[11px] tracking-[0.06em] text-base-content/45">
              {detected
                ? [
                    getDownloadInfo(detected).filename,
                    getDownloadInfo(detected).size,
                    ARCH_NOTE[detected],
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : `PICK YOUR PLATFORM BELOW · V${version}`}
            </div>
          </div>
        }
      />

      {/* ── SEC 01 ／ EVERY PLATFORM ─────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 01 ／ EVERY PLATFORM" />
          {/* -mt-px collapses the first row's border-t into the
              SectionRow's border-b so hairlines never double. */}
          <div className="-mt-px pb-4">
            <DeparturesRow
              index="01"
              label="macOS"
              tag={detected === 'macos' ? 'YOURS' : undefined}
              meta={
                <span className="font-mono text-xs text-base-content/45">
                  {['.DMG', getDownloadInfo('macos').size, 'APPLE SILICON']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              }
              action="DOWNLOAD ↓"
              onClick={() => triggerDownload('macos')}
            />
            <DeparturesRow
              index="02"
              label="Windows"
              tag={detected === 'windows' ? 'YOURS' : undefined}
              meta={
                <span className="font-mono text-xs text-base-content/45">
                  {['SETUP .EXE', getDownloadInfo('windows').size, 'X64']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              }
              action="DOWNLOAD ↓"
              onClick={() => triggerDownload('windows')}
            />
            {/* Linux: three format actions, so not a single DeparturesRow. */}
            <div className="flex flex-wrap items-center justify-between gap-5 border-t border-hairline px-3 py-6">
              <span className="flex flex-wrap items-baseline gap-5">
                <span className="font-mono text-xs text-base-content/40">
                  ↳ 03
                </span>
                <span className="font-display text-2xl font-bold uppercase tracking-[0.01em]">
                  Linux
                </span>
                {detected === 'linux' && (
                  <span className="rounded-[3px] border border-primary/40 px-2 py-[3px] font-mono text-[10px] tracking-[0.12em] text-primary">
                    YOURS
                  </span>
                )}
                <span className="font-mono text-xs text-base-content/45">
                  X86_64
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {LINUX_FORMATS.map(({ format, label }) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => triggerDownload('linux', format)}
                    className="cursor-pointer whitespace-nowrap rounded-[4px] border border-hairline px-4 py-[9px] font-mono text-xs tracking-[0.08em] text-primary transition-colors hover:border-primary"
                  >
                    {label} ↓
                  </button>
                ))}
              </span>
            </div>
          </div>
        </TerminalContainer>
      </section>

      {/* ── SEC 02 ／ YOUR FIRST SIXTY SECONDS ───────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 02 ／ YOUR FIRST SIXTY SECONDS" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <StepsGrid steps={STEPS} />
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Release notes ────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
            className="-mt-px"
          >
            <DeparturesRow
              index="04"
              label="Release notes & older builds"
              labelClassName="text-xl"
              meta="Every build, changelog, and checksum lives on GitHub Releases."
              action={`DESKTOP-V${version} ↗`}
              href={RELEASES_URL}
            />
          </motion.div>
        </TerminalContainer>
      </section>
    </div>
  )
}
