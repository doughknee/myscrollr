// Ensures the Motion+ package (motion-plus) is installed WITHOUT its
// licensed download URL ever living in package.json — this repo is
// public and the URL embeds the private Motion+ auth token.
//
// How it works: motion-plus is intentionally absent from package.json.
// This script runs from predev/prebuild (after npm install / npm ci has
// populated node_modules) and, if motion-plus is missing, installs it
// with --no-save using the token from the MOTION_PLUS_TOKEN environment
// variable. `npm ci` wipes node_modules, so deploys must set
// MOTION_PLUS_TOKEN (generate one at https://plus.motion.dev — and set
// it in the deploy platform's env, never in git).

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (existsSync(join(root, 'node_modules', 'motion-plus', 'package.json'))) {
  console.log('[ensure-motion-plus] motion-plus present, skipping')
  process.exit(0)
}

const token = process.env.MOTION_PLUS_TOKEN
if (!token) {
  console.error(
    '[ensure-motion-plus] motion-plus is not installed and MOTION_PLUS_TOKEN is not set.\n' +
      '  Generate a token at https://plus.motion.dev and export MOTION_PLUS_TOKEN.\n' +
      '  (The site imports AnimateNumber from motion-plus/react; the build will fail without it.)',
  )
  process.exit(1)
}

const url = `https://api.motion.dev/registry?package=motion-plus&version=latest&token=${token}`
console.log('[ensure-motion-plus] installing motion-plus (--no-save)…')

// Invoking npm portably is fiddlier than it looks on Windows:
//   - bare 'npm' → spawnSync ENOENT, because the shim is `npm.cmd`
//   - 'npm.cmd'  → EINVAL on Node >=20.12, which refuses to execFile
//                  .cmd/.bat without a shell (the CVE-2024-27980 fix)
//   - shell:true → cmd.exe reads the `&` in the registry URL as a
//                  command separator and mangles the argument
// So call npm's JS entrypoint with the node binary already running us.
// npm_execpath is always set inside an npm lifecycle script, which is
// the only way this file runs (predev / prebuild).
const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error(
    '[ensure-motion-plus] npm_execpath is not set — run this via `npm run dev`/`npm run build`, not directly.',
  )
  process.exit(1)
}

// The token rides in argv, so ANY spawn failure prints the full
// command line — Node dumps `spawnargs` on error. That would leak the
// licensed token into CI logs and terminal scrollback, defeating the
// point of keeping it out of package.json. Swallow the original error
// and re-report it redacted.
try {
  execFileSync(
    process.execPath,
    [npmCli, 'install', '--no-save', '--no-audit', '--no-fund', url],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  )
} catch (err) {
  console.error(
    `[ensure-motion-plus] npm install failed (${err?.code ?? err?.message ?? 'unknown error'}).\n` +
      '  The Motion+ registry URL is redacted here on purpose — it embeds MOTION_PLUS_TOKEN.\n' +
      '  Check that MOTION_PLUS_TOKEN is valid and that npm is on PATH.',
  )
  process.exit(1)
}
console.log('[ensure-motion-plus] installed')
