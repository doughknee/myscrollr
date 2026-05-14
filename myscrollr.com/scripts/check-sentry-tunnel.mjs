import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const repoRoot = join(root, '..')

const sentrySource = readFileSync(join(root, 'src', 'sentry.ts'), 'utf8')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')

const failures = []

if (!sentrySource.includes("tunnel: '/api/sentry-envelope'")) {
  failures.push('src/sentry.ts must route browser events through /api/sentry-envelope')
}

if (!dockerfile.includes('location = /api/sentry-envelope')) {
  failures.push('Dockerfile must define an exact nginx location for /api/sentry-envelope')
}

if (!dockerfile.includes('proxy_pass https://o4511384091033600.ingest.us.sentry.io/api/4511384375132160/envelope/')) {
  failures.push('Dockerfile must proxy the tunnel to the scrollr-web Sentry envelope endpoint')
}

if (!dockerfile.includes('proxy_ssl_server_name on')) {
  failures.push('Dockerfile must enable SNI for the Sentry ingest proxy')
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure}`)
  }
  process.exit(1)
}

console.log(`✓ Sentry browser tunnel is configured from ${repoRoot}`)
