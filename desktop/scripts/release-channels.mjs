// One protected metadata branch, one atomic commit for both channels. No writes by default.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { ghJSON, validateRelease, releaseIdentity, releaseAssetName, targets } from './release-policy.mjs';

export const metadataBranch = 'desktop-updates';
const digest = text => createHash('sha256').update(text).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function validateEntry(entry, repo) {
  const identity = releaseIdentity(entry.tag);
  assert.equal(entry.manifest?.version, identity.version, 'Channel version mismatch');
  assert.equal(entry.evidence?.version, identity.version, 'Evidence version mismatch');
  assert.equal(entry.evidence.schema, 1, 'Unknown proof schema');
  assert(/^[a-f0-9]{40}$/.test(entry.evidence.source), 'Missing source binding');
  assert(/^\d+$/.test(entry.evidence.runId), 'Missing build binding');
  assert.equal(digest(entry.manifestText), entry.evidence.assets['latest.json'], 'Manifest changed after verification');
  assert.deepEqual(JSON.parse(entry.manifestText), entry.manifest, 'Manifest does not match verified bytes');
  assert.equal(typeof entry.withdrawn, 'boolean');
  for (const target of [...targets, 'windows-x86_64-msi', 'windows-x86_64-nsis']) {
    assert(entry.manifest.platforms?.[target], `Incomplete cohort: ${target}`);
  }
  for (const entryPlatform of Object.values(entry.manifest.platforms)) {
    const name = releaseAssetName(entryPlatform.url, repo, entry.tag);
    assert(/^[a-f0-9]{64}$/.test(entry.evidence.assets[name]), 'Unproven updater asset');
    assert(typeof entryPlatform.signature === 'string' && entryPlatform.signature.length > 20, 'Missing signature');
  }
  return identity;
}

export function reconcile(previous, { approve, withdraw } = {}, repo) {
  assert.equal(previous.schema, 1, 'Unknown channel registry schema');
  const entries = structuredClone(previous.releases);
  assert(Array.isArray(entries), 'Missing release registry');
  assert.equal(new Set(entries.map(e => e.tag)).size, entries.length, 'Duplicate release');
  for (const entry of entries) validateEntry(entry, repo);
  if (approve) {
    validateEntry(approve, repo);
    const existing = entries.find(e => e.tag === approve.tag);
    // Retries cannot change approved bytes or silently restore a withdrawn build.
    if (existing) assert.deepEqual(existing, approve, 'Approved release is immutable or withdrawn');
    else entries.push(approve);
  }
  if (withdraw) {
    const entry = entries.find(e => e.tag === withdraw);
    assert(entry, 'Cannot withdraw an unknown release');
    entry.withdrawn = true;
  }
  entries.sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version) || a.tag.localeCompare(b.tag));
  // SemVer ignores build metadata: ambiguous equal-precedence versions are forbidden.
  for (let i = 1; i < entries.length; i++) assert(!semver.eq(entries[i - 1].manifest.version, entries[i].manifest.version), 'Ambiguous release precedence');
  const approved = entries.filter(e => !e.withdrawn);
  const stable = approved.find(e => !semver.prerelease(e.manifest.version));
  const beta = approved[0];
  assert(stable && beta, 'A verified Stable baseline is required before enabling channel feeds');
  return { registry: { schema: 1, releases: entries }, stable, beta };
}

