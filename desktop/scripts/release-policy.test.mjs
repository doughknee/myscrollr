import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedEffects } from './release-event.mjs';
import { selectLegacyStable, validateLegacyManifest } from './repair-desktop-latest.mjs';
import { recordProof, validateArtifacts, validateRelease, validateRun, validateVersions, validateTagCommit, releaseAssetName } from './release-policy.mjs';

const sha = 'a'.repeat(40), repo = 'doughknee/myscrollr';
const run = { id: 123, path: '.github/workflows/desktop-release.yml', head_sha: sha,
  head_branch: 'main', repository: { full_name: repo }, head_repository: { full_name: repo },
  event: 'push', status: 'completed', conclusion: 'success' };
const stable = { tag_name: 'desktop-v1.8.0', draft: false, prerelease: false, published_at: '2026-11-03T00:00:00Z' };
const beta = { ...stable, tag_name: 'desktop-v1.9.0-beta.1', prerelease: true };

test('only published stable desktop releases announce; beta never refreshes stable KB', () => {
  assert.deepEqual(allowedEffects(stable), { announce: true, kb: true });
  for (const r of [beta, { ...beta, prerelease: false }, { ...stable, draft: true }, { ...stable, published_at: null }]) {
    assert.deepEqual(allowedEffects(r), { announce: false, kb: false });
  }
  assert.deepEqual(allowedEffects({ ...stable, tag_name: 'server-2026.11.03.1' }), { announce: false, kb: true });
  assert.throws(() => validateRelease({ ...beta, prerelease: false }));
});

test('legacy desktop selection ignores newer backend, beta and draft releases', () => {
  const previous = { ...stable, tag_name: 'desktop-v1.7.2' };
  assert.equal(selectLegacyStable([beta, { ...stable, tag_name: 'server-2027.1' }, { ...stable, draft: true }, previous, stable]), stable);
});

test('run binding rejects wrong source, workflow, repository, event and status', () => {
  validateRun(run, sha, repo, true);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { path: '.github/workflows/deploy.yml' },
    { head_repository: { full_name: 'someone/fork' } }, { head_branch: 'feature/unreviewed' },
    { event: 'pull_request' }, { conclusion: 'failure' }, { status: 'in_progress' }]) {
    assert.throws(() => validateRun({ ...run, ...patch }, sha, repo, true));
  }
});

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrollr-release-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = { 'windows-x86_64': ['Scrollr_1.8.0_x64_en-US.msi', 'Scrollr_1.8.0_x64-setup.exe'],
    'darwin-aarch64': ['Scrollr_1.8.0_aarch64.dmg', 'Scrollr_aarch64.app.tar.gz'],
    'linux-x86_64': ['Scrollr_1.8.0_amd64.AppImage', 'Scrollr_1.8.0_amd64.deb', 'Scrollr-1.8.0-1.x86_64.rpm'] };
  const proofs = [], assets = [];
  const sig = Buffer.from('fixture signed bytes only, not a real signature').toString('base64');
  for (const [target, names] of Object.entries(files)) {
    const hashes = {};
    for (const name of names) {
      const body = `fixture ${target} ${name}`;
      await writeFile(path.join(dir, name), body);
      await writeFile(path.join(dir, `${name}.sig`), sig);
      hashes[name] = createHash('sha256').update(body).digest('hex');
      assets.push({ name }, { name: `${name}.sig` });
    }
    proofs.push({ schema: 1, target, version: '1.8.0', source: sha, runId: String(run.id), assets: hashes });
  }
  const entry = name => ({ url: `https://github.com/${repo}/releases/download/desktop-v1.8.0/${name}`, signature: sig });
  const manifest = { version: '1.8.0', platforms: {
    'windows-x86_64': entry(files['windows-x86_64'][0]),
    'windows-x86_64-msi': entry(files['windows-x86_64'][0]),
    'windows-x86_64-nsis': entry(files['windows-x86_64'][1]),
    'darwin-aarch64': entry(files['darwin-aarch64'][1]),
    'linux-x86_64': entry(files['linux-x86_64'][0]),
    'linux-x86_64-deb': entry(files['linux-x86_64'][1]),
    'linux-x86_64-rpm': entry(files['linux-x86_64'][2]),
  } };
  const saveManifest = () => writeFile(path.join(dir, 'latest.json'), JSON.stringify(manifest));
  await saveManifest(); assets.push({ name: 'latest.json' });
  const verified = [];
  const opts = { release: { ...stable, draft: true, assets }, run, sha, repo, dir, proofs,
    publicKey: 'fixture', verifySignature: async file => { verified.push(path.basename(file)); } };
  return { opts, manifest, saveManifest, verified };
}

