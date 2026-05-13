type SeoInput = {
  title: string
  description: string
  path: string
  image?: string
  imageAlt?: string
  type?: 'website' | 'article' | 'product'
  noindex?: boolean
  jsonLd?: object | Array<object>
}

export const BASE_URL = 'https://myscrollr.com'

type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
type LinkTag = { rel: string; href: string; type?: string }
type ScriptTag = { type: string; children: string }

export type RouteHead = {
  meta: Array<MetaTag>
  links: Array<LinkTag>
  scripts?: Array<ScriptTag>
}

export function seo(input: SeoInput): RouteHead {
  const url = `${BASE_URL}${input.path}`
  const image = input.image ?? `${BASE_URL}/og/default.png`
  const imageAlt =
    input.imageAlt ?? 'Scrollr — a quiet ticker at the edge of your screen.'
  const type = input.type ?? 'website'

  const meta: Array<MetaTag> = [
    { title: input.title },
    { name: 'description', content: input.description },
    { property: 'og:title', content: input.title },
    { property: 'og:description', content: input.description },
    { property: 'og:url', content: url },
    { property: 'og:type', content: type },
    { property: 'og:site_name', content: 'Scrollr' },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: imageAlt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: input.title },
    { name: 'twitter:description', content: input.description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: imageAlt },
  ]

  if (input.noindex) {
    meta.push({ name: 'robots', content: 'noindex, nofollow' })
  }

  const links: Array<LinkTag> = [{ rel: 'canonical', href: url }]

  const scripts: Array<ScriptTag> = []
  if (input.jsonLd) {
    const payload = Array.isArray(input.jsonLd) ? input.jsonLd : [input.jsonLd]
    for (const item of payload) {
      scripts.push({
        type: 'application/ld+json',
        children: JSON.stringify(item),
      })
    }
  }

  return { meta, links, scripts: scripts.length ? scripts : undefined }
}
