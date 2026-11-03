// Release safety shared by build/finalize/announcement workflows. No mutation on import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { validateSource } from './release-source.mjs';
export { gh, ghJSON } from './release-lookup.mjs';

export const targets = ['windows-x86_64', 'darwin-aarch64', 'linux-x86_64'];
const binary = /(?:\.exe|\.msi|\.dmg|\.AppImage|\.deb|\.rpm|\.app\.tar\.gz)$/;
const installer = {
  'windows-x86_64': [/\.msi$/, /-setup\.exe$/],
  'darwin-aarch64': [/\.dmg$/, /\.app\.tar\.gz$/],
  'linux-x86_64': [/\.AppImage$/],
};

export function releaseIdentity(tag) {
  assert.equal(typeof tag, 'string', 'Release tag required');
  const version = tag.startsWith('desktop-v') ? tag.slice(9) : '';
  assert(semver.valid(version) && !version.startsWith('v'), 'Expected desktop-v<SemVer>');
  return { version, channel: semver.prerelease(version) ? 'beta' : 'stable' };
}

export function validateRelease(release, { draft } = {}) {
  const identity = releaseIdentity(release.tag_name);
  assert.equal(release.prerelease, identity.channel === 'beta', 'Tag/prerelease flag mismatch');
  if (draft !== undefined) assert.equal(release.draft, draft, draft ? 'Release must be a draft' : 'Release must be published');
  return identity;
}

export function validateRun(run, sha, repo, completed = false, version) {
  assert(/^[a-f0-9]{40}$/.test(sha), 'Resolved source SHA required');
  assert.equal(run.path, '.github/workflows/desktop-release.yml', 'Wrong build workflow');
  assert.equal(run.repository?.full_name, repo, 'Wrong build repository');
  assert.equal(run.head_repository?.full_name, repo, 'Fork builds cannot publish');
  assert.equal(run.head_sha, sha, 'Build source does not match release tag');
  validateSource(run.head_branch, version);
  assert(['push', 'workflow_dispatch'].includes(run.event), 'Unapproved build event');
  if (completed) {
    assert.equal(run.status, 'completed', 'Build still running');
    assert.equal(run.conclusion, 'success', 'Build did not succeed');
  }
}

export function validateTagCommit(actual, expected, draft) {
  assert(actual === expected || (actual === null && draft), 'Git tag does not point to the verified build source');
}

export function releaseAssetName(raw, repo, tag, legacy = false) {
  const u = new URL(raw);
  assert.equal(raw, u.href, 'Noncanonical updater URL');
  assert(u.origin === 'https://github.com' && !u.username && !u.password && !u.search && !u.hash, 'Unexpected updater URL');
  const segments = u.pathname.split('/').map(decodeURIComponent);
  const allowed = legacy && repo === 'doughknee/myscrollr' ? [repo, 'brandon-relentnet/myscrollr'] : [repo];
  assert(segments.length === 7 && allowed.includes(`${segments[1]}/${segments[2]}`) &&
    segments[3] === 'releases' && segments[4] === 'download' && segments[5] === tag, 'Updater URL must bind to this release');
  const name = segments[6];
  assert(name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..', 'Unsafe updater asset');
  return name;
}

export async function validateVersions(root) {
  const json = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  const config = await json('src-tauri/tauri.conf.json');
  const pkg = await json('package.json');
  const lock = await json('package-lock.json');
  const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = await readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
  const version = config.version;
  assert(semver.valid(version), 'Invalid desktop version');
  const wixVersion = config.bundle?.windows?.wix?.version;
  if (wixVersion) {
    const parsed = semver.parse(version);
    assert(new RegExp(`^${parsed.major}\\.${parsed.minor}\\.${parsed.patch}\\.\\d+$`).test(wixVersion), 'MSI numeric version must match app major/minor/patch');
    assert(Number(wixVersion.split('.')[3]) <= 65535, 'MSI build number exceeds limit');
  }
  for (const [label, actual] of Object.entries({ package: pkg.version, npmLock: lock.version,
    npmRoot: lock.packages[''].version, cargo: /^version = "([^"]+)"/m.exec(cargo)?.[1],
    cargoLock: /name = "scrollr-desktop"\r?\nversion = "([^"]+)"/.exec(cargoLock)?.[1] })) {
    assert.equal(actual, version, `${label} version drift`);
  }
  return version;
}

