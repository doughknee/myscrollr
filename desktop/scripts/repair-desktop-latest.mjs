// Read-only by default. --apply changes Latest metadata, never draft/assets.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { gh, ghJSON, minisign, targets, validateRelease, releaseAssetName } from './release-policy.mjs';

export function selectLegacyStable(releases) {
  return releases.filter(r => {
    try { return validateRelease(r, { draft: false }).channel === 'stable' && r.published_at; }
    catch { return false; }
  }).sort((a, b) => semver.rcompare(a.tag_name.slice(9), b.tag_name.slice(9)))[0];
}
export function validateLegacyManifest(release, manifest, repo) {
  assert.equal(manifest.version, release.tag_name.slice(9), 'Legacy manifest version mismatch');
  const names = new Set(release.assets.map(a => a.name));
  for (const target of targets) assert(manifest.platforms?.[target], `Missing legacy target ${target}`);
  for (const entry of Object.values(manifest.platforms)) {
    const name = releaseAssetName(entry.url, repo, release.tag_name, true);
    assert(names.has(name) && names.has(`${name}.sig`) && entry.signature?.length > 20, 'Missing signed legacy asset');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY || 'doughknee/myscrollr';
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo));
  const pages = ghJSON('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`);
  const selected = selectLegacyStable(pages.flat());
  assert(selected, 'No published stable desktop release');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrollr-latest-'));
  gh('release', 'download', selected.tag_name, '--repo', repo, '--pattern', 'latest.json', '--dir', dir);
  const manifest = JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8'));
  validateLegacyManifest(selected, manifest, repo);
  const current = ghJSON('api', `repos/${repo}/releases/latest`);
  console.log(JSON.stringify({ current: current.tag_name, proposed: selected.tag_name, apply: process.argv.includes('--apply') }));
  if (process.argv.includes('--apply')) {
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const verified = new Set();
    for (const entry of Object.values(manifest.platforms)) {
      const name = decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1));
      if (verified.has(name)) continue;
      gh('release', 'download', selected.tag_name, '--repo', repo, '--pattern', name, '--dir', dir);
      await minisign(path.join(dir, name), entry.signature, config.plugins.updater.pubkey);
      verified.add(name);
    }
    gh('release', 'edit', selected.tag_name, '--repo', repo, '--latest=true');
    assert.equal(ghJSON('api', `repos/${repo}/releases/latest`).tag_name, selected.tag_name, 'Legacy Latest repair did not stick');
  }
}
