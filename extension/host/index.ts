// The Mac side of an extension: the native host Chrome starts, the client its
// callers use, what tells Chrome about the host, and why nothing is connected.

export { ask, hostStatus, NotConnected, type AskOptions } from './client.ts'
export { diagnoseHost, type DiagnoseOptions, type Diagnosis } from './diagnose.ts'
export { applicationSupport, chromeHostsDir, extensionId, installHost, writeHostLauncher, writeHostManifest, type HostManifest, type InstalledHost, type InstallHostOptions } from './install.ts'
export { frame, Unframer } from './native.ts'
export * from './protocol.ts'
export { Relay, type RelayOptions, type Request } from './relay.ts'
export { serveHost, type HostOptions } from './serve.ts'
