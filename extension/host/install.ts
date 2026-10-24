// Telling Chrome about a native host: the manifest Chrome reads to find it,
// which names the extension allowed to start it by its ID.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The extension's ID, from the `key` in its manifest: the first 32 hex digits
 * of the key's SHA-256, each written as a letter from a to p. A fixed key
 * gives the same ID in every profile and on every machine.
 */
export function extensionId(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('')
}

/** A folder of this Mac's Application Support, where a tool keeps its socket and log. */
export function applicationSupport(name: string): string {
  return join(homedir(), 'Library', 'Application Support', name)
}

/** Where Chrome looks for native host manifests for every profile. A profile's own folder, `<profile>/NativeMessagingHosts`, works too. */
export function chromeHostsDir(): string {
  return applicationSupport(join('Google', 'Chrome', 'NativeMessagingHosts'))
}

export type HostManifest = { name: string; description: string; path: string; type: 'stdio'; allowed_origins: string[] }

/**
 * Writes the manifest Chrome reads to start the host `name` (lowercase
 * letters, digits, dots and underscores) at `path`, an executable, for the
 * extension with `extensionId`. Returns the file written.
 */
export function writeHostManifest(folder: string, { name, description, path, extensionId }: { name: string; description: string; path: string; extensionId: string }): string {
  const manifest: HostManifest = { name, description, path, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `${name}.json`)
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  return file
}
