// Read-only public-byte gate. A successful Git ref update is not proof of CDN visibility.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metadataBranch } from './release-channels.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = `https://raw.githubusercontent.com/doughknee/myscrollr/${metadataBranch}`;
export async function verifyPublicFeeds(expected, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 420_000 } = {}) {
  assert(Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 900_000, 'Invalid public verification deadline');
  const deadline = now() + timeoutMs;
  let delay = 5_000;
  let result;
  do {
    result = await Promise.all(['stable', 'beta'].map(async channel => {
      const bytes = expected[channel];
      assert(Buffer.isBuffer(bytes) && bytes.length > 0, 'Expected both published manifests');
      const wanted = hash(bytes);
      try {
        // No token, cache-busting query, or no-cache header: exercise the URL clients use.
        const response = await fetcher(`${base}/${channel}.json`, { signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))) });
        if (response.status !== 200) { await response.body?.cancel(); return { channel, ok: false, status: response.status }; }
        const chunks = [];
        let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > bytes.length) return { channel, ok: false, reason: 'Unexpected manifest length' };
          chunks.push(chunk);
        }
        const actual = hash(Buffer.concat(chunks));
        return { channel, ok: actual === wanted, status: response.status, sha256: actual, expectedSha256: wanted };
      } catch { return { channel, ok: false, reason: 'Public request failed or timed out' }; }
    }));
    if (result.every(r => r.ok)) return result;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, 30_000);
  } while (now() < deadline);
  throw new Error(`Public feeds did not converge before the deadline: ${JSON.stringify(result)}. Do not announce; retry verification without replacing published artifacts.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--expected-dir', 'Use --expected-dir <publisher plan directory>');
  const expected = Object.fromEntries(await Promise.all(['stable', 'beta'].map(async channel => [channel, await readFile(path.join(args[1], `${channel}.json`))])));
  console.log(JSON.stringify(await verifyPublicFeeds(expected), null, 2));
}
