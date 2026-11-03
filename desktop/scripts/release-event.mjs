import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh, ghJSON, validateRelease, validateRun } from './release-policy.mjs';
import { metadataBranch, reconcile, validatePublished } from './release-channels.mjs';
import { verifyPublicFeeds } from './verify-release-feeds.mjs';

// Classification alone never authorizes a desktop side effect.
export function allowedEffects(release, desktopReady = false) {
  if (release.draft || release.prerelease || !release.published_at) return { announce: false, kb: false };
  if (!release.tag_name?.startsWith('desktop-v')) return { announce: false, kb: true };
  try {
    const { channel } = validateRelease(release, { draft: false });
    return { announce: channel === 'stable' && desktopReady, kb: channel === 'stable' && desktopReady };
  } catch { return { announce: false, kb: false }; }
}

// Same trust boundary as support's published proof: the authorized finalizer
// records verified installer hashes. Recheck that record, current assets and
// source/run binding; do not invent proof for historical or manually published bytes.
export async function verifyDesktopEffects(release, deps) {
  const { repo } = deps;
  assert.equal(repo, 'doughknee/myscrollr');
  assert(allowedEffects(release, true).announce, 'Not a published Stable desktop release');
  const bytes = {};
  for (const name of ['verification.json', 'latest.json']) {
    const assets = release.assets?.filter(a => a.name === name) || [];
    assert.equal(assets.length, 1, `Missing/duplicate publication evidence: ${name}`);
    bytes[name] = await deps.readAsset(name);
    assert.equal(`sha256:${createHash('sha256').update(bytes[name]).digest('hex')}`, assets[0].digest, `Evidence digest mismatch: ${name}`);
  }
  const evidence = JSON.parse(bytes['verification.json']);
  const manifestText = bytes['latest.json'].toString('utf8');
  const entry = { tag: release.tag_name, withdrawn: false, evidence, manifestText, manifest: JSON.parse(manifestText) };
  validatePublished(entry, release, repo);
  const run = await deps.readRun(evidence.runId);
  assert.equal(String(run.id), evidence.runId, 'Evidence build run mismatch');
  validateRun(run, evidence.source, repo, true);
  assert.equal(await deps.readTag(entry.tag), evidence.source, 'Published tag moved');
  if (!deps.feedsEnabled) return;

  // Bind reads to a single registry revision. A direct/manual follow-up must
  // prove approval too, including that the candidate has not been withdrawn.
  const registry = await deps.readRegistry();
  const plan = reconcile(registry, {}, repo);
  assert.deepEqual(registry.releases.find(e => e.tag === entry.tag), entry, 'Release is unapproved, withdrawn or changed');
  for (const selected of new Set([plan.stable, plan.beta])) {
    validatePublished(selected, await deps.readRelease(selected.tag), repo);
    assert.equal(await deps.readTag(selected.tag), selected.evidence.source, 'Selected feed tag moved');
  }
  await deps.verifyFeeds({ stable: Buffer.from(plan.stable.manifestText), beta: Buffer.from(plan.beta.manifestText) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY;
  assert.equal(repo, 'doughknee/myscrollr');
  const release = ghJSON('api', `repos/${repo}/releases/tags/${encodeURIComponent(process.env.TAG)}`);
  let ready = false;
  if (allowedEffects(release, true).announce) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrollr-effects-'));
    try {
      await verifyDesktopEffects(release, {
        repo, feedsEnabled: process.env.CHANNEL_FEEDS_ENABLED === 'true',
        readAsset: async name => {
          gh('release', 'download', release.tag_name, '--repo', repo, '--pattern', name, '--dir', dir);
          return readFile(path.join(dir, name));
        },
        readRun: async id => ghJSON('api', `repos/${repo}/actions/runs/${id}`),
        readTag: async tag => ghJSON('api', `repos/${repo}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`).sha,
        readRelease: async tag => ghJSON('api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`),
        readRegistry: async () => {
          const head = ghJSON('api', `repos/${repo}/git/ref/heads/${metadataBranch}`).object.sha;
          const file = ghJSON('api', `repos/${repo}/contents/index.json?ref=${head}`);
          return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        },
        verifyFeeds: verifyPublicFeeds,
      });
      ready = true;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const effects = allowedEffects(release, ready);
  const eligible = process.argv[2] === 'kb' ? effects.kb : effects.announce;
  await appendFile(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
  await writeFile('release-event.json', JSON.stringify(release));
  await writeFile('body.raw', release.body || '');
  console.log(eligible ? 'Verified publication is eligible for this workflow' : 'No stable side effects for this release');
}
