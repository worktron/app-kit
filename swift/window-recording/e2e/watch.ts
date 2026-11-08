// The live tests' window watcher (window-watch.swift), built and started before a test's window can exist.
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'

export type Watch = {
  /** Ends the watch and gives each sighting of a window of the test's that touched one of the owner's displays. */
  stop: () => Promise<string[]>
}

/** Watches the windows of programs named `name` started from now on; the hidden display is the one holding left, top. */
export async function watchWindows(folder: string, name: string, left: number, top: number): Promise<Watch> {
  const program = join(folder, 'window-watch')
  const built = spawnSync('swiftc', ['-O', join(import.meta.dir, 'window-watch.swift'), '-o', program], { encoding: 'utf8' })
  if (built.status !== 0) throw new Error(`window-watch did not build: ${built.stderr}`)
  const watcher = spawn(program, [name, String(left), String(top)], { stdio: ['pipe', 'pipe', 'inherit'] })
  watcher.stdout.setEncoding('utf8')
  let said = ''
  const ended = new Promise<void>((resolve) => watcher.on('close', () => resolve()))
  await new Promise<void>((resolve, reject) => {
    watcher.stdout.on('data', (chunk: string) => {
      said += chunk
      if (said.includes('watching')) resolve()
    })
    watcher.on('close', () => reject(new Error(`window-watch ended at once: ${said}`)))
  })
  return {
    stop: async () => {
      watcher.stdin.end()
      await ended
      return said.split('\n').filter((line) => line.startsWith('outside '))
    },
  }
}
