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
// already visible on /channels. The `offers` array reflects the live
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
 * Homepage FAQ items — kept in lockstep with the 8 questions in
 * `components/landing/FAQSection.tsx`. Answers MUST match the rendered
 * `answer` text exactly, per Google's FAQPage rich-result policy:
 * https://developers.google.com/search/docs/appearance/structured-data/faqpage
 *
 * When you change a FAQSection answer, change the matching entry here
 * (and vice versa). The shape diverges from FAQSection.FAQItem because
 * the section adds visual fields (icon, highlight, accent) that don't
 * belong in JSON-LD.
 */
export const HOMEPAGE_FAQ_ITEMS: ReadonlyArray<{
  question: string
  answer: string
}> = [
  {
    question: 'Is Scrollr free?',
    answer:
      'The free tier streams real-time data with no ads or tracking. Uplink plans unlock more widgets at once, priority support, and power-user tools like custom alerts and integrations. The entire codebase is open source under the AGPL-3.0 license.',
  },
  {
    question: 'Does it affect performance?',
    answer:
      'Not noticeably. All data flows through a single connection in the background. The ticker overlay is hardware-accelerated with minimal CPU and memory usage, and it never interferes with your other applications.',
  },
  {
    question: 'Is my data private?',
    answer:
      'Scrollr contains zero analytics, zero tracking pixels, and zero telemetry. Your preferences are stored locally on your device and never transmitted anywhere. The only network requests go to the Scrollr API to fetch your feed data.',
  },
  {
    question: 'What platforms are supported?',
    answer:
      'Scrollr runs natively on macOS (Apple Silicon), Windows (x64), and Linux (x64). Download the app for your platform from our download page.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'A free Scrollr account is required to stream live widget data. Signing up takes under a minute, secures your config via our hosted auth, and unlocks the widget catalog (sports, stocks, crypto, news, and fantasy), the web dashboard, and preference sync across devices.',
  },
  {
    question: 'What data does Scrollr show?',
    answer:
      'A catalog of 30+ widgets: real-time stock and crypto prices, live scores from 14 sports leagues, curated news outlets plus custom RSS, and Yahoo Fantasy league updates including standings and matchups.',
  },
  {
    question: 'Can I customize the feed?',
    answer:
      'Position the ticker at the top or bottom of your screen, drag to resize, switch between comfort and compact modes, choose overlay or push behavior, and pick which widgets appear in the ticker.',
  },
  {
    question: 'Is Scrollr open source?',
    answer:
      'Every component, from the desktop application and web dashboard to the API and integration services, is publicly available on GitHub under the GNU Affero General Public License v3.0. You can inspect, fork, or contribute to any part of it.',
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
