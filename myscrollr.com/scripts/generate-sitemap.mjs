import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'public', 'sitemap.xml')

const today = new Date().toISOString().slice(0, 10)

// Hand-curated route table — single source of truth.
// Mirrors the prerendered marketing routes in dist/client/. Auth-only
// routes (/account, /callback, /invite, /u/*) and the synthetic SPA
// shell are intentionally excluded — they're disallowed in robots.txt
// so including them here would send mixed signals to crawlers.
//
// /status IS indexable as of 2026-05: public service-health page with
// SEO meta in the prerendered <head> and live data hydrating on the
// client. Low priority + daily changefreq because the body changes
// often but isn't search-relevant.
const ROUTES = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/download', priority: 0.9, changefreq: 'weekly' },
  { path: '/download/mac', priority: 0.8, changefreq: 'weekly' },
  { path: '/download/windows', priority: 0.8, changefreq: 'weekly' },
  { path: '/download/linux', priority: 0.8, changefreq: 'weekly' },
  { path: '/uplink', priority: 0.9, changefreq: 'monthly' },
  { path: '/uplink/lifetime', priority: 0.8, changefreq: 'monthly' },
  { path: '/channels', priority: 0.8, changefreq: 'weekly' },
  { path: '/architecture', priority: 0.7, changefreq: 'monthly' },
  { path: '/business', priority: 0.7, changefreq: 'monthly' },
  { path: '/support', priority: 0.7, changefreq: 'monthly' },
  { path: '/legal', priority: 0.3, changefreq: 'monthly' },
  { path: '/status', priority: 0.2, changefreq: 'daily' },
]

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map(
  (r) => `  <url>
    <loc>https://myscrollr.com${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`,
).join('\n')}
</urlset>
`

await writeFile(outPath, xml)
console.log(`✓ sitemap.xml written with ${ROUTES.length} URLs`)
