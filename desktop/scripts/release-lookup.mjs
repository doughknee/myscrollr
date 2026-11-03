// Authenticated, read-only release lookup. Drafts need not have a Git tag yet.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function gh(...args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error(`GitHub operation failed (${error.status ?? error.code}): ${String(error.stderr || '').slice(0,400)}`);
  }
}
export const ghJSON = (...args) => JSON.parse(gh(...args));

export function validateDraftSource(release, sha) {
  if (release?.draft) {
    assert(/^[a-f0-9]{40}$/.test(sha), 'Exact build source required');
    assert.equal(release.target_commitish, sha, 'Draft belongs to another source. Use a new version.');
  }
}

export function readTagCommit(repo, tag, request = ghJSON) {
  let ref;
  try { ref = request('api', `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`); }
  catch (error) {
    if (error.message.includes('HTTP 404')) return null;
    throw error;
  }
  assert.equal(ref.ref, `refs/tags/${tag}`, 'Unexpected tag reference');
  // The commit endpoint dereferences annotated as well as lightweight tags.
  return request('api', `repos/${repo}/commits/${encodeURIComponent(`refs/tags/${tag}`)}`).sha;
}

export function readReleaseByTag(repo, tag, request = ghJSON) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repo), 'Repository required');
  assert(typeof tag === 'string' && tag.length > 0, 'Release tag required');
  let release;
  try {
    release = request('api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (!error.message.includes('HTTP 404')) throw error;
    const pages = request('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`);
    const matches = pages.flat().filter(r => r.tag_name === tag);
    assert(matches.length <= 1, 'Ambiguous release tag');
    if (!matches.length) return null;
    // Re-read by immutable ID so assets and draft/source metadata are current.
    assert(Number.isSafeInteger(matches[0].id), 'Invalid release ID');
    release = request('api', `repos/${repo}/releases/${matches[0].id}`);
  }
  assert.equal(release.tag_name, tag, 'Release tag changed during lookup');
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = readReleaseByTag(process.argv[2], process.argv[3]);
  if (process.argv[4]) validateDraftSource(release, process.argv[4]);
  console.log(JSON.stringify(release && { draft: release.draft, target_commitish: release.target_commitish, tag_name: release.tag_name }));
}
