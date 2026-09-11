const base = process.env.SCROLLR_AUDIT_BASE_URL ?? 'https://myscrollr.com'
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

function value(html, pattern) {
  return html.match(pattern)?.[1] ?? ''
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    ...options,
  })
  return {
    response,
    body: options.method === 'HEAD' ? '' : await response.text(),
  }
}

const pages = []
const internalLinks = new Set()
for (const route of routes) {
  const { response, body } = await request(route, {
    headers: { 'user-agent': 'Googlebot' },
  })
  const canonical = value(body, /<link rel="canonical" href="([^"]+)"/)
  const schemas = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (item) => JSON.parse(item[1])['@type'],
  )
  for (const item of body.matchAll(/href="(\/[^"#?]*)/g)) {
    internalLinks.add(item[1])
  }
  pages.push({
    route,
    status: response.status,
    canonical,
    selfCanonical: canonical === `${base}${route}`,
    h1Count: [...body.matchAll(/<h1\b/gi)].length,
    noindex: /<meta name="robots" content="[^"]*noindex/i.test(body),
    schemas,
  })
}

const variants = []
for (const url of [
  ...(base === 'https://myscrollr.com'
    ? [
        'http://myscrollr.com/sports?probe=seo',
        'http://www.myscrollr.com/sports?probe=seo',
        'https://www.myscrollr.com/sports?probe=seo',
      ]
    : []),
  `${base}/sports/?probe=seo`,
  `${base}/sports/index.html?probe=seo`,
  `${base}/Sports?probe=seo`,
  `${base}/channels?probe=seo`,
]) {
  const response = await fetch(url, { redirect: 'manual' })
  variants.push({
    url,
    status: response.status,
    location: response.headers.get('location'),
  })
}

const privateRoutes = []
for (const path of ['/account', '/admin', '/callback', '/invite', '/u/example', '/not-a-real-route']) {
  const { response, body } = await request(path, {
    headers: { 'user-agent': 'Googlebot' },
  })
  privateRoutes.push({
    path,
    status: response.status,
    xRobotsTag: response.headers.get('x-robots-tag'),
    robotsMeta: value(body, /<meta name="robots" content="([^"]+)"/),
    title: value(body, /<title>(.*?)<\/title>/s),
  })
}

const linkChecks = []
for (const path of [...internalLinks].sort()) {
  const response = await fetch(new URL(path, base), {
    method: 'HEAD',
    redirect: 'manual',
  })
  linkChecks.push({ path, status: response.status })
}

const robots = await request('/robots.txt')
const sitemap = await request('/sitemap.xml')
for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot']) {
  const response = await fetch(`${base}/sports`, {
    headers: { 'user-agent': agent },
  })
  if (response.status !== 200) throw new Error(`${agent} received ${response.status}`)
}

console.log(
  JSON.stringify(
    {
      pages,
      variants,
      privateRoutes,
      brokenInternalLinks: linkChecks.filter(
        ({ status }) => status !== 200 && status !== 301 && status !== 302,
      ),
      robots: {
        status: robots.response.status,
        body: robots.body,
      },
      sitemap: {
        status: sitemap.response.status,
        urlCount: [...sitemap.body.matchAll(/<loc>/g)].length,
        hasLastmod: sitemap.body.includes('<lastmod>'),
      },
    },
    null,
    2,
  ),
)
