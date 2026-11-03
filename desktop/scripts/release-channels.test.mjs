import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcile, validatePublished } from './release-channels.mjs';

const repo = 'doughknee/myscrollr';
const empty = { schema: 1, releases: [] };
function entry(version) {
  const tag = `desktop-v${version}`;
  const names = { 'windows-x86_64': 'app.msi', 'windows-x86_64-msi': 'app.msi', 'windows-x86_64-nsis': 'app-setup.exe', 'darwin-aarch64': 'app.app.tar.gz', 'linux-x86_64': 'app.AppImage' };
  const platforms = Object.fromEntries(Object.entries(names).map(([target, name]) => [target, { url: `https://github.com/${repo}/releases/download/${tag}/${name}`, signature: 'signed-fixture-signature-only' }]));
  const manifest = { version, platforms, notes: 'Fixture' };
  const manifestText = JSON.stringify(manifest);
  return { tag, withdrawn: false, manifest, manifestText, evidence: { schema: 1, version, source: 'a'.repeat(40), runId: '123', assets: { ...Object.fromEntries(Object.values(names).map(name => [name, 'b'.repeat(64)])), 'latest.json': createHash('sha256').update(manifestText).digest('hex') } } };
}
function add(registry, version) { return reconcile(registry, { approve: entry(version) }, repo); }
test('Beta accepts newer Stable, Stable never selects a prerelease, numeric SemVer wins', () => {
  let p = add(empty, '1.7.2');
  p = add(p.registry, '1.8.0-beta.2');
  p = add(p.registry, '1.8.0-beta.10');
  assert.equal(p.stable.manifest.version, '1.7.2');
  assert.equal(p.beta.manifest.version, '1.8.0-beta.10');
  p = add(p.registry, '1.8.0');
  assert.equal(p.stable.manifest.version, '1.8.0');
  assert.equal(p.beta.manifest.version, '1.8.0');
});
test('a delayed old finalizer cannot regress either channel; retry is idempotent', () => {
  const p = add(add(empty, '1.9.0').registry, '1.8.0-beta.1');
  assert.equal(p.beta.manifest.version, '1.9.0');
  assert.deepEqual(add(p.registry, '1.8.0-beta.1'), p);
});
test('withdrawal selects next approved cohort, cannot silently restore or remove last Stable', () => {
  const p = add(add(empty, '1.7.2').registry, '1.8.0-beta.1');
  const next = reconcile(p.registry, { withdraw: 'desktop-v1.8.0-beta.1' }, repo);
  assert.equal(next.beta.manifest.version, '1.7.2');
  assert.throws(() => add(next.registry, '1.8.0-beta.1'), /immutable or withdrawn/);
  assert.throws(() => reconcile(next.registry, { withdraw: 'desktop-v1.7.2' }, repo), /baseline/);
});
test('no beta-only bootstrap, changed proof, incomplete cohort, cross-release URL or ambiguous precedence', () => {
  assert.throws(() => add(empty, '1.8.0-beta.1'), /baseline/);
  const bad = entry('1.7.2'); bad.manifestText += ' ';
  assert.throws(() => reconcile(empty, { approve: bad }, repo), /changed after verification/);
  const incomplete = entry('1.7.2'); delete incomplete.manifest.platforms['darwin-aarch64'];
  incomplete.manifestText = JSON.stringify(incomplete.manifest);
  incomplete.evidence.assets['latest.json'] = createHash('sha256').update(incomplete.manifestText).digest('hex');
  assert.throws(() => reconcile(empty, { approve: incomplete }, repo), /Incomplete cohort/);
  assert.throws(() => add(add(empty, '1.7.2').registry, '1.7.2+other'), /Ambiguous/);
  assert.throws(() => reconcile(empty, { withdraw: 'desktop-v0.0.1' }, repo), /unknown release/);
});
test('published assets, source and release status must still match verified record', () => {
  const e = entry('1.7.2');
  const release = { tag_name: e.tag, target_commitish: e.evidence.source, draft: false, prerelease: false,
    assets: Object.entries(e.evidence.assets).map(([name, hash]) => ({ name, digest: `sha256:${hash}` })) };
  validatePublished(e, release, repo);
  assert.throws(() => validatePublished(e, { ...release, draft: true }, repo), /published/);
  assert.throws(() => validatePublished(e, { ...release, prerelease: true }, repo), /mismatch/);
  assert.throws(() => validatePublished(e, { ...release, assets: release.assets.slice(1) }, repo), /Missing/);
  assert.throws(() => validatePublished(e, { ...release, target_commitish: 'c'.repeat(40) }, repo), /source changed/);
});
