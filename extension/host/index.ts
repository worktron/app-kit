// The Mac side of an extension: the native host Chrome starts, the client its
// callers use, what tells Chrome about the host, and why nothing is connected.

export { ask, hostStatus, NotConnected, type AskOptions } from './client'
export { diagnoseHost, type DiagnoseOptions, type Diagnosis } from './diagnose'
export { applicationSupport, chromeHostsDir, extensionId, installHost, writeHostLauncher, writeHostManifest, type HostManifest, type InstalledHost, type InstallHostOptions } from './install'
export { frame, Unframer } from './native'
export * from './protocol'
export { Relay, type RelayOptions, type Request } from './relay'
export { serveHost, type HostOptions } from './serve'
