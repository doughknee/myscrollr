// Read-only integrity check for the one published legacy installation baseline.
// This is NOT publication evidence and never qualifies a feed target.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gh, ghJSON, minisign, releaseAssetName } from './release-policy.mjs';
import { readTagCommit } from './release-lookup.mjs';

const repo = 'doughknee/myscrollr';
const tag = 'desktop-v1.7.2';
const source = '631d7826b815332ffd2e6baf523f609ce98db3bf';
assert.equal(process.env.TAG, tag, 'Only the audited legacy 1.7.2 source is allowed');
assert.equal(process.env.BUILD_RUN_ID, 'legacy', 'Legacy source marker required');
const dir = path.join(process.env.RUNNER_TEMP, 'release-verify-legacy');
await mkdir(dir); // fresh output; do not mix previous verification material
const release = ghJSON('api', `repos/${repo}/releases/tags/${tag}`);
assert.equal(release.id, 422108688);
assert.equal(release.tag_name, tag);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.equal(await readTagCommit(repo, tag), source, 'Legacy tag moved');
const prior = JSON.parse(await readFile(new URL('../../audit/2026-11-03-feed-qualification/qualification.json', import.meta.url), 'utf8'));
assert.equal(prior.stable.tagSource, source);
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const assets = {};
async function download(name) {
  gh('release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', dir);
  const bytes = await readFile(path.join(dir, name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(release.assets.find(a => a.name === name)?.digest, `sha256:${digest}`, 'GitHub asset digest mismatch');
  assets[name] = digest;
  return bytes;
}
const manifest = JSON.parse(await download('latest.json'));
assert.equal(manifest.version, '1.7.2');
for (const target of ['windows-x86_64-nsis', 'darwin-aarch64', 'linux-x86_64']) {
  const entry = manifest.platforms[target];
  assert(entry, `Missing legacy source ${target}`);
  const name = releaseAssetName(entry.url, repo, tag, true);
  await download(name);
  assert.equal(assets[name], prior.stable.integrity.find(a => a.name === name)?.sha256, 'Legacy package changed since qualification');
  await minisign(path.join(dir, name), entry.signature, config.plugins.updater.pubkey);
}
await writeFile(path.join(dir, 'source-integrity.json'), JSON.stringify({
  kind: 'legacy-install-source-only', version: '1.7.2', source, runId: null, assets,
  limitation: 'Published legacy package integrity, not source-bound build proofs or publication authorization.'
}, null, 2));
console.log('Verified unchanged signed 1.7.2 packages for installation-source testing only.');
