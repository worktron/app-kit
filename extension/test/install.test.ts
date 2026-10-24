import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extensionId, writeHostManifest } from '../host/install.ts'

const dir = mkdtempSync(join(tmpdir(), 'app-kit-extension-install-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('the extension ID is the one Chrome gives the manifest key', () => {
  // amazon-connector's key, and the ID Chrome showed for it on chrome://extensions.
  expect(extensionId('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjhCgiHc5+4kh0/UYgWEKVV2p4Yaz1MWyGb8xGO03q0cBeNUvbo1TCSszsm5kiQPms7HG5dpcLUALy+EYQFEBd1dh4jM9H0/5lOxJU3/PFsJfr4pUQPLNhib/oN5FLxU8kozrmdQFx6KuWzBDGYjN0NZDlGrAXzdEHfHJrS3oHYkW+0GcEhh0Dg15NEQ5eOTiC1+RYVVDRaWxAyQR2bqRxqynxECtuA0qZUHnw2HqoyVOvkT43oR4KswrmvGcBM4jyh1WGEojXBVsRhqJ4qZcYW0HN3gZeJ3wvW3wKCTIzJdA78H/I3TSORFxQf6gRhrc4algt/noaUGNDWpMrngxRwIDAQAB')).toBe('anhanhbcgcbkmkplbafdhdhcllhecmfg')
})

test('the host manifest names the host, its executable and the one extension allowed to start it', () => {
  const file = writeHostManifest(dir, { name: 'com.example.tool', description: 'Relays for the tool', path: '/opt/tool/host', extensionId: 'abcdefghijklmnopabcdefghijklmnop' })
  expect(file).toBe(join(dir, 'com.example.tool.json'))
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
    name: 'com.example.tool',
    description: 'Relays for the tool',
    path: '/opt/tool/host',
    type: 'stdio',
    allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'],
  })
})