export function validatePublished(entry, release, repo) {
  validateEntry(entry, repo);
  validateRelease(release, { draft: false });
  assert.equal(release.tag_name, entry.tag);
  assert.equal(release.target_commitish, entry.evidence.source, 'Published source changed');
  for (const [name, hash] of Object.entries(entry.evidence.assets)) {
    const matches = release.assets.filter(a => a.name === name);
    assert.equal(matches.length, 1, `Missing/duplicate verified asset ${name}`);
    assert.equal(matches[0].digest, `sha256:${hash}`, `Published bytes changed: ${name}`);
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  assert.equal(repo, 'doughknee/myscrollr', 'Unexpected channel repository');
  const apply = process.argv.includes('--apply');
  const out = path.resolve(process.env.CHANNEL_PLAN_DIR || 'channel-plan');
  let head = null;
  let baseTree;
  let previous = { schema: 1, releases: [] };
  try {
    head = ghJSON('api', `repos/${repo}/git/ref/heads/${metadataBranch}`).object.sha;
  } catch (error) {
    if (!error.message.includes('HTTP 404')) throw error;
    assert(!apply, 'Metadata branch must be bootstrapped and protected separately before applying');
  }
  if (head) {
    baseTree = ghJSON('api', `repos/${repo}/git/commits/${head}`).tree.sha;
    const file = ghJSON('api', `repos/${repo}/contents/index.json?ref=${head}`);
    previous = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  }
  let approve;
  if (process.env.TAG) {
    assert(/^\d+$/.test(process.env.BUILD_RUN_ID || ''), 'Verified build run required');
    const dir = path.join(process.env.RUNNER_TEMP, `release-verify-${process.env.BUILD_RUN_ID}`);
    const evidence = JSON.parse(await readFile(path.join(dir, 'verification.json'), 'utf8'));
    const manifestText = await readFile(path.join(dir, 'latest.json'), 'utf8');
    approve = { tag: process.env.TAG, withdrawn: false, evidence, manifestText, manifest: JSON.parse(manifestText) };
    assert.equal(evidence.runId, process.env.BUILD_RUN_ID);
  }
  assert(!(approve && process.env.WITHDRAW_TAG), 'Approve and withdraw are separate actions');
  const plan = reconcile(previous, { approve, withdraw: process.env.WITHDRAW_TAG }, repo);
  for (const entry of new Set([approve, plan.stable, plan.beta].filter(Boolean))) {
    const release = ghJSON('api', `repos/${repo}/releases/tags/${encodeURIComponent(entry.tag)}`);
    validatePublished(entry, release, repo);
    assert.equal(ghJSON('api', `repos/${repo}/commits/${encodeURIComponent(`refs/tags/${entry.tag}`)}`).sha, entry.evidence.source, 'Published tag moved');
  }
  const files = { 'index.json': json(plan.registry), 'stable.json': plan.stable.manifestText, 'beta.json': plan.beta.manifestText };
  await mkdir(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(out, name), content);
  console.log(`Stable ${plan.stable.manifest.version}; Beta ${plan.beta.manifest.version}; ${apply ? 'apply requested' : 'dry run only'}`);
  if (!apply) return;
  assert(ghJSON('api', `repos/${repo}/branches/${metadataBranch}`).protected, 'Metadata branch must be protected');
  // REST requests use files, never shell interpolation. A non-fast-forward ref update
  // fails if another publisher won; rerun against its registry instead of overwriting it.
  const post = async (endpoint, body, method = 'POST') => {
    const input = path.join(out, 'request.json');
    await writeFile(input, json(body));
    return JSON.parse(execFileSync('gh', ['api', '--method', method, endpoint, '--input', input], { encoding: 'utf8', timeout: 60_000 }));
  };
  const tree = await post(`repos/${repo}/git/trees`, { base_tree: baseTree,
    tree: Object.entries(files).map(([name, content]) => ({ path: name, mode: '100644', type: 'blob', content })) });
  if (tree.sha === baseTree) { console.log('Feeds already reconciled'); return; }
  const commit = await post(`repos/${repo}/git/commits`, { message: `Reconcile desktop channels: Stable ${plan.stable.manifest.version}, Beta ${plan.beta.manifest.version}`, tree: tree.sha, parents: [head] });
  await post(`repos/${repo}/git/refs/heads/${metadataBranch}`, { sha: commit.sha, force: false }, 'PATCH');
  console.log(`Atomically advanced both feeds to ${commit.sha}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
