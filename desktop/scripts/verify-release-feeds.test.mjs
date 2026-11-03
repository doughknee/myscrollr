import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublicFeeds } from './verify-release-feeds.mjs';

const expected = { stable: Buffer.from('{"version":"1.7.3"}\n'), beta: Buffer.from('{"version":"1.8.0-beta.1"}\n') };
function clock() { let time = 0; return { now: () => time, sleep: async ms => { time += ms; } }; }
test('checks exact public bytes on both client URLs without credentials or cache bypass', async () => {
  const calls = [];
  const result = await verifyPublicFeeds(expected, { ...clock(), fetcher: async (url, options) => {
    calls.push(url); assert.deepEqual(Object.keys(options), ['signal']);
    return new Response(expected[url.endsWith('stable.json') ? 'stable' : 'beta']);
  } });
  assert.equal(result.length, 2); assert(result.every(r => r.ok));
  assert(calls.every(url => url.startsWith('https://raw.githubusercontent.com/doughknee/myscrollr/desktop-updates/') && !url.includes('?')));
});
test('waits through negative cache and stale bytes, requiring both feeds in the same successful round', async () => {
  let attempts = 0;
  const result = await verifyPublicFeeds(expected, { ...clock(), fetcher: async url => {
    const round = Math.floor(attempts++ / 2);
    if (!round) return new Response('Not found', { status: 404 });
    if (round === 1 && url.endsWith('beta.json')) return new Response('stale');
    return new Response(expected[url.endsWith('stable.json') ? 'stable' : 'beta']);
  } });
  assert.equal(attempts, 6); assert(result.every(r => r.ok));
});
test('bounded failure blocks announcements on persistent network/HTTP/cache errors', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('rate limited', { status: 429 }), async () => new Response('wrong bytes')]) {
    await assert.rejects(verifyPublicFeeds(expected, { ...clock(), timeoutMs: 10_000, fetcher }), /Do not announce/);
  }
});
test('rejects an unexpectedly large response without reading an unbounded body', async () => {
  await assert.rejects(verifyPublicFeeds(expected, { ...clock(), timeoutMs: 1, fetcher: async () => new Response('x'.repeat(1000)) }), /Unexpected manifest length/);
});