async function filesBelow(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? filesBelow(path.join(dir, e.name)) :
    e.isFile() && binary.test(e.name) ? [path.join(dir, e.name)] : []))).flat();
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function recordProof(root, target, dir, env) {
  assert(targets.includes(target), 'Unknown target');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'Build SHA required');
  assert(/^\d+$/.test(env.GITHUB_RUN_ID || ''), 'Build run required');
  const version = await validateVersions(root);
  const assets = {};
  const files = await filesBelow(dir);
  if (target === 'windows-x86_64') files.push(path.resolve(dir, '..', 'scrollr-desktop.exe'));
  for (const file of files) {
    // tauri-action adds the architecture when uploading the local mac archive.
    const localName = path.basename(file);
    const name = target === 'darwin-aarch64' ? localName.replace(/\.app\.tar\.gz$/, '_aarch64.app.tar.gz') : localName;
    assert(!assets[name], `Duplicate artifact name ${name}`);
    assets[name] = await sha256(file);
  }
  for (const pattern of installer[target]) assert(Object.keys(assets).some(n => pattern.test(n)), `Missing ${target} installer ${pattern}`);
  return { schema: 1, version, target, source: env.GITHUB_SHA, runId: String(env.GITHUB_RUN_ID), assets };
}

// API release objects and Actions proof artifacts are supplied by the finalizer.
// Only the bound build run's proof files are trusted; a release-uploaded proof is not.
export async function validateArtifacts({ release, run, sha, repo, dir, proofs, publicKey, verifySignature }) {
  const { version } = validateRelease(release);
  validateRun(run, sha, repo, true, version);
  const names = release.assets.map(a => a.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate release asset');
  const hashes = new Map();
  for (const target of targets) {
    const matching = proofs.filter(p => p.target === target);
    assert.equal(matching.length, 1, `Expected one ${target} build proof`);
    const proof = matching[0];
    assert.equal(proof.schema, 1);
    assert.equal(proof.source, sha, 'Proof source mismatch');
    assert.equal(proof.version, version, 'Proof version mismatch');
    assert.equal(proof.runId, String(run.id), 'Proof build run mismatch');
    for (const pattern of installer[target]) assert(Object.keys(proof.assets).some(n => pattern.test(n)), `Missing ${target} installer`);
    for (const [name, hash] of Object.entries(proof.assets)) {
      assert.equal(path.basename(name), name, 'Unsafe asset name');
      assert(!hashes.has(name), 'Artifact appears in multiple target proofs');
      assert(names.includes(name), `Missing built artifact ${name}`);
      assert.equal(await sha256(path.join(dir, name)), hash, `Final bytes differ from build: ${name}`);
      hashes.set(name, hash);
    }
  }
  for (const name of names.filter(n => binary.test(n))) assert(hashes.has(name), `Unproven installer ${name}`);
  const manifest = JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, version, 'Manifest version mismatch');
  for (const target of [...targets, 'windows-x86_64-msi', 'windows-x86_64-nsis']) assert(manifest.platforms?.[target], `Missing updater target ${target}`);
  const extensions = { 'windows-x86_64': /\.msi$/, 'windows-x86_64-msi': /\.msi$/,
    'windows-x86_64-nsis': /-setup\.exe$/, 'darwin-aarch64': /\.app\.tar\.gz$/,
    'darwin-aarch64-app': /\.app\.tar\.gz$/, 'linux-x86_64': /\.AppImage$/, 'linux-x86_64-appimage': /\.AppImage$/,
    'linux-x86_64-deb': /\.deb$/, 'linux-x86_64-rpm': /\.rpm$/ };
  const verified = new Set();
  for (const [target, entry] of Object.entries(manifest.platforms)) {
    assert(extensions[target], `Unqualified updater target ${target}`);
    const name = releaseAssetName(entry.url, repo, release.tag_name);
    assert(extensions[target].test(name) && hashes.has(name), `Wrong artifact for ${target}`);
    const signature = (await readFile(path.join(dir, `${name}.sig`), 'utf8')).trim();
    assert.equal(entry.signature, signature, `Manifest signature mismatch: ${name}`);
    assert(signature.length > 20, 'Empty updater signature');
    if (!verified.has(name)) {
      await verifySignature(path.join(dir, name), signature, publicKey);
      verified.add(name);
    }
  }
  hashes.set('latest.json', await sha256(path.join(dir, 'latest.json')));
  return { schema: 1, version, source: sha, runId: String(run.id), assets: Object.fromEntries(hashes) };
}

export async function minisign(file, signature, publicKey) {
  const sigPath = `${file}.verify.minisig`;
  const keyPath = `${file}.verify.pub`;
  await writeFile(sigPath, Buffer.from(signature, 'base64'));
  await writeFile(keyPath, Buffer.from(publicKey, 'base64'));
  execFileSync('minisign', ['-Vm', file, '-x', sigPath, '-p', keyPath], { stdio: 'pipe' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (command === 'version') console.log(await validateVersions(root));
  else if (command === 'record') {
    const [target, dir, out] = args;
    const proof = await recordProof(root, target, dir, process.env);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(proof, null, 2));
  } else if (command === 'verify-signature') {
    const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    await minisign(args[0], (await readFile(`${args[0]}.sig`, 'utf8')).trim(), config.plugins.updater.pubkey);
  } else throw new Error('Unknown release-policy command');
}
