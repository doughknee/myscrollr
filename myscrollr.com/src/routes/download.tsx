import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  Apple,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Monitor,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { LinuxFormat } from '@/lib/getDownloadInfo'
import { seo } from '@/lib/seo'
import { breadcrumbs, softwareApplication } from '@/lib/structured-data'
import { DownloadButton } from '@/components/DownloadButton'
import { ProductScreenshot } from '@/components/ProductScreenshot'
import { detectIsIntelMac, detectPlatform } from '@/lib/detectPlatform'
import { triggerDownload } from '@/lib/getDownloadInfo'

export const Route = createFileRoute('/download')({
  head: () =>
    seo({
      title: 'Download Scrollr — Free Desktop App',
      description:
        'Download Scrollr for macOS, Windows, or Linux. A quiet ticker at the edge of your screen with live sports, markets, news, and fantasy data. Free and open source.',
      path: '/download',
      image: 'https://myscrollr.com/og/download.png',
      jsonLd: [
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

const REPO = 'https://github.com/brandon-relentnet/myscrollr'

const EASE = [0.22, 1, 0.36, 1] as const

type PlatformId = 'macos' | 'windows' | 'linux'

type Platform = {
  id: PlatformId
  name: string
  arch: string
  icon: React.ReactNode
  requirements: Array<string>
  note?: string
}

const LINUX_FORMATS: ReadonlyArray<{
  format: LinuxFormat
  label: string
  hint: string
}> = [
  { format: 'appimage', label: 'AppImage', hint: 'Universal · most distros' },
  { format: 'deb', label: '.deb', hint: 'Debian / Ubuntu' },
  { format: 'rpm', label: '.rpm', hint: 'Fedora / RHEL / openSUSE' },
] as const

const PLATFORMS: Array<Platform> = [
  {
    id: 'macos',
    name: 'macOS',
    arch: 'Apple Silicon (arm64)',
    icon: <Apple className="h-6 w-6" />,
    requirements: ['macOS 11 Big Sur or later', 'Apple Silicon (M1/M2/M3/M4)'],
    note: 'Intel Macs are not currently supported.',
  },
  {
    id: 'windows',
    name: 'Windows',
    arch: 'x64',
    icon: <Monitor className="h-6 w-6" />,
    requirements: ['Windows 10 (1803) or later', '64-bit processor'],
  },
  {
    id: 'linux',
    name: 'Linux',
    arch: 'x64',
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.5 2c-1.7 0-3 2.3-3 5.2 0 1.5.3 2.8.8 3.9-.8.4-1.5.9-2 1.5C7 14 6.3 16.2 6.3 18.5c0 .3 0 .6.1.9-1 .4-1.7 1-1.7 1.7 0 .5.4.9 1 1.2.7.3 1.6.5 2.6.5 1.2 0 2.3-.3 3-.7.4.1.8.2 1.2.2s.8-.1 1.2-.2c.7.4 1.8.7 3 .7 1 0 1.9-.2 2.6-.5.6-.3 1-.7 1-1.2 0-.7-.7-1.3-1.7-1.7 0-.3.1-.6.1-.9 0-2.3-.7-4.5-2-5.9-.5-.6-1.2-1.1-2-1.5.5-1.1.8-2.4.8-3.9C15.5 4.3 14.2 2 12.5 2z" />
      </svg>
    ),
    requirements: ['Ubuntu 22.04+ or equivalent', '64-bit processor'],
    note: 'Choose AppImage, .deb, or .rpm to match your distro.',
  },
]

// ── OS detection ───────────────────────────────────────────────

function useDetectedPlatform(): PlatformId {
  const [detected, setDetected] = useState<PlatformId>('linux')
  useEffect(() => {
    setDetected(detectPlatform().platform)
  }, [])
  return detected
}

// ── Component ──────────────────────────────────────────────────

function DownloadPage() {
  const detected = useDetectedPlatform()
  const recommended = PLATFORMS.find((p) => p.id === detected) ?? PLATFORMS[0]

  return (
    <div className="min-h-screen bg-base-100">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="text-4xl font-bold tracking-tight text-base-content sm:text-5xl"
          >
            Download Scrollr
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-base-content/60"
          >
            A quiet ticker at the edge of your screen. Live scores, prices,
            headlines, and fantasy data. Always visible, never in the way.
          </motion.p>

          {/* ── Recommended download ───────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
            className="mt-10 flex flex-col items-center gap-3"
          >
            <DownloadButton />
            <p className="text-sm text-base-content/40">
              {recommended.arch} &middot; Free &middot; Open source
            </p>
          </motion.div>

          {/* ── What you'll see ────────────────────────────────
              A real screenshot of the desktop ticker so people see what
              they're about to install before they install it. Reduces
              post-download "wait, what is this?" bounces. */}
          <motion.figure
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
            className="relative mx-auto mt-16 max-w-4xl"
          >
            <div
              aria-hidden="true"
              className="absolute -inset-8 rounded-[2rem] bg-primary/5 blur-3xl pointer-events-none"
            />
            <div className="relative overflow-hidden rounded-2xl border border-base-300/40 bg-base-200/40 backdrop-blur-sm shadow-2xl">
              <ProductScreenshot
                basename="overview/home"
                alt="The Scrollr home dashboard showing live channel feeds for scores, prices, and headlines side-by-side."
                priority
                pictureClassName="block w-full"
                imgClassName="block h-full w-full object-cover object-top"
              />
            </div>
            <figcaption className="mt-4 text-center text-xs text-base-content/45">
              The Scrollr dashboard after first launch, with sample channels
              enabled.
            </figcaption>
          </motion.figure>
        </div>
      </section>

      {/* ── All platforms ────────────────────────────────────── */}
      <section className="border-t border-base-content/5 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-2xl font-bold text-base-content sm:text-3xl">
            All Platforms
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-base-content/50">
            Scrollr runs natively on macOS, Windows, and Linux. Pick your
            platform below.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {PLATFORMS.map((platform, i) => (
              <PlatformCard
                key={platform.id}
                platform={platform}
                detected={detected}
                index={i}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Details ──────────────────────────────────────────── */}
      <section className="border-t border-base-content/5 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid gap-12 sm:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-base-content">
                What you get
              </h3>
              <ul className="mt-4 space-y-2.5">
                {[
                  'Real-time stock prices and crypto markets',
                  'Live sports scores across major leagues',
                  'RSS news feeds from your favorite sources',
                  'Yahoo Fantasy Sports league tracking',
                  'Automatic updates so you always have the latest version',
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-base-content/60"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary/50" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-base-content">
                Privacy first
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-base-content/60">
                Scrollr stores your preferences locally on your device. No
                browsing data, no analytics, no tracking. The app communicates
                only with Scrollr&rsquo;s API servers to deliver live data via
                Server-Sent Events.
              </p>
              <Link
                to="/legal"
                search={{ doc: 'privacy' }}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
              >
                Read our privacy policy
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── GitHub CTA ───────────────────────────────────────── */}
      <section className="border-t border-base-content/5 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <p className="text-sm text-base-content/40">
            Scrollr is open source under the AGPL-3.0 license.
          </p>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-base-content/50 transition-colors hover:text-base-content/70"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View on GitHub
          </a>
        </div>
      </section>
    </div>
  )
}

// ── PlatformCard ────────────────────────────────────────────────

interface PlatformCardProps {
  platform: Platform
  detected: PlatformId
  index: number
}

function PlatformCard({ platform, detected, index }: PlatformCardProps) {
  const [linuxOpen, setLinuxOpen] = useState(false)
  const [showIntelWarning, setShowIntelWarning] = useState(false)

  // Intel-Mac warning is silent until we get a confident answer.
  useEffect(() => {
    if (platform.id !== 'macos') return
    let cancelled = false
    detectIsIntelMac().then((isIntel) => {
      if (!cancelled) setShowIntelWarning(isIntel)
    })
    return () => {
      cancelled = true
    }
  }, [platform.id])

  const handleDownload = useCallback(
    (linuxFormat?: LinuxFormat) => {
      setLinuxOpen(false)
      triggerDownload(platform.id, linuxFormat)
    },
    [platform.id],
  )

  const isLinux = platform.id === 'linux'
  const isRecommended = platform.id === detected

  return (
    <motion.div
      // The platform grid is above the fold on every viewport we care
      // about, so use `animate` instead of `whileInView`. With
      // `whileInView`, Motion mounts with the initial state (opacity 0),
      // then runs an intersection-observer check on the next tick —
      // that one-frame gap is what produced the visible flash.
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: EASE,
        delay: index * 0.1,
      }}
      className={`group relative flex flex-col rounded-2xl border p-6 transition-all duration-200 hover:shadow-lg ${
        isRecommended
          ? 'border-primary/30 bg-primary/5'
          : 'border-base-content/10 bg-base-200/30 hover:border-base-content/20'
      }`}
    >
      {isRecommended ? (
        <span className="absolute -top-3 right-4 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-content!">
          Recommended
        </span>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-base-content/5 text-base-content/60">
          {platform.icon}
        </div>
        <div>
          <h3 className="font-semibold text-base-content">{platform.name}</h3>
          <p className="text-sm text-base-content/40">{platform.arch}</p>
        </div>
      </div>

      <ul className="mt-4 flex-1 space-y-1.5">
        {platform.requirements.map((req) => (
          <li
            key={req}
            className="flex items-start gap-2 text-sm text-base-content/50"
          >
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
            {req}
          </li>
        ))}
      </ul>

      {platform.note ? (
        <p className="mt-3 text-xs text-base-content/35 italic">
          {platform.note}
        </p>
      ) : null}

      {showIntelWarning && platform.id === 'macos' ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-xs text-warning">
          Looks like you&rsquo;re on an Intel Mac. The download will not run on
          your machine.
        </p>
      ) : null}

      {isLinux ? (
        <div className="relative mt-4">
          <div className="flex">
            <button
              type="button"
              onClick={() => handleDownload('appimage')}
              className="flex flex-1 cursor-pointer items-center gap-2 rounded-l-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              AppImage
            </button>
            <button
              type="button"
              onClick={() => setLinuxOpen((o) => !o)}
              aria-label="Choose Linux package format"
              aria-expanded={linuxOpen}
              aria-haspopup="menu"
              className="cursor-pointer rounded-r-lg border-l border-primary/15 bg-primary/10 px-2.5 text-primary transition-colors hover:bg-primary/15"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${linuxOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>

          <AnimatePresence>
            {linuxOpen ? (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                role="menu"
                className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xl"
              >
                {LINUX_FORMATS.map(({ format, label, hint }) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => handleDownload(format)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-base-200"
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
      ) : (
        <button
          type="button"
          onClick={() => handleDownload()}
          className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download for {platform.name}
        </button>
      )}
    </motion.div>
  )
}
