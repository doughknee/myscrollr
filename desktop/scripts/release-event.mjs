import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghJSON, validateRelease } from './release-policy.mjs';

export function allowedEffects(release) {
  if (release.draft || release.prerelease || !release.published_at) return { announce: false, kb: false };
  if (!release.tag_name?.startsWith('desktop-v')) return { announce: false, kb: true };
  try {
    const { channel } = validateRelease(release, { draft: false });
    return { announce: channel === 'stable', kb: channel === 'stable' };
  } catch { return { announce: false, kb: false }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = ghJSON('api', `repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(process.env.TAG)}`);
  const effects = allowedEffects(release);
  const eligible = process.argv[2] === 'kb' ? effects.kb : effects.announce;
  await appendFile(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
  await writeFile('release-event.json', JSON.stringify(release));
  await writeFile('body.raw', release.body || '');
  console.log(eligible ? 'Published release is eligible for this workflow' : 'No stable side effects for this release');
}
