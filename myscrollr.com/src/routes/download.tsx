import { createFileRoute } from '@tanstack/react-router'
import { DownloadPage } from '@/components/download/DownloadPage'
import { seo } from '@/lib/seo'
import { organization, softwareApplication } from '@/lib/structured-data'

export const Route = createFileRoute('/download')({
  head: () =>
    seo({
      title: 'Download Scrollr for macOS, Windows, Linux',
      description:
        'Free download of Scrollr, the quiet desktop ticker for live finance, sports, and news data. Native builds for macOS, Windows, and Linux.',
      path: '/download',
      image: 'https://myscrollr.com/og/download.png',
      jsonLd: [organization, softwareApplication],
    }),
  component: DownloadPage,
})
