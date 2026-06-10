import { describe, expect, it } from 'vitest'
import { BASE_URL, seo } from './seo'

const BASE_INPUT = {
  title: 'Test Page — Scrollr',
  description: 'A test page.',
  path: '/test',
}

function metaByKey(head: ReturnType<typeof seo>) {
  const byName = new Map<string, string>()
  const byProperty = new Map<string, string>()
  let title = ''
  for (const tag of head.meta) {
    if ('title' in tag) title = tag.title
    else if ('name' in tag) byName.set(tag.name, tag.content)
    else byProperty.set(tag.property, tag.content)
  }
  return { title, byName, byProperty }
}

describe('seo', () => {
  it('emits title, description, OG, and Twitter tags from one input', () => {
    const { title, byName, byProperty } = metaByKey(seo(BASE_INPUT))
    expect(title).toBe(BASE_INPUT.title)
    expect(byName.get('description')).toBe(BASE_INPUT.description)
    expect(byProperty.get('og:title')).toBe(BASE_INPUT.title)
    expect(byProperty.get('og:url')).toBe(`${BASE_URL}/test`)
    expect(byProperty.get('og:type')).toBe('website')
    expect(byName.get('twitter:card')).toBe('summary_large_image')
    expect(byName.get('twitter:title')).toBe(BASE_INPUT.title)
  })

  it('always emits a canonical link for the absolute URL', () => {
    const head = seo(BASE_INPUT)
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: `${BASE_URL}/test`,
    })
  })

  it('falls back to the default OG image and alt text', () => {
    const { byProperty } = metaByKey(seo(BASE_INPUT))
    expect(byProperty.get('og:image')).toBe(`${BASE_URL}/og/default.png`)
    expect(byProperty.get('og:image:alt')).toBeTruthy()
  })

  it('uses a custom image when provided', () => {
    const { byProperty } = metaByKey(
      seo({ ...BASE_INPUT, image: `${BASE_URL}/og/custom.png` }),
    )
    expect(byProperty.get('og:image')).toBe(`${BASE_URL}/og/custom.png`)
  })

  it('omits robots meta by default and adds noindex on request', () => {
    expect(metaByKey(seo(BASE_INPUT)).byName.has('robots')).toBe(false)
    expect(
      metaByKey(seo({ ...BASE_INPUT, noindex: true })).byName.get('robots'),
    ).toBe('noindex, nofollow')
  })

  it('serializes JSON-LD into ld+json script tags', () => {
    const jsonLd = { '@type': 'Product', name: 'Scrollr' }
    const head = seo({ ...BASE_INPUT, jsonLd })
    expect(head.scripts).toHaveLength(1)
    expect(head.scripts![0].type).toBe('application/ld+json')
    expect(JSON.parse(head.scripts![0].children)).toEqual(jsonLd)
  })

  it('accepts an array of JSON-LD payloads', () => {
    const head = seo({
      ...BASE_INPUT,
      jsonLd: [{ '@type': 'Product' }, { '@type': 'FAQPage' }],
    })
    expect(head.scripts).toHaveLength(2)
  })

  it('omits scripts entirely when there is no JSON-LD', () => {
    // TanStack Start serializes `scripts: []` differently from absent —
    // the function contract is undefined-when-empty.
    expect(seo(BASE_INPUT).scripts).toBeUndefined()
  })

  it('appends extraLinks after the canonical', () => {
    const preload = {
      rel: 'preload',
      as: 'image',
      imagesrcset: '/a.webp 1x',
      fetchpriority: 'high' as const,
    }
    const head = seo({ ...BASE_INPUT, extraLinks: [preload] })
    expect(head.links[0].rel).toBe('canonical')
    expect(head.links).toContainEqual(preload)
  })
})
