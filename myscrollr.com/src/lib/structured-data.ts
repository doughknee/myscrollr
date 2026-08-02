/**
 * JSON-LD structured data templates.
 *
 * These objects are serialized as <script type="application/ld+json"> tags
 * and read by search engines (Google rich results) and AI crawlers.
 *
 * Test with: https://search.google.com/test/rich-results
 */

import { BASE_URL } from '@/lib/seo'

declare const __APP_VERSION__: string

export const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Scrollr',
  url: BASE_URL,
  logo: `${BASE_URL}/icon-128.png`,
  description:
    'Scrollr is a quiet desktop ticker for live finance, sports, news, and fantasy data. Open source and privacy-first.',
  sameAs: [
    'https://github.com/brandon-relentnet/myscrollr',
    'https://discord.gg/85b49TcGJa',
  ],
}

export const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Scrollr',
  url: BASE_URL,
}

// SoftwareApplication: describes the Scrollr desktop app for rich-result
// surfaces (Google "App" cards, AI crawlers). `screenshot` references the
// channel hero screenshots that ship in /public/screenshots/ and are
// already visible on /widgets. The `offers` array reflects the live
// pricing tiers from /uplink (Free + the three paid Uplink tiers); keep
// in sync with PRICING in routes/uplink.tsx.
export const softwareApplication = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Scrollr',
  operatingSystem: ['macOS', 'Windows', 'Linux'],
  applicationCategory: 'DesktopApplication',
  description:
    'A quiet desktop ticker for live finance, sports, news, and fantasy data. Open source and privacy-first.',
  url: BASE_URL,
  downloadUrl: `${BASE_URL}/download`,
  softwareVersion: __APP_VERSION__,
  publisher: { '@type': 'Organization', name: 'Scrollr', url: BASE_URL },
  author: { '@type': 'Organization', name: 'Scrollr', url: BASE_URL },
  screenshot: [
    `${BASE_URL}/screenshots/channels/finance-dark@2x.webp`,
    `${BASE_URL}/screenshots/channels/sports-dark@2x.webp`,
    `${BASE_URL}/screenshots/channels/news-dark@2x.webp`,
    `${BASE_URL}/screenshots/channels/fantasy-dark@2x.webp`,
  ],
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      url: `${BASE_URL}/download`,
    },
    {
      '@type': 'Offer',
      name: 'Uplink',
      price: '9.99',
      priceCurrency: 'USD',
      url: `${BASE_URL}/uplink`,
    },
    {
      '@type': 'Offer',
      name: 'Uplink Pro',
      price: '24.99',
      priceCurrency: 'USD',
      url: `${BASE_URL}/uplink`,
    },
    {
      '@type': 'Offer',
      name: 'Uplink Ultimate',
      price: '49.99',
      priceCurrency: 'USD',
      url: `${BASE_URL}/uplink`,
    },
  ],
}

type Tier = {
  name: string
  description: string
  priceMonthly: number
  priceAnnual: number
}

export function productOffers(tiers: Array<Tier>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Scrollr Uplink',
    description:
      'Premium subscription tiers for the Scrollr desktop app: more widgets at once, priority support, and early access to new widgets.',
    brand: { '@type': 'Brand', name: 'Scrollr' },
    offers: tiers.flatMap((t) => [
      {
        '@type': 'Offer',
        name: `${t.name} (Monthly)`,
        description: t.description,
        price: t.priceMonthly.toFixed(2),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: t.priceMonthly.toFixed(2),
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: `${BASE_URL}/uplink`,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: `${t.name} (Annual)`,
        description: t.description,
        price: t.priceAnnual.toFixed(2),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: t.priceAnnual.toFixed(2),
          priceCurrency: 'USD',
          unitText: 'YEAR',
        },
        url: `${BASE_URL}/uplink`,
        availability: 'https://schema.org/InStock',
      },
    ]),
  }
}

type FaqEntry = { question: string; answer: string }

export function faqPage(items: ReadonlyArray<FaqEntry>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  }
}

/**
 * Homepage FAQ items — the 4 "Quick answers" on the landing page.
 * `components/landing/QuickAnswers.tsx` renders these objects directly,
 * so the visible FAQ and the `faqPage` JSON-LD can never drift. Answers
 * are plain text per Google's FAQPage rich-result policy:
 * https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */
export const HOMEPAGE_FAQ_ITEMS: ReadonlyArray<{
  question: string
  answer: string
}> = [
  {
    question: 'Is it really free?',
    answer:
      'Yes. Three widget slots, forever, no account. Uplink exists if you outgrow them — most people don’t.',
  },
  {
    question: 'Will it slow my computer down?',
    answer:
      'No. Scrollr is a small native app (Tauri), not a browser in disguise. It sips memory and idles quietly.',
  },
  {
    question: 'What does Scrollr collect about me?',
    answer:
      'Nothing. Zero telemetry is a shipped promise, enforced by tests that block deploys — and the source is public.',
  },
  {
    question: 'Which platforms?',
    answer: 'macOS, Windows, and Linux. Multi-monitor aware on all three.',
  },
] as const

type BreadcrumbItem = { name: string; path: string }

export function breadcrumbs(items: Array<BreadcrumbItem>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${BASE_URL}${item.path}`,
    })),
  }
}
