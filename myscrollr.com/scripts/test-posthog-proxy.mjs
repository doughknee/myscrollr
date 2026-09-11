import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

// Exercise the production nginx configuration, changing only the destination
// to a local receiver. No test event is sent to a real analytics project.
const dockerfile = readFileSync(
  new URL('../Dockerfile', import.meta.url),
  'utf8',
)
const configs = Object.fromEntries(
  [...dockerfile.matchAll(/printf '([\s\S]*?)' > (\/etc\/nginx\/[^\s]+)/g)].map(
    ([, body, path]) => [
      path,
      body
        .replaceAll(`'"'"'`, "'")
        .replace(/\\n\\\r?\n/g, '\n')
        .replaceAll('\\n', '\n'),
    ],
  ),
)
const production = configs['/etc/nginx/conf.d/default.conf']
const headers = configs['/etc/nginx/security-headers.conf']
assert.ok(
  production && headers,
  'Production nginx configuration must be extracted',
)
const received = []
const upstream = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  received.push({
    url: request.url,
    headers: request.headers,
    body: Buffer.concat(chunks),
  })
  response.writeHead(200, {
    'Set-Cookie': 'provider-cookie=must-not-escape',
    'Cache-Control': 'public',
  })
  response.end('accepted')
})
await new Promise((resolve) => upstream.listen(0, '0.0.0.0', resolve))
const port = upstream.address().port
const proxyDirective =
  'proxy_pass https://$posthog_ingest/i/v0/e/$is_args$args;'
assert.ok(
  production.includes(proxyDirective),
  'Proxy must have a fixed ingestion destination',
)
const mocked = production.replace(
  proxyDirective,
  `proxy_pass http://host.docker.internal:${port}/i/v0/e/;`,
)
const name = `scrollr-posthog-test-${process.pid}`
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
try {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::3000',
    ...(process.platform === 'linux'
      ? ['--add-host=host.docker.internal:host-gateway']
      : []),
    '-e',
    `PRODUCTION=${Buffer.from(production).toString('base64')}`,
    '-e',
    `MOCKED=${Buffer.from(mocked).toString('base64')}`,
    '-e',
    `HEADERS=${Buffer.from(headers).toString('base64')}`,
    'nginx:alpine',
    'sh',
    '-c',
    'echo "$HEADERS" | base64 -d > /etc/nginx/security-headers.conf && echo "$PRODUCTION" | base64 -d > /etc/nginx/conf.d/default.conf && nginx -t && echo "$MOCKED" | base64 -d > /etc/nginx/conf.d/default.conf && nginx -g "daemon off;"',
  )
  const address = docker('port', name, '3000/tcp')
  const base = `http://${address}`
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(base)
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  assert.ok(ready, 'Proxy must start')
  for (const body of [
    Buffer.from('{"event":"test"}'),
    gzipSync('{"event":"test"}'),
  ]) {
    const compressed = body[0] === 31
    const response = await fetch(
      `${base}/ingest/i/v0/e/?compression=${compressed ? 'gzip-js' : 'none'}`,
      {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
          Cookie: 'scrollr-auth=private-test-cookie',
          Authorization: 'Bearer private-test-token',
          'X-Forwarded-For': '192.0.2.1',
          'X-Real-IP': '192.0.2.2',
          Forwarded: 'for=192.0.2.3',
          'User-Agent': 'private-test-browser',
          Referer: 'https://myscrollr.com/callback?code=private',
        },
      },
    )
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'accepted')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const event = received.at(-1)
    assert.equal(
      event.url,
      `/i/v0/e/?compression=${compressed ? 'gzip-js' : 'none'}`,
    )
    assert.deepEqual(event.body, body)
    assert.equal(event.headers.host, 'us.i.posthog.com')
    assert.equal(event.headers['content-type'], 'application/json')
    assert.equal(
      event.headers['content-encoding'],
      compressed ? 'gzip' : undefined,
    )
    for (const header of [
      'cookie',
      'authorization',
      'x-forwarded-for',
      'x-real-ip',
      'forwarded',
      'user-agent',
      'referer',
    ]) {
      assert.equal(
        event.headers[header],
        undefined,
        `${header} must not reach PostHog`,
      )
    }
  }
  for (const [path, method, status] of [
    ['/ingest/i/v0/e/', 'GET', 405],
    ['/ingest/i/v0/e/', 'DELETE', 405],
    ['/ingest/api/projects/', 'POST', 404],
    ['/ingest/s/', 'POST', 404],
  ]) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, status)
  }
  assert.equal(
    (
      await fetch(`${base}/ingest/i/v0/e/`, {
        method: 'POST',
        body: 'x'.repeat(256 * 1024 + 1),
      })
    ).status,
    413,
  )
  assert.equal(
    received.length,
    2,
    'Rejected requests must not reach the provider',
  )
  console.log(
    'PostHog proxy passed: production nginx syntax, event bodies, header isolation, no cookies/cache, method/path/body limits',
  )
} finally {
  try {
    docker('rm', '-f', name)
  } catch {
    /* May not have started. */
  }
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
}
