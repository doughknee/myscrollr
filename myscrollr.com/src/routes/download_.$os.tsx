import { createFileRoute, notFound } from '@tanstack/react-router'
import { DownloadPage } from '@/routes/download'
import { seo } from '@/lib/seo'
import {
  breadcrumbs,
  organization,
  softwareApplication,
} from '@/lib/structured-data'

// ── Per-OS deep links ────────────────────────────────────────────
//
// `/download/mac`, `/download/windows`, `/download/linux` are share-
// friendly URLs that pre-select the platform on the existing download
// page. The main `/download` route keeps auto-detection. These three
// give us deterministic SEO (each gets its own <title>, description,
// breadcrumb) and let ads/social posts target a specific OS.

type Os = 'mac' | 'windows' | 'linux'
type Platform = 'macos' | 'windows' | 'linux'

const OS_TO_PLATFORM: Record<Os, Platform> = {
  mac: 'macos',
  windows: 'windows',
  linux: 'linux',
}

const META: Record<
  Os,
  { os: string; title: string; description: string; arch: string }
> = {
  mac: {
    os: 'macOS',
    title: 'Download Scrollr for macOS',
    description:
      'Free download of Scrollr for macOS (Apple Silicon). A quiet desktop ticker for live finance, sports, news, and fantasy data. Open source.',
    arch: 'Apple Silicon',
  },
  windows: {
    os: 'Windows',
    title: 'Download Scrollr for Windows',
    description:
      'Free download of Scrollr for Windows 10/11 (x64). A quiet desktop ticker for live finance, sports, news, and fantasy data. Open source.',
    arch: 'x64',
  },
  linux: {
    os: 'Linux',
    title: 'Download Scrollr for Linux',
    description:
      'Free download of Scrollr for Linux (x64). Available as AppImage, .deb, and .rpm. A quiet desktop ticker for live finance, sports, news, and fantasy data.',
    arch: 'x64',
  },
}

function isValidOs(value: string): value is Os {
  return value === 'mac' || value === 'windows' || value === 'linux'
}

export const Route = createFileRoute('/download_/$os')({
  beforeLoad: ({ params }) => {
    if (!isValidOs(params.os)) {
      throw notFound()
    }
  },
  head: ({ params }) => {
    if (!isValidOs(params.os)) {
      // beforeLoad will throw notFound before the page renders, but
      // head() may still be invoked during link discovery. Fall back
      // to a generic SEO payload so the build doesn't crash.
      return seo({
        title: 'Download Scrollr',
        description: 'Free download of Scrollr for desktop.',
        path: `/download/${params.os}`,
        noindex: true,
      })
    }
    const m = META[params.os]
    return seo({
      title: m.title,
      description: m.description,
      path: `/download/${params.os}`,
      image: 'https://myscrollr.com/og/download.png',
      jsonLd: [
        organization,
        softwareApplication,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Download', path: '/download' },
          { name: m.os, path: `/download/${params.os}` },
        ]),
      ],
    })
  },
  component: PerOsDownloadPage,
})

function PerOsDownloadPage() {
  const { os } = Route.useParams()
  if (!isValidOs(os)) return null
  return <DownloadPage forcedPlatform={OS_TO_PLATFORM[os]} />
}
