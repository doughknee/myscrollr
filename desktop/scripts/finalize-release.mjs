// Read-only resolve/verify commands. Publication stays an explicit workflow step.
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gh, ghJSON, minisign, targets, validateArtifacts, validateRelease, validateRun, validateTagCommit } from './release-policy.mjs';
import { readReleaseByTag, readTagCommit } from './release-lookup.mjs';
import { verifySourceProtection } from './release-source.mjs';

const repo = process.env.GITHUB_REPOSITORY;
assert(/^[\w.-]+\/[\w.-]+$/.test(repo || ''), 'Repository required');
const tag = process.env.TAG;
const release = readReleaseByTag(repo, tag);
assert(release, 'Release not found, including authenticated drafts');
const identity = validateRelease(release);
const sha = release.target_commitish;
assert(/^[a-f0-9]{40}$/.test(sha), 'Draft must name its exact build SHA; rebuild old unbound drafts');
const tagSHA = readTagCommit(repo, tag);
validateTagCommit(tagSHA, sha, release.draft);
let runId = process.env.BUILD_RUN_ID;
if (!runId) {
  const { workflow_runs: runs } = ghJSON('api', `repos/${repo}/actions/workflows/desktop-release.yml/runs?head_sha=${sha}&per_page=100`);
  for (const run of runs) {
    validateRun(run, sha, repo, false, identity.version);
    const pages = ghJSON('api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    if (pages.flatMap(p => p.jobs).some(j => j.name.startsWith('build') && j.conclusion !== 'skipped')) {
      runId = String(run.id); break;
    }
  }
}
assert(/^\d+$/.test(runId || ''), 'No eligible build run');
const run = ghJSON('api', `repos/${repo}/actions/runs/${runId}`);
validateRun(run, sha, repo, process.argv[2] === 'verify', identity.version);
verifySourceProtection(repo, run.head_branch, identity.version);
if (process.argv[2] === 'resolve') {
  await appendFile(process.env.GITHUB_OUTPUT, `run_id=${runId}\nsha=${sha}\nchannel=${identity.channel}\n`);
  console.log(`Bound ${tag} to ${sha}, build ${runId} (${run.status}/${run.conclusion})`);
} else if (process.argv[2] === 'verify') {
  const dir = path.resolve(process.env.RUNNER_TEMP, `release-verify-${runId}`);
  await mkdir(dir, { recursive: true });
  gh('release', 'download', tag, '--repo', repo, '--dir', dir);
  const proofs = [];
  for (const target of targets) {
    const proofDir = path.join(dir, target);
    gh('run', 'download', runId, '--repo', repo, '--name', `release-proof-${target}-${sha}`, '--dir', proofDir);
    const names = await readdir(proofDir);
    assert.deepEqual(names, ['proof.json'], 'Unexpected proof artifact contents');
    proofs.push(JSON.parse(await readFile(path.join(proofDir, 'proof.json'), 'utf8')));
  }
  const config = JSON.parse(await readFile('desktop/src-tauri/tauri.conf.json', 'utf8'));
  const evidence = await validateArtifacts({ release, run, sha, repo, dir, proofs,
    publicKey: config.plugins.updater.pubkey, verifySignature: minisign });
  await writeFile(path.join(dir, 'verification.json'), JSON.stringify(evidence, null, 2));
  console.log(`Verified source, build proofs, final hashes and updater signatures for ${tag}`);
} else throw new Error('Use resolve or verify');
