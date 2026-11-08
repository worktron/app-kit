import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `app-kit extension dashboard sign-in` opens Google Chrome for the owner to type their password into. Run by a thread,
// it starts nothing: it prints the line for the owner and exits. A stand-in `open` first on PATH records any call.
function signInAs(thread: Record<string, string>) {
  // A space and a quote in the folder's name, which the printed line must keep as one word for the owner's shell.
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "owner's dashboard ")))
  const bin = join(folder, 'bin')
  mkdirSync(bin)
  const calls = join(folder, 'open-calls')
  // The command runs with HOME set to the folder, so the stand-in finds it there whatever its name holds.
  writeFileSync(join(bin, 'open'), '#!/bin/sh\necho "$@" >> "$HOME/open-calls"\n')
  chmodSync(join(bin, 'open'), 0o755)
  // The test's own environment names its thread, so the one the command sees is built here, holding only the variable under test.
  const { METAMAX_JOB_ID: _job, AI_AGENT: _agent, ...env } = process.env
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, '../../bin/app-kit.ts'), 'extension', 'dashboard', 'sign-in'], {
    cwd: folder,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...env, ...thread, HOME: folder, XDG_STATE_HOME: join(folder, 'state'), PATH: `${bin}:${env.PATH}` },
  })
  return { folder, status: run.exitCode, out: run.stdout.toString(), opened: existsSync(calls) }
}

test('a metamax thread gets the line for the owner and no Chrome', () => {
  const run = signInAs({ METAMAX_JOB_ID: 'thread-under-test' })
  expect(run.opened).toBe(false)
  expect(run.status).toBe(1)
  expect(run.out).toContain('METAMAX_JOB_ID is set')
  expect(run.out).toContain(`cd '${run.folder.replaceAll("'", "'\\''")}' && bun run app-kit extension dashboard sign-in`)
})

test('an agent named only by AI_AGENT gets the same', () => {
  const run = signInAs({ AI_AGENT: 'agent-under-test' })
  expect(run.opened).toBe(false)
  expect(run.status).toBe(1)
  expect(run.out).toContain('AI_AGENT is set')
})

test("the owner's own run reaches open, so the stand-in would have caught a thread's", () => {
  const run = signInAs({})
  expect(run.opened).toBe(true)
  expect(run.status).toBe(0)
})
