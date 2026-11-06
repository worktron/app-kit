// Where an extension's manifest sits: at the root of its git checkout, so
// Chrome's Load unpacked takes the checkout itself, and the kit's self-reload,
// which reads the commit from .git under the extension's root, sees each new
// commit. The code lives in a folder the manifest's paths point into, such as
// extension/. For a test in the extension, and for install-host.

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * What is wrong with where `folder`'s manifest sits, one plain sentence each,
 * and an empty list when it is at the root of its git checkout.
 */
export function layoutProblems(folder = '.'): string[] {
  const whole = resolve(folder)
  if (!existsSync(join(whole, 'manifest.json'))) return [`There is no manifest.json in ${whole}: it sits at the root of the extension's repository, and Load unpacked takes that folder`]
  const run = spawnSync('git', ['-C', whole, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (run.status !== 0) return [`${whole} is in no git checkout, so the extension's self-reload sees no commit; load the extension from the checkout it is committed in`]
  const top = realpathSync(run.stdout.trim())
  const here = realpathSync(whole)
  if (top === here) return []
  const below = relative(top, here)
  return [
    `manifest.json is in ${below}/ of the checkout ${top}. Move it to the checkout's root and point its paths (background.service_worker, pages, icons) into ${below}/, so Load unpacked takes the checkout itself and self-reload reads its .git`,
  ]
}
