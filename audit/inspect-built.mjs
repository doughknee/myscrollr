import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../myscrollr.com/dist/client/', import.meta.url)
const routes = [
  '/',
  '/widgets',
  '/fantasy',
  '/sports',
  '/markets',
  '/news',
  '/releases',
  '/download',
  '/download/mac',
  '/download/windows',
  '/download/linux',
  '/business',
  '/architecture',
  '/support',
  '/legal',
  '/uplink',
  '/uplink/lifetime',
  '/status',
]

function decode(value = '') {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
}

function match(html, pattern) {
  return decode(html.match(pattern)?.[1])
}

const results = routes.map((route) => {
  const path = route === '/' ? 'index.html' : join(route.slice(1), 'index.html')
  const html = readFileSync(new URL(path.replaceAll('\\', '/'), root), 'utf8')
  const title = match(html, /<title>(.*?)<\/title>/s)
  const description = match(
    html,
    /<meta name="description" content="([^"]*)"/,
  )
  const canonical = match(html, /<link rel="canonical" href="([^"]+)"/)
  const ogTitle = match(html, /<meta property="og:title" content="([^"]*)"/)
  const ogDescription = match(
    html,
    /<meta property="og:description" content="([^"]*)"/,
  )
  const ogUrl = match(html, /<meta property="og:url" content="([^"]*)"/)
  const ogImage = match(html, /<meta property="og:image" content="([^"]*)"/)
  const robots = match(html, /<meta name="robots" content="([^"]*)"/)
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((item) => item[1])
  const schema = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (item) => JSON.parse(item[1])['@type'],
  )

  return {
    route,
    title,
    descriptionLength: description.length,
    canonical,
    metadataMatches:
      ogTitle === title &&
      ogDescription === description &&
      ogUrl === canonical &&
      ogImage.startsWith('https://myscrollr.com/og/'),
    robots,
    headingSequence: headings.join(''),
    h1Count: headings.filter((level) => level === '1').length,
    schema,
  }
})

console.log(JSON.stringify(results, null, 2))

for (const field of ['title']) {
  const grouped = Map.groupBy(results, (row) => row[field])
  for (const [value, rows] of grouped) {
    if (rows.length > 1) {
      console.error(`duplicate ${field}: ${value}: ${rows.map((row) => row.route)}`)
      process.exitCode = 1
    }
  }
}
