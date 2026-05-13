import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'public', 'og')

const PAGES = [
  {
    file: 'default.png',
    eyebrow: 'Scrollr',
    title: 'A quiet ticker at the edge of your screen.',
    subtitle: 'Live finance, sports, news, and fantasy. Free and open source.',
    accent: '#7c3aed',
  },
  {
    file: 'uplink.png',
    eyebrow: 'Scrollr Uplink',
    title: 'Unlimited tracking. Real-time delivery.',
    subtitle: 'From $9.99/month. 14-day free trial.',
    accent: '#06b6d4',
  },
  {
    file: 'business.png',
    eyebrow: 'Scrollr for Business',
    title: 'Branded desktop deployments for your team.',
    subtitle: 'Custom branding, multi-display, self-hosted. From $500/mo.',
    accent: '#f59e0b',
  },
  {
    file: 'download.png',
    eyebrow: 'Download',
    title: 'Scrollr for macOS, Windows, and Linux.',
    subtitle: 'Free. Open source. Never tracks you.',
    accent: '#10b981',
  },
  {
    file: 'architecture.png',
    eyebrow: 'Architecture',
    title: 'How Scrollr delivers real-time data.',
    subtitle: 'Source APIs → CDC → your desktop, in milliseconds.',
    accent: '#ec4899',
  },
]

// Embed the font as a base64 data URL so the script needs no running
// dev server. Plus Jakarta Sans is the website's primary display
// typeface.
const fontPath = join(root, 'public', 'fonts', 'plus-jakarta-sans-latin.woff2')
const fontBuffer = await readFile(fontPath)
const fontDataUrl = `data:font/woff2;base64,${fontBuffer.toString('base64')}`

const template = ({ eyebrow, title, subtitle, accent }) => `
<!doctype html>
<html>
<head>
<style>
  @font-face {
    font-family: 'Plus Jakarta Sans';
    src: url('${fontDataUrl}') format('woff2');
    font-weight: 100 900;
    font-display: block;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: #0a0a14;
    color: #e2e2ec;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    display: flex; flex-direction: column;
    justify-content: space-between;
    padding: 80px;
    position: relative;
    overflow: hidden;
  }
  body::before {
    content: '';
    position: absolute;
    top: -200px; right: -200px;
    width: 600px; height: 600px;
    background: radial-gradient(circle, ${accent}33 0%, transparent 70%);
    border-radius: 50%;
  }
  .eyebrow {
    font-size: 24px; font-weight: 600;
    color: ${accent};
    letter-spacing: 0.05em;
    text-transform: uppercase;
    z-index: 1;
  }
  .title {
    font-size: 72px; font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.025em;
    max-width: 1000px;
    z-index: 1;
  }
  .subtitle {
    font-size: 28px; font-weight: 400;
    color: #a8a8b8;
    max-width: 900px;
    z-index: 1;
  }
  .footer {
    display: flex; align-items: center;
    justify-content: space-between;
    z-index: 1;
  }
  .brand {
    display: flex; align-items: center; gap: 16px;
    font-size: 28px; font-weight: 600;
  }
  .logo {
    width: 48px; height: 48px;
    background: ${accent};
    border-radius: 12px;
  }
  .domain {
    font-size: 20px;
    color: #8a8a98;
    font-feature-settings: 'tnum';
  }
</style>
</head>
<body>
  <div class="eyebrow">${eyebrow}</div>
  <div>
    <div class="title">${title}</div>
    <div class="subtitle" style="margin-top: 24px">${subtitle}</div>
  </div>
  <div class="footer">
    <div class="brand"><div class="logo"></div>Scrollr</div>
    <div class="domain">myscrollr.com</div>
  </div>
</body>
</html>
`

async function main() {
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1, // 1200x630 final dimensions per OG spec
  })
  const page = await context.newPage()

  for (const pg of PAGES) {
    await page.setContent(template(pg), { waitUntil: 'networkidle' })
    // Force a paint so the embedded font is fully shaped before screenshot
    await page.evaluate(() => document.fonts.ready)
    const buf = await page.screenshot({ type: 'png' })
    const outPath = join(outDir, pg.file)
    await writeFile(outPath, buf)
    console.log(`✓ ${pg.file}`)
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
