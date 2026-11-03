// Read-only pre-activation inventory. No GitHub write operation or --apply mode exists.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gh, ghJSON, minisign, releaseAssetName, targets } from './release-policy.mjs';
import { selectLegacyStable, validateLegacyManifest } from './repair-desktop-latest.mjs';
import { metadataBranch } from './release-channels.mjs';

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--out', 'Use --out <local directory>; this command never activates feeds');
const out = path.resolve(args[1]);
const repo = 'doughknee/myscrollr';
await mkdir(out, { recursive: true });
const save = async (name, value) => writeFile(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
function optionalGet(endpoint) {
  try { return ghJSON('api', endpoint); }
  catch (error) { if (error.message.includes('HTTP 404')) return null; throw error; }
}
async function hash(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function probe(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const body = Buffer.from(await response.arrayBuffer());
  return { requestedURL: url, finalURL: response.url, status: response.status, bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    headers: Object.fromEntries(['cache-control', 'etag', 'age', 'expires', 'content-type', 'access-control-allow-origin', 'x-cache'].map(k => [k, response.headers.get(k)])) };
}

const repository = ghJSON('api', `repos/${repo}`);
const branch = optionalGet(`repos/${repo}/branches/${metadataBranch}`);
const rules = ghJSON('api', '--paginate', '--slurp', `repos/${repo}/rules/branches/${metadataBranch}?per_page=100`).flat();
const variable = optionalGet(`repos/${repo}/actions/variables/DESKTOP_CHANNEL_FEEDS_ENABLED`);
const latest = ghJSON('api', `repos/${repo}/releases/latest`);
const published = ghJSON('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`).flat();
const stable = selectLegacyStable(published);
assert(stable, 'No existing stable desktop release');
const prs = [530, 531].map(n => {
  const p = ghJSON('api', `repos/${repo}/pulls/${n}`);
  return { number: n, state: p.state, merged: p.merged, head: p.head.sha, url: p.html_url };
});
const raw = `https://raw.githubusercontent.com/${repo}`;
const control = await probe(`${raw}/${prs[1].head}/desktop/src-tauri/tauri.conf.json`);
const probes = { stable: await probe(`${raw}/${metadataBranch}/stable.json`), beta: await probe(`${raw}/${metadataBranch}/beta.json`),
  rawHostControl: control,
  controlConditional: await probe(control.requestedURL, control.headers.etag ? { 'If-None-Match': control.headers.etag } : {}),
  legacyLatest: await probe(`https://github.com/${repo}/releases/latest/download/latest.json`) };
const runs = ghJSON('api', `repos/${repo}/actions/workflows/desktop-release.yml/runs?head_sha=${stable.target_commitish}&per_page=100`).workflow_runs;
const proofs = runs.map(run => {
  const artifacts = ghJSON('api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`).flatMap(page => page.artifacts);
  const missingTargets = targets.filter(target => !artifacts.some(a => !a.expired && a.name === `release-proof-${target}-${run.head_sha}`));
  return { runId: run.id, source: run.head_sha, branch: run.head_branch, conclusion: run.conclusion, event: run.event,
    artifacts: artifacts.map(a => ({ name: a.name, expired: a.expired })), missingTargets };
});
const report = { checkedAt: new Date().toISOString(), repository: { name: repo, visibility: repository.visibility, defaultBranch: repository.default_branch },
  sourcePRs: prs, metadataBranch: branch ? { sha: branch.commit.sha, protected: branch.protected } : null,
  effectiveRules: rules, activationVariable: variable?.value ?? null, probes,
  legacyLatest: latest.tag_name,
  stable: { tag: stable.tag_name, source: stable.target_commitish, tagSource: ghJSON('api', `repos/${repo}/commits/${encodeURIComponent(`refs/tags/${stable.tag_name}`)}`).sha,
    verificationAssetPresent: stable.assets.some(a => a.name === 'verification.json'), buildEvidence: proofs, integrity: [] },
  qualification: 'PRE_ACTIVATION_ONLY', readyToActivate: false,
  limitations: ['This inventory does not approve a release or create publisher evidence.',
    'Actual feed bytes, publication/cache transitions and workflow write permission cannot be qualified while the feed branch is absent.',
    'Signature validity alone is not run-bound provenance or OS install/upgrade qualification.'] };
await save('qualification.json', report);

// Check the currently distributed bytes separately from eligibility for the new publisher.
const downloads = path.join(out, 'downloads');
await mkdir(downloads, { recursive: true });
gh('release', 'download', stable.tag_name, '--repo', repo, '--pattern', 'latest.json', '--dir', downloads, '--clobber');
const manifestFile = path.join(downloads, 'latest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
validateLegacyManifest(stable, manifest, repo);
const manifestAsset = stable.assets.find(a => a.name === 'latest.json');
assert.equal(`sha256:${await hash(manifestFile)}`, manifestAsset.digest, 'Published manifest digest mismatch');
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
for (const name of new Set(Object.values(manifest.platforms).map(p => releaseAssetName(p.url, repo, stable.tag_name, true)))) {
  const entry = Object.values(manifest.platforms).find(p => releaseAssetName(p.url, repo, stable.tag_name, true) === name);
  for (const pattern of [name, `${name}.sig`]) gh('release', 'download', stable.tag_name, '--repo', repo, '--pattern', pattern, '--dir', downloads, '--clobber');
  const file = path.join(downloads, name);
  const asset = stable.assets.find(a => a.name === name);
  assert.equal(`sha256:${await hash(file)}`, asset.digest, `Published asset digest mismatch: ${name}`);
  const signature = (await readFile(`${file}.sig`, 'utf8')).trim();
  assert.equal(signature, entry.signature, `Published signature differs from manifest: ${name}`);
  await minisign(file, signature, config.plugins.updater.pubkey);
  report.stable.integrity.push({ name, sha256: await hash(file), updaterSignature: 'verified' });
  await save('qualification.json', report);
  console.log(`Verified existing-release digest and updater signature: ${name}`);
}
await save('qualification.json', report);
console.log(`Saved read-only qualification report. Branch exists: ${!!branch}; baseline proof sets: ${proofs.filter(p => !p.missingTargets.length).length}. Not activation approval.`);
