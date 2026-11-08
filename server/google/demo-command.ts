// `app-kit google demo-reset` and `app-kit google demo-grant`: the demo account's inbox and calendar set from a fixture
// file, and the one-time grant that lets the reset do it (server/google/demo.ts says what each does and why).

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { opRead, runByThread } from '../../command-line/index.ts'
import { signIn, withProfile } from '../../command-line/signed-in-chrome.ts'
import { appendLog, stateFolder } from '../../tauri/state.ts'
import { demoChromeFolder, demoConsentAddress, demoGrantItem, readDemoFixtures, readDemoGrant, refreshTokenFor, resetDemoAccount, withDemoAccount } from './demo.ts'

function log(line: string): void {
  appendLog(join(stateFolder('google-demo'), 'google-demo.log'), `${new Date().toISOString()} ${line}`)
}

/** Resets the demo account the fixture file names, holding its lock, and prints what it did. */
async function demoReset(file: string): Promise<void> {
  const fixtures = readDemoFixtures(file)
  const done = await withDemoAccount(fixtures.account, async () => await resetDemoAccount(fixtures, await readDemoGrant(fixtures.account)))
  const line = `${fixtures.account}: ${done.trashed} messages to Trash, ${done.deletedEvents} events deleted, ${done.added} messages and ${done.addedEvents} events added from ${file}`
  log(`reset: ${line}`)
  console.log(line)
}

/**
 * The owner's one-time grant: Google's consent for the demo app opens in the demo account's own Chrome profile, which
 * signs that profile in to the demo account too, and the refresh token goes into the 1Password item beside the client
 * id and secret the owner put there. A thread never runs it, since the owner signs in and allows it.
 */
async function demoGrant(address: string): Promise<void> {
  const thread = runByThread()
  if (thread) {
    log(`grant: refused, ${thread} is set, so a thread runs it`)
    console.log(`Chrome stays closed: ${thread} is set, so a thread runs this, and the grant is the owner's. The owner runs this in their own terminal:`)
    console.log(`  cd '${process.cwd().replaceAll("'", "'\\''")}' && bun run app-kit google demo-grant ${address}`)
    process.exit(1)
  }
  const item = demoGrantItem(address)
  const clientId = (await opRead(`op://agents/${item}/client id`)).trim()
  const clientSecret = (await opRead(`op://agents/${item}/client secret`)).trim()
  const state = crypto.randomUUID()
  let given: string | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      const code = url.searchParams.get('code')
      if (url.searchParams.get('state') !== state || !code) return new Response('This is not the demo grant\'s answer.', { status: 400 })
      given = code
      return new Response('The demo grant is done. Quit this Chrome window.')
    },
  })
  const redirect = `http://127.0.0.1:${server.port}/`
  try {
    const consent = demoConsentAddress(clientId, address, redirect, state)
    console.log(`Opening Google's consent for the demo app in ${address}'s own Chrome. Sign in as ${address}, allow it, then quit that Chrome.`)
    await withProfile(demoChromeFolder(address), `${address} demo`, async (profile) => await signIn(profile, consent, (line) => log(`grant: ${line}`)))
    if (!given) throw new Error('Chrome was quit before Google sent the consent back; run demo-grant again and allow the demo app first.')
    const refreshToken = await refreshTokenFor(given, clientId, clientSecret, redirect)
    // Written through 1Password's desktop app, which asks the owner once; the agents vault's reader is read only.
    const saved = spawnSync('op', ['item', 'edit', item, '--vault', 'agents', `refresh token[password]=${refreshToken}`], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' })
    if (saved.status !== 0) throw new Error(`1Password did not save the refresh token in "${item}": ${saved.stderr.trim().split('\n').at(-1)}`)
    await readDemoGrant(address)
    log(`grant: saved for ${address}`)
    console.log(`The demo grant for ${address} is saved in 1Password ("${item}"). Run: app-kit google demo-reset <fixture file>`)
  } finally {
    server.stop(true)
  }
}

/** The `google` part's commands; false for anything it does not know. */
export async function google([command, ...args]: string[]): Promise<boolean> {
  if (command === 'demo-reset' && args.length === 1) {
    await demoReset(args[0]!)
    return true
  }
  if (command === 'demo-grant' && args.length === 1 && args[0]!.includes('@')) {
    await demoGrant(args[0]!)
    return true
  }
  return false
}
