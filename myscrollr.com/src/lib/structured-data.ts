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
  sameAs: ['https://github.com/brandon-relentnet/myscrollr'],
}

export const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Scrollr',
  url: BASE_URL,
}

export const softwareApplication = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Scrollr',
  operatingSystem: 'macOS, Windows, Linux',
  applicationCategory: 'ProductivityApplication',
  description:
    'A quiet desktop ticker for live finance, sports, news, and fantasy data. Open source and privacy-first.',
  url: BASE_URL,
  downloadUrl: `${BASE_URL}/download`,
  softwareVersion: __APP_VERSION__,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
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
      'Premium subscription tiers for the Scrollr desktop app — unlimited tracking, real-time delivery, and early access to new channels.',
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

export function faqPage(items: Array<FaqEntry>) {
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
