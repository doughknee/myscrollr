// Disposable CI only. Exercises real packages; never copies a user's profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable CI only');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Never install on self-hosted runners');
const root = path.join(process.env.RUNNER_TEMP, 'update-install');
mkdirSync(root, { recursive: true });
const statePath = path.join(root, 'state.json');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 180_000, windowsHide: true, ...options }).trim();
const ps = script => run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`]);
const recovering = process.env.SCROLLR_REHEARSAL_RECOVERY === 'true';
const target = process.platform === 'win32' ? 'windows-x86_64-nsis' : process.platform === 'darwin' ? 'darwin-aarch64' : 'linux-x86_64';
function verifiedPackage(directory, sourceOnly = false) {
  const resolved = path.resolve(directory);
  assert(resolved.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep), 'Inputs must be in runner temp');
  const legacy = sourceOnly && existsSync(path.join(resolved, 'source-integrity.json'));
  const proof = json(path.join(resolved, legacy ? 'source-integrity.json' : 'verification.json'));
  if (legacy) {
    assert.equal(proof.kind, 'legacy-install-source-only');
    assert.equal(proof.version, '1.7.2');
  }
  const manifestPath = path.join(resolved, 'latest.json');
  assert.equal(hash(manifestPath), proof.assets['latest.json']);
  const manifest = json(manifestPath);
  assert.equal(manifest.version, proof.version);
  const name = decodeURIComponent(new URL(manifest.platforms[target].url).pathname.split('/').at(-1));
  assert.equal(path.basename(name), name);
  const file = path.join(resolved, name);
  assert.equal(hash(file), proof.assets[name]);
  return { file, version: proof.version, source: proof.source, runId: proof.runId, legacy };
}
function windowsInfo(executable) {
  process.env.REHEARSAL_EXE = executable;
  return JSON.parse(ps(`$s = Get-AuthenticodeSignature -LiteralPath $env:REHEARSAL_EXE; @{version=(Get-Item -LiteralPath $env:REHEARSAL_EXE).VersionInfo.ProductVersion; status=[string]$s.Status; publisher=$s.SignerCertificate.Subject; timestamp=($null -ne $s.TimeStamperCertificate)} | ConvertTo-Json -Compress`));
}
function verifyInstalled(state, version) {
  if (process.platform === 'win32') {
    const info = windowsInfo(state.executable);
    assert.equal(info.version, version);
    assert.equal(info.status, 'Valid');
    assert(info.timestamp);
    assert.equal(info.publisher, state.publisher);
  } else if (process.platform === 'darwin') {
    assert.equal(run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(state.app, 'Contents/Info.plist')]), version);
    run('codesign', ['--verify', '--deep', '--strict', state.app]);
    run('spctl', ['--assess', '--type', 'execute', state.app]);
  } else {
    assert.equal(hash(state.executable), hash(version === state.sourceVersion ? state.source.file : state.destination.file));
  }
}
function verifyPreferences(state) {
  const actual = json(state.preferences);
  for (const [key, value] of Object.entries(state.seed)) assert.deepEqual(actual[key], value, `Lost preference ${key}`);
}
async function launchAndStop(state, phase) {
  let executable = state.executable;
  if (process.platform === 'linux') {
    const extracted = path.join(root, `extract-${phase}`);
    mkdirSync(extracted);
    run(executable, ['--appimage-extract'], { cwd: extracted, maxBuffer: 32 * 1024 * 1024 });
    executable = path.join(extracted, 'squashfs-root/AppRun');
  }
  // An NSIS update may have auto-relaunched this same installation. Stop only
  // that exact path, then launch it explicitly for the restart check.
  if (process.platform === 'win32') {
    process.env.REHEARSAL_EXE = executable;
    ps("Get-Process | Where-Object { $_.ProcessName -eq 'scrollr-desktop' -and $_.Path -eq $env:REHEARSAL_EXE } | Stop-Process -Force");
  }
  const child = spawn(process.platform === 'linux' ? 'dbus-run-session' : executable,
    process.platform === 'linux' ? ['--', executable] : [],
    { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let error;
  child.on('error', e => { error = e; });
  child.stdout.on('data', bytes => appendFileSync(path.join(root, `${phase}.log`), bytes));
  child.stderr.on('data', bytes => appendFileSync(path.join(root, `${phase}.log`), bytes));
  try {
    for (let i = 0; i < 30; i++) {
      await delay(1000);
      assert(!error && child.exitCode === null && child.signalCode === null, `Packaged ${phase} app exited: ${error || child.exitCode}`);
    }
    if (process.platform === 'win32') {
      process.env.REHEARSAL_PID = String(child.pid);
      assert.notEqual(ps('(Get-Process -Id $env:REHEARSAL_PID).MainWindowHandle'), '0', 'Native window missing');
    } else if (process.platform === 'linux') run('xdotool', ['search', '--onlyvisible', '--name', '^Scrollr']);
    verifyPreferences(state);
  } finally {
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') run('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
      await delay(1000);
    }
  }
}

if (process.argv[2] === 'prepare') {
  assert(!existsSync(statePath), 'Runner already prepared');
  const source = verifiedPackage(process.env.SCROLLR_REHEARSAL_SOURCE_DIR, true);
  const destination = verifiedPackage(process.env.SCROLLR_REHEARSAL_DIR);
  const state = { source, destination, sourceVersion: source.version,
    seed: { 'scrollr:store-migrated': true, 'scrollr:update-channel': recovering ? 'stable' : 'beta', 'scrollr:rehearsal-marker': 'synthetic-profile-no-credentials' } };
  if (recovering) {
    assert.equal(source.version, '1.8.0-beta.1');
    assert.equal(destination.version, '1.7.3');
    state.seed['scrollr:settings'] = { appearance: { themeFamily: 'catppuccin', themeMode: 'dark' }, ticker: { scrollMode: 'pages' }, window: { tickerDisplays: { 'synthetic-disconnected-display': { mode: 'grid', readingSize: 125 } } } };
  }
  if (process.platform === 'win32') {
    state.executable = path.join(process.env.LOCALAPPDATA, 'Scrollr/scrollr-desktop.exe');
    assert(!existsSync(state.executable), 'Runner must not have an existing installation');
    process.env.REHEARSAL_INSTALLER = source.file;
    ps(`$p = Start-Process -FilePath $env:REHEARSAL_INSTALLER -ArgumentList '/S' -PassThru -WindowStyle Hidden; if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'Installer timed out' }; if ($p.ExitCode -ne 0) { throw 'Installer failed' }`);
    state.publisher = windowsInfo(state.executable).publisher;
    assert(state.publisher, 'Signed publisher required');
    state.preferences = path.join(process.env.APPDATA, 'com.scrollr.desktop/scrollr.json');
  } else if (process.platform === 'darwin') {
    run('tar', ['-xzf', source.file, '-C', root]);
    state.app = path.join(root, 'Scrollr.app');
    const executableName = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(state.app, 'Contents/Info.plist')]);
    assert.equal(path.basename(executableName), executableName);
    state.executable = path.join(state.app, 'Contents/MacOS', executableName);
    state.preferences = path.join(os.homedir(), 'Library/Application Support/com.scrollr.desktop/scrollr.json');
  } else {
    state.executable = path.join(root, 'Scrollr.AppImage');
    copyFileSync(source.file, state.executable);
    chmodSync(state.executable, 0o755);
    state.preferences = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'com.scrollr.desktop/scrollr.json');
  }
  assert(!existsSync(state.preferences), 'Never overwrite an existing profile');
  mkdirSync(path.dirname(state.preferences), { recursive: true });
  writeFileSync(state.preferences, JSON.stringify(state.seed));
  verifyInstalled(state, source.version);
  await launchAndStop(state, 'source');
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`Prepared real ${source.version} installation and synthetic Beta preference.`);
} else if (process.argv[2] === 'finish') {
  const state = json(statePath);
  // Windows installer is asynchronous; exit 0 from the harness isn't success.
  let installed = false;
  for (let i = 0; i < 120; i++) {
    try { verifyInstalled(state, state.destination.version); installed = true; break; }
    catch { await delay(1000); }
  }
  assert(installed, 'Installed target did not become valid within 120 seconds');
  verifyPreferences(state);
  await launchAndStop(state, 'target');
  const result = { source: state.sourceVersion, target: state.destination.version, platform: process.platform,
    nativeInstaller: 'passed', packagedRestart: 'passed', syntheticPreferences: 'retained',
    limitation: 'Mock updater host with current locked plugin; not the source app controller, public HTTPS feeds, login or hardware testing.',
    recovery: recovering, legacySource: state.source.legacy };
  writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} else throw Error('Use prepare or finish');
