import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutPage } from './dom'
import { type DemoFixtures, type DemoGrant, rawMessage, readDemoFixtures, readDemoGrant, resetDemoAccount, withDemoAccount } from '../server/google/demo.ts'

// Server code: Bun's own fetch and Response, not the simulated page's, which refuses another origin.
let putPageBack: () => void = () => {}
beforeAll(async () => {
  putPageBack = await withoutPage()
})

// A stand-in for the parts of Gmail and Calendar the reset calls, holding one made-up demo account's mail and events.
// Gmail's labelIds take label ids, so a label name sent as one is refused, as Gmail refuses an unknown id.
type Message = { id: string; labels: string[]; raw?: string }
type Event = { id: string; summary: string; start: string }
const state = { account: 'demo@example.com', messages: [] as Message[], events: [] as Event[], next: 1 }
const SYSTEM_LABELS = new Set(['INBOX', 'UNREAD', 'SENT', 'TRASH', 'STARRED', 'IMPORTANT'])

const google = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/token') {
      const form = new URLSearchParams(await request.text())
      if (form.get('refresh_token') !== 'refresh-token') return Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })
      return Response.json({ access_token: 'access-token' })
    }
    if (request.headers.get('authorization') !== 'Bearer access-token') return new Response('', { status: 401 })
    if (path === '/gmail/profile') return Response.json({ emailAddress: state.account })
    if (path === '/gmail/messages' && request.method === 'GET') {
      expect(url.searchParams.get('q')).toBe('in:inbox OR in:sent')
      return Response.json({ messages: state.messages.filter((m) => m.labels.includes('INBOX') || m.labels.includes('SENT')).map(({ id }) => ({ id })) })
    }
    if (path === '/gmail/messages' && request.method === 'POST') {
      const body = (await request.json()) as { raw: string; labelIds: string[] }
      if (body.labelIds.some((label) => !SYSTEM_LABELS.has(label))) return Response.json({ error: { message: 'Invalid label' } }, { status: 400 })
      state.messages.push({ id: `m${state.next++}`, labels: body.labelIds, raw: body.raw })
      return Response.json({})
    }
    const trash = /^\/gmail\/messages\/(\w+)\/trash$/.exec(path)
    if (trash) {
      const message = state.messages.find((m) => m.id === trash[1])!
      message.labels = ['TRASH']
      return Response.json({})
    }
    if (path === '/calendar/events' && request.method === 'GET') return Response.json({ items: state.events.map(({ id }) => ({ id })) })
    if (path === '/calendar/events' && request.method === 'POST') {
      const body = (await request.json()) as { summary: string; start: { dateTime: string } }
      state.events.push({ id: `e${state.next++}`, summary: body.summary, start: body.start.dateTime })
      return Response.json({})
    }
    const event = /^\/calendar\/events\/(\w+)$/.exec(path)
    if (event && request.method === 'DELETE') {
      state.events = state.events.filter((e) => e.id !== event[1])
      return new Response(null, { status: 204 })
    }
    return new Response('not found', { status: 404 })
  },
})
const base = `http://127.0.0.1:${google.port}`
const endpoints = { token: `${base}/token`, gmail: `${base}/gmail`, calendar: `${base}/calendar` }
const grant: DemoGrant = { clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh-token' }
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-google-demo-')))
afterAll(() => {
  putPageBack()
  google.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

const fixtures: DemoFixtures = {
  account: 'demo@example.com',
  mail: [
    { from: 'Dana Ortiz <dana@example.com>', subject: 'Invoice 1042 is due Friday', body: 'Hi, the invoice is attached.', minutesAgo: 40 },
    { from: 'Weekly Deals <deals@example.com>', subject: 'This week only', body: 'Sale.', minutesAgo: 90, read: true },
  ],
  events: [{ summary: 'Logo review', startsInMinutes: 24 * 60, minutes: 30 }],
}

beforeEach(() => {
  state.account = 'demo@example.com'
  // Last run's state: a fixture message, the digest the app sent itself (in Inbox and Sent), mail already in Trash, an event.
  state.messages = [
    { id: 'old1', labels: ['INBOX'] },
    { id: 'old2', labels: ['INBOX', 'SENT'] },
    { id: 'old3', labels: ['TRASH'] },
  ]
  state.events = [{ id: 'olde', summary: 'Old meeting', start: '2026-11-01T10:00:00Z' }]
})

const inbox = () => state.messages.filter((m) => m.labels.includes('INBOX'))

test('a reset trashes everything in the Inbox and Sent, deletes every event, then adds the fixtures', async () => {
  const done = await resetDemoAccount(fixtures, grant, endpoints, Date.parse('2026-11-08T17:07:00Z'))
  expect(done).toEqual({ trashed: 2, deletedEvents: 1, added: 2, addedEvents: 1 })
  expect(inbox().map((m) => m.labels)).toEqual([['INBOX', 'UNREAD'], ['INBOX']])
  expect(state.events.map((e) => [e.summary, e.start])).toEqual([['Logo review', '2026-11-09T17:15:00.000Z']])
})

test('a second reset leaves the same inbox and calendar as the first', async () => {
  await resetDemoAccount(fixtures, grant, endpoints)
  const first = { inbox: inbox().length, events: state.events.map((e) => e.summary) }
  await resetDemoAccount(fixtures, grant, endpoints)
  expect({ inbox: inbox().length, events: state.events.map((e) => e.summary) }).toEqual(first)
})

test('a grant for another account changes nothing', async () => {
  state.account = 'someone@example.com'
  expect(resetDemoAccount(fixtures, grant, endpoints)).rejects.toThrow('The demo grant is for someone@example.com, not demo@example.com')
  expect(state.messages.map((m) => m.id)).toEqual(['old1', 'old2', 'old3'])
})

test('a grant Google no longer honors says to grant again', async () => {
  expect(resetDemoAccount(fixtures, { ...grant, refreshToken: 'gone' }, endpoints)).rejects.toThrow('run app-kit google demo-grant again')
})

test('a message is sent raw with its sender, subject and a date its minutes back', () => {
  const raw = Buffer.from(rawMessage(fixtures.mail[0]!, 'demo@example.com', Date.parse('2026-11-08T17:00:00Z')), 'base64url').toString()
  expect(raw).toContain('From: Dana Ortiz <dana@example.com>\r\nTo: demo@example.com\r\nSubject: Invoice 1042 is due Friday\r\nDate: Sun, 08 Nov 2026 16:20:00 +0000')
  expect(raw.endsWith(Buffer.from('Hi, the invoice is attached.').toString('base64'))).toBe(true)
})

test('a fixture file missing its parts is refused, naming each', () => {
  const file = join(dir, 'bad.json')
  writeFileSync(file, JSON.stringify({ account: 'demo', mail: [{ from: 'a' }] }))
  expect(() => readDemoFixtures(file)).toThrow(/"account".*"events".*mail 1 needs from, subject and body/)
})

test('the grant is read from its 1Password item in the agents vault', async () => {
  const read: string[] = []
  const got = await readDemoGrant('demo@example.com', async (reference) => {
    read.push(reference)
    return `${reference.split('/').pop()}\n`
  })
  expect(read).toEqual(['op://agents/Google demo grant demo@example.com/client id', 'op://agents/Google demo grant demo@example.com/client secret', 'op://agents/Google demo grant demo@example.com/refresh token'])
  expect(got).toEqual({ clientId: 'client id', clientSecret: 'client secret', refreshToken: 'refresh token' })
})

test('one run at a time holds a demo account', async () => {
  const env = { XDG_STATE_HOME: join(dir, 'state') }
  const address = 'demo@example.com'
  const lockFile = join(dir, 'state', 'app-kit', 'google-demo', `${address}.lock`)
  const second = await withDemoAccount(
    'demo@example.com',
    async () => {
      // The lock file names a live process other than this one, as a second run would find the first's.
      writeFileSync(lockFile, String(process.ppid))
      const refused = await withDemoAccount('demo@example.com', async () => 'ran', env).catch((error: Error) => error.message)
      writeFileSync(lockFile, String(process.pid))
      return refused
    },
    env,
  )
  expect(second).toContain('Another run holds the demo account demo@example.com')
})

test('demo-grant run by a thread opens no Chrome and prints the line for the owner', () => {
  const folder = join(dir, 'grant')
  const bin = join(folder, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'open'), '#!/bin/sh\necho "$@" >> "$HOME/open-calls"\n')
  chmodSync(join(bin, 'open'), 0o755)
  const { AI_AGENT: _agent, ...env } = process.env
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, '../bin/app-kit.ts'), 'google', 'demo-grant', 'demo@example.com'], {
    cwd: folder,
    stdout: 'pipe',
    env: { ...env, METAMAX_JOB_ID: 'thread-under-test', HOME: folder, XDG_STATE_HOME: join(folder, 'state'), PATH: `${bin}:${env.PATH}` },
  })
  expect(run.exitCode).toBe(1)
  expect(run.stdout.toString()).toContain('bun run app-kit google demo-grant demo@example.com')
  expect(Bun.file(join(folder, 'open-calls')).size).toBe(0)
})
