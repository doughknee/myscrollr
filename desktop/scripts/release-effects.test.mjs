import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { allowedEffects, verifyDesktopEffects } from './release-event.mjs';
import { selectLegacyStable } from './repair-desktop-latest.mjs';

const repo = 'doughknee/myscrollr';
const hash = data => createHash('sha256').update(data).digest('hex');
function fixture() {
  const tag = 'desktop-v1.8.0', source = 'a'.repeat(40);
  const manifest = { version: '1.8.0', platforms: Object.fromEntries(['windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis', 'darwin-aarch64', 'linux-x86_64'].map(t => [t, { url: `https://github.com/${repo}/releases/download/${tag}/${t}.bin`, signature: 'synthetic-fixture-not-a-signature' }])) };
  const manifestText = JSON.stringify(manifest);
  const evidence = { schema: 1, version: '1.8.0', source, runId: '123', assets: { 'latest.json': hash(manifestText), ...Object.fromEntries(Object.keys(manifest.platforms).map(t => [`${t}.bin`, 'b'.repeat(64)])) } };
  const files = { 'verification.json': Buffer.from(JSON.stringify(evidence)), 'latest.json': Buffer.from(manifestText) };
  const entry = { tag, withdrawn: false, evidence, manifestText, manifest };
  const release = { tag_name: tag, target_commitish: source, draft: false, prerelease: false, published_at: '2026-11-03T00:00:00Z', assets: [...Object.entries(evidence.assets).map(([name, sha]) => ({ name, digest: `sha256:${sha}` })), { name: 'verification.json', digest: `sha256:${hash(files['verification.json'])}` }] };
  const run = { id: 123, path: '.github/workflows/desktop-release.yml', head_sha: source, head_branch: 'main', repository: { full_name: repo }, head_repository: { full_name: repo }, event: 'push', status: 'completed', conclusion: 'success' };
  let publicChecks = 0;
  const registry = { schema: 1, releases: [entry] };
  const deps = { repo, feedsEnabled: true, readAsset: async name => files[name], readRun: async () => run,
    readTag: async () => source, readRegistry: async () => registry, readRelease: async () => release,
    verifyFeeds: async expected => { publicChecks++; assert.equal(expected.stable.toString(), manifestText); assert.equal(expected.beta.toString(), manifestText); } };
  return { release, run, files, entry, registry, deps, publicChecks: () => publicChecks };
}

test('publication/channel metadata alone never authorizes desktop follow-ups', () => {
  const { release } = fixture();
  assert.deepEqual(allowedEffects(release), { announce: false, kb: false });
  assert.deepEqual(allowedEffects({ ...release, assets: [] }), { announce: false, kb: false });
});
test('verified approved publication requires both public feeds before effects', async () => {
  const f = fixture();
  await verifyDesktopEffects(f.release, f.deps);
  assert.equal(f.publicChecks(), 1);
  assert.deepEqual(allowedEffects(f.release, true), { announce: true, kb: true });
});
for (const [name, mutate, message] of [
  ['missing evidence', f => { f.release.assets = []; }, /publication evidence/],
  ['changed record', f => { f.files['verification.json'] = Buffer.from('{}'); }, /digest mismatch/],
  ['changed installer', f => { f.release.assets.find(a => a.name.endsWith('.bin')).digest = 'sha256:' + 'c'.repeat(64); }, /Published bytes changed/],
  ['failed build', f => { f.run.conclusion = 'failure'; }, /Build did not succeed/],
  ['untrusted build branch', f => { f.run.head_branch = 'feature/other'; }, /Only main/],
  ['moved tag', f => { f.deps.readTag = async () => 'c'.repeat(40); }, /tag moved/],
  ['unapproved publication', f => { f.registry.releases = []; }, /baseline/],
  ['withdrawn publication', f => { f.entry.withdrawn = true; }, /baseline/],
  ['unavailable public feeds', f => { f.deps.verifyFeeds = async () => { throw new Error('public feeds unavailable'); }; }, /public feeds unavailable/],
  ['unavailable registry', f => { f.deps.readRegistry = async () => { throw new Error('registry unavailable'); }; }, /registry unavailable/],
]) test(`direct follow-ups fail closed: ${name}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(verifyDesktopEffects(f.release, f.deps), message);
});
test('disabled feeds still require verified publication but no nonexistent registry', async () => {
  const f = fixture(); f.deps.feedsEnabled = false;
  f.deps.readRegistry = async () => { throw new Error('must not read'); };
  await verifyDesktopEffects(f.release, f.deps);
  assert.equal(f.publicChecks(), 0);
  f.release.assets = [];
  await assert.rejects(verifyDesktopEffects(f.release, f.deps), /publication evidence/);
});
test('backend KB eligibility remains separate and Beta never authorizes Stable effects', () => {
  const { release } = fixture();
  assert.deepEqual(allowedEffects({ ...release, tag_name: 'server-2026.11.03.1' }), { announce: false, kb: true });
  assert.deepEqual(allowedEffects({ ...release, tag_name: 'desktop-v1.9.0-beta.1', prerelease: true }, true), { announce: false, kb: false });
});
test('late older Stable and retries cannot replace the greatest legacy Stable selection', () => {
  const { release } = fixture();
  const older = { ...release, tag_name: 'desktop-v1.7.3' };
  const beta = { ...release, tag_name: 'desktop-v2.0.0-beta.1', prerelease: true };
  for (const releases of [[release, older], [older, release], [beta, older, release]]) {
    assert.equal(selectLegacyStable(releases).tag_name, 'desktop-v1.8.0');
  }
});
test('all publication/recovery entry points retain the readiness and monotonic Latest gates', async () => {
  const workflow = name => readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  const finish = await workflow('finish-release');
  const publish = finish.slice(finish.indexOf('      - name: Publish verified release'), finish.indexOf('      - name: Advance approved update channels'));
  assert(!publish.includes('--latest=true'));
  assert(publish.includes('gh release edit "$TAG" --draft=false --latest=false'));
  assert(publish.includes("if: needs.prepare.outputs.channel == 'stable'"));
  assert(publish.includes('node desktop/scripts/repair-desktop-latest.mjs --apply'));
  // Reconciliation is outside the draft-only conditional, so a failed-job retry repairs Latest too.
  assert(publish.indexOf('          fi') < publish.indexOf('node desktop/scripts/repair-desktop-latest.mjs --apply'));
  for (const name of ['discord-release', 'support-kb-refresh']) {
    const text = await workflow(name);
    assert(text.includes('actions: read'));
    assert(text.includes('CHANNEL_FEEDS_ENABLED: ${{ vars.DESKTOP_CHANNEL_FEEDS_ENABLED }}'));
    assert(text.includes('node desktop/scripts/release-event.mjs'));
  }
});