test('valid complete candidate verifies final hashes and each distinct updater signature', async t => {
  const f = await fixture(t);
  const result = await validateArtifacts(f.opts);
  assert.equal(result.version, '1.8.0');
  assert.equal(f.verified.length, 6);
  validateLegacyManifest(f.opts.release, f.manifest, repo);
});

for (const scenario of ['wrong proof source', 'wrong proof run', 'missing platform', 'swapped bytes',
  'wrong manifest version', 'wrong URL', 'wrong architecture', 'mismatched signature', 'invalid signature', 'extra unproven installer']) {
  test(`refuses publication: ${scenario}`, async t => {
    const f = await fixture(t);
    switch (scenario) {
      case 'wrong proof source': f.opts.proofs[0].source = 'b'.repeat(40); break;
      case 'wrong proof run': f.opts.proofs[0].runId = '999'; break;
      case 'missing platform': delete f.manifest.platforms['darwin-aarch64']; break;
      case 'swapped bytes': await writeFile(path.join(f.opts.dir, 'Scrollr_1.8.0_x64-setup.exe'), 'other build'); break;
      case 'wrong manifest version': f.manifest.version = '1.9.0'; break;
      case 'wrong URL': f.manifest.platforms['linux-x86_64'].url = 'https://example.com/app.AppImage'; break;
      case 'wrong architecture': f.manifest.platforms['darwin-aarch64'] = f.manifest.platforms['linux-x86_64']; break;
      case 'mismatched signature': f.manifest.platforms['linux-x86_64'].signature = 'wrong'; break;
      case 'invalid signature': f.opts.verifySignature = async () => { throw new Error('verification failed'); }; break;
      case 'extra unproven installer': f.opts.release.assets.push({ name: 'foreign.exe' }); break;
    }
    await f.saveManifest();
    await assert.rejects(() => validateArtifacts(f.opts));
  });
}

test('checked-in desktop version identities agree', async () => {
  assert.equal(typeof await validateVersions(fileURLToPath(new URL('..', import.meta.url))), 'string');
});


test('tag must resolve to source; only an unpublished draft can have no tag yet', () => {
  validateTagCommit(sha, sha, false);
  validateTagCommit(null, sha, true);
  assert.throws(() => validateTagCommit(null, sha, false));
  assert.throws(() => validateTagCommit('b'.repeat(40), sha, true));
});

test('updater URL rejects traversal, credentials, cross-release and cross-repository assets', () => {
  const prefix = `https://github.com/${repo}/releases/download/${stable.tag_name}/`;
  assert.equal(releaseAssetName(prefix+'file.msi',repo,stable.tag_name),'file.msi');
  for (const raw of [prefix+'../other/file.msi', prefix+'%2e%2e/other/file.msi', prefix+'a%2fb.msi',
    prefix+'a%5cb.msi', prefix+'file.msi?download=1', prefix+'file.msi#x',
    prefix.replace('github.com','user@github.com')+'file.msi', prefix.replace('doughknee','someone')+'file.msi',
    prefix.replace('desktop-v1.8.0','desktop-v1.7.0')+'file.msi']) {
    assert.throws(() => releaseAssetName(raw,repo,stable.tag_name), raw);
  }
});

test('published retry re-verifies bytes without requiring a draft', async t => {
  const f = await fixture(t); f.opts.release.draft = false;
  const result = await validateArtifacts(f.opts);
  assert.equal(result.assets['latest.json'].length,64);
  await writeFile(path.join(f.opts.dir,'Scrollr_1.8.0_x64-setup.exe'),'tampered after publication');
  await assert.rejects(() => validateArtifacts(f.opts));
});

test('mac recorder hashes local Tauri archive under its uploaded asset name', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrollr-record-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'macos'));
  await mkdir(path.join(dir, 'dmg'));
  await writeFile(path.join(dir, 'macos', 'Scrollr.app.tar.gz'), 'archive bytes');
  await writeFile(path.join(dir, 'dmg', 'Scrollr_1.7.2_aarch64.dmg'), 'stapled dmg bytes');
  const proof = await recordProof(fileURLToPath(new URL('..', import.meta.url)), 'darwin-aarch64', dir,
    { GITHUB_SHA: sha, GITHUB_RUN_ID: '123' });
  assert.equal(proof.assets['Scrollr_aarch64.app.tar.gz'], createHash('sha256').update('archive bytes').digest('hex'));
  assert.equal(proof.assets['Scrollr.app.tar.gz'], undefined);
});
