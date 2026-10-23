import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('failed private package installs never print the credential or child output', () => {
  const token = 'synthetic-private-token'
  const output = []
  const source = readFileSync(
    new URL('./ensure-motion-plus.mjs', import.meta.url),
    'utf8',
  ).replace(/^import .*$/gm, '')
  assert.throws(
    () =>
      runInNewContext(source, {
        join,
        existsSync: () => false,
        console: { log: (s) => output.push(s), error: (s) => output.push(s) },
        process: {
          cwd: () => '/fixture',
          execPath: '/node',
          env: { MOTION_PLUS_TOKEN: token, npm_execpath: '/npm.js' },
          exit: (status) => {
            throw new Error(`exit ${status}`)
          },
        },
        execFileSync: (_binary, args, options) => {
          assert.ok(args.includes('--no-save'))
          assert.ok(args.includes('--logs-max=0'))
          assert.equal(options.stdio.join(','), 'ignore,pipe,pipe')
          throw Object.assign(new Error(`failed command ${token}`), {
            status: 1,
            stderr: `registry output ${token}`,
          })
        },
      }),
    /exit 1/,
  )
  assert.ok(output.join('\n').includes('exit 1'))
  assert.ok(!output.join('\n').includes(token))
})
