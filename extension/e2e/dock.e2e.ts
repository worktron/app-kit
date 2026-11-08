// The kit's fixture extension loaded through the harness, watched in macOS's application list (test/applications.ts).
// Playwright's own Chromium, the only one that loads extensions, checks in as a Dock app ("Foreground") and turns
// itself into a background one some 35ms later, which is the icon that flashes; the harness's copy must never be
// Foreground. The harness makes the test's own copy, in a scratch folder, so only the Chromium this test starts is
// watched, never one another thread's test starts from the copy every checkout shares.
// Run with `bun test ./extension/e2e/dock.e2e.ts`, which scripts/gates.sh does.

import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchExtension } from '../harness/index.ts'
import { type Seen, watchApplications } from '../../test/applications.ts'

test.if(process.platform === 'darwin')("the harness's Chromium loads the extension and never shows in the Dock", async () => {
  // Resolved, since macOS names a process's executable by its real path, under /private.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-extension-dock-')))
  let apps: Seen[]
  try {
    const copies = join(scratch, 'chromium')
    const watch = await watchApplications(copies)
    try {
      const ext = await launchExtension({ source: join(import.meta.dir, '../test/fixture'), chromiumCopyFolder: copies })
      try {
        expect(ext.worker.url()).toStartWith(`chrome-extension://${ext.extensionId}/`)
      } finally {
        await ext.close()
      }
      await watch.allEnded()
    } finally {
      watch.stop()
    }
    apps = [...watch.seen.values()]
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  // The copy was seen at all, so a watch that hears nothing cannot pass.
  expect(apps.length).toBeGreaterThan(0)
  expect(apps.flatMap((app) => app.types)).not.toContain('Foreground')
}, 120_000)
