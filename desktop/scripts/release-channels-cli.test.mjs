// Full publisher CLI rehearsal against a local fake gh. Run in Linux CI or the
// documented network-disabled container; no GitHub credentials or writes are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./release-channels.mjs', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
function entry(version) {
  const tag = `desktop-v${version}`;
  const platforms = Object.fromEntries(['windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis', 'darwin-aarch64', 'linux-x86_64'].map(target => [target,
    { url: `https://github.com/doughknee/myscrollr/releases/download/${tag}/${target}.bin`, signature: 'synthetic-fixture-not-a-signature' }]));
  const manifest = { version, platforms };
  const manifestText = json(manifest);
  return { tag, withdrawn: false, manifest, manifestText, evidence: { schema: 1, version, source: '1'.repeat(40), runId: '123',
    assets: { ...Object.fromEntries(Object.keys(platforms).map(t => [`${t}.bin`, '2'.repeat(64)])), 'latest.json': createHash('sha256').update(manifestText).digest('hex') } } };
}
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
const stateFile = process.env.REHEARSAL_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
assert.equal(args[0], 'api');
const mutation = args.includes('--method');
const method = mutation ? args[args.indexOf('--method') + 1] : 'GET';
const endpoint = mutation ? args[args.indexOf('--method') + 2] : args[1];
const body = mutation ? JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')) : null;
state.calls.push({ method, endpoint, body });
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const reply = value => { save(); console.log(JSON.stringify(value)); };
const fail = text => { save(); console.error(text); process.exitCode = 1; };
if (method === 'GET' && endpoint.endsWith('/git/ref/heads/desktop-updates')) {
  if (state.missing) fail('gh: HTTP 404'); else reply({ object: { sha: state.head } });
} else if (method === 'GET' && endpoint.includes('/git/commits/')) reply({ tree: { sha: state.tree } });
else if (method === 'GET' && endpoint.includes('/contents/index.json?ref=')) reply({ content: Buffer.from(JSON.stringify(state.registry)).toString('base64') });
else if (method === 'GET' && endpoint.includes('/releases/tags/')) {
  const tag = decodeURIComponent(endpoint.split('/tags/')[1]);
  const entry = state.entries.find(e => e.tag === tag); assert(entry, 'Unexpected release lookup');
  reply({ tag_name: tag, draft: false, prerelease: entry.manifest.version.includes('-'), target_commitish: entry.evidence.source,
    assets: Object.entries(entry.evidence.assets).map(([name, hash]) => ({ name, digest: 'sha256:' + hash })) });
} else if (method === 'GET' && endpoint.includes('/commits/refs')) reply({ sha: '1'.repeat(40) });
else if (method === 'GET' && endpoint.endsWith('/branches/desktop-updates')) reply({ protected: state.protected });
else if (method === 'POST' && endpoint.endsWith('/git/trees')) {
  assert.equal(body.base_tree, state.tree);
  assert.deepEqual(body.tree.map(e => e.path).sort(), ['beta.json', 'index.json', 'stable.json']);
  state.pendingFiles = Object.fromEntries(body.tree.map(e => [e.path, e.content]));
  reply({ sha: JSON.stringify(state.pendingFiles) === JSON.stringify(state.files) ? state.tree : 'b'.repeat(40) });
} else if (method === 'POST' && endpoint.endsWith('/git/commits')) {
  assert.deepEqual(body.parents, [state.head]);
  state.pendingParent = body.parents[0];
  if (state.race) state.head = 'f'.repeat(40); // Another publisher advances after our snapshot.
  reply({ sha: 'c'.repeat(40) });
} else if (method === 'PATCH' && endpoint.endsWith('/git/refs/heads/desktop-updates')) {
  assert.equal(body.force, false);
  if (state.head !== state.pendingParent) fail('gh: Update is not a fast forward (HTTP 422)');
  else { state.head = body.sha; state.files = state.pendingFiles; state.registry = JSON.parse(state.files['index.json']); reply({ object: { sha: state.head } }); }
} else throw new Error('Unexpected request: ' + method + ' ' + endpoint);
`;

async function scenario(options, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrollr-feed-rehearsal-'));
  try {
    await mkdir(path.join(dir, 'bin'));
    await writeFile(path.join(dir, 'bin', 'gh'), fakeGh);
    await chmod(path.join(dir, 'bin', 'gh'), 0o755);
    const stable = entry('1.7.3');
    const incoming = entry(options.retry || options.bootstrap ? '1.7.3' : '1.8.0-beta.1');
    const registry = { schema: 1, releases: options.bootstrap ? [] : [stable] };
    const files = options.bootstrap ? { 'index.json': json(registry) }
      : { 'index.json': json(registry), 'stable.json': stable.manifestText, 'beta.json': stable.manifestText };
    const state = { head: 'a'.repeat(40), tree: 'd'.repeat(40), registry, entries: [stable, incoming], files,
      protected: true, calls: [], ...options };
    const stateFile = path.join(dir, 'state.json');
    await writeFile(stateFile, json(state));
    const verifyDir = path.join(dir, 'release-verify-123');
    await mkdir(verifyDir);
    await writeFile(path.join(verifyDir, 'verification.json'), json(incoming.evidence));
    await writeFile(path.join(verifyDir, 'latest.json'), incoming.manifestText);
    const invoke = (apply = false) => spawnSync(process.execPath, [cli, ...(apply ? ['--apply'] : [])], {
      encoding: 'utf8', timeout: 30_000,
      env: { PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'doughknee/myscrollr',
        TAG: incoming.tag, BUILD_RUN_ID: '123', RUNNER_TEMP: dir, CHANNEL_PLAN_DIR: path.join(dir, 'plan'), REHEARSAL_STATE: stateFile,
        GH_CONFIG_DIR: path.join(dir, 'no-credentials'), GH_TOKEN: 'synthetic-not-a-token', HOME: dir },
    });
    await run({ invoke, dir, state: async () => JSON.parse(await readFile(stateFile, 'utf8')), original: files });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const posix = { skip: process.platform === 'win32' ? 'Run this CLI rehearsal in the documented network-disabled Linux container' : false };
test('CLI first Stable approval creates both feeds from the empty bootstrap registry', posix, async () => {
  await scenario({ bootstrap: true }, async ({ invoke, state }) => {
    const result = invoke(true); assert.equal(result.status, 0, result.stderr);
    const final = await state();
    assert.equal(final.calls.filter(c => c.method === 'PATCH').length, 1);
    assert.equal(final.files['stable.json'], final.files['beta.json']);
    assert.equal(JSON.parse(final.files['stable.json']).version, '1.7.3');
    assert.equal(final.registry.releases.length, 1);
  });
});

test('CLI dry-run writes the reviewed plan locally and makes zero API mutations', posix, async () => {
  await scenario({}, async ({ invoke, state, dir, original }) => {
    const result = invoke(); assert.equal(result.status, 0, result.stderr);
    assert((await state()).calls.every(c => c.method === 'GET'));
    assert.deepEqual((await state()).files, original);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'plan/beta.json'))).version, '1.8.0-beta.1');
  });
});
test('CLI apply switches both feeds and registry in one non-force reference update', posix, async () => {
  await scenario({}, async ({ invoke, state }) => {
    const result = invoke(true); assert.equal(result.status, 0, result.stderr);
    const final = await state();
    assert.equal(final.calls.filter(c => c.method === 'PATCH').length, 1);
    assert.equal(JSON.parse(final.files['stable.json']).version, '1.7.3');
    assert.equal(JSON.parse(final.files['beta.json']).version, '1.8.0-beta.1');
    assert.equal(final.registry.releases.length, 2);
  });
});
test('CLI loses a publication race without overwriting the winning ref or visible files', posix, async () => {
  await scenario({ race: true }, async ({ invoke, state, original }) => {
    const result = invoke(true); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a fast forward/);
    assert.equal((await state()).head, 'f'.repeat(40));
    assert.deepEqual((await state()).files, original);
  });
});
test('CLI refuses absent or unprotected metadata branches before any write', posix, async () => {
  for (const options of [{ missing: true }, { protected: false }]) await scenario(options, async ({ invoke, state }) => {
    const result = invoke(true); assert.notEqual(result.status, 0);
    assert((await state()).calls.every(c => c.method === 'GET'));
  });
});
test('CLI repeated approval is a no-op with no new commit or ref update', posix, async () => {
  await scenario({ retry: true }, async ({ invoke, state }) => {
    const result = invoke(true); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already reconciled/);
    assert(!(await state()).calls.some(c => c.method === 'PATCH' || c.method === 'POST' && c.endpoint.endsWith('/git/commits')));
  });
});
