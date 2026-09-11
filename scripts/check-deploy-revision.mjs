// Execute the workflow's real revision step: rebuilt release metadata must
// produce a new image tag without changing the source revision or rollback image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
const step = workflow.match(/id: revision\r?\n\s+run: \|\r?\n((?: {10}[^\r\n]*\r?\n)+)/)?.[1]
assert.ok(step, 'Deployment revision step is missing')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const directory = mkdtempSync(join(tmpdir(), 'scrollr-deploy-revision-'))
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
try {
  const tags = []
  for (const [run, attempt] of [['100', '1'], ['100', '2'], ['101', '1']]) {
    const output = join(directory, 'output')
    execFileSync(bash, ['-c', step], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt },
    })
    const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.trim().split('=')))
    unlinkSync(output)
    assert.equal(values.sha, source)
    assert.match(values['image-tag'], /^sha-[0-9a-f]+-/)
    tags.push(values['image-tag'])
  }
  assert.equal(new Set(tags).size, 3, 'Rebuilds and retries must not overwrite earlier images')
  console.log('Deployment revision and immutable rebuild tags verified')
} finally {
  rmSync(join(directory, 'output'), { force: true })
  rmdirSync(directory)
}
