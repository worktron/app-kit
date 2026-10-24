import { useSyncExternalStore } from 'react';
import { onPageReturn } from './page-return';

/** How long between two looks at the server while it cannot be reached. */
export const PROBE_MS = 5_000;

type Listener = () => void;

let reachable = true;
let probePath = '/';
let timer: ReturnType<typeof setTimeout> | null = null;
let stopReturn: (() => void) | null = null;
const listeners = new Set<Listener>();
const reconnectListeners = new Set<Listener>();

/**
 * Where the kit looks to learn the server is back: a path the server answers without a sign-in, such as its health
 * check. The root by default, which is right when the server also serves the page.
 */
export function configureConnection(options: { probePath: string }): void {
  probePath = options.probePath;
}

/** Whether the server could be reached when the page last asked it something. */
export function serverReachable(): boolean {
  return reachable;
}

/** Re-renders with whether the server can be reached. */
export function useServerReachable(): boolean {
  return useSyncExternalStore(subscribe, serverReachable, () => true);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Calls `onBack` each time the server can be reached again, for the app to load what it missed. */
export function onReconnect(onBack: Listener): () => void {
  reconnectListeners.add(onBack);
  return () => reconnectListeners.delete(onBack);
}

function set(next: boolean) {
  if (next === reachable) return;
  reachable = next;
  for (const listener of listeners) listener();
  if (next) {
    stopProbing();
    for (const listener of reconnectListeners) listener();
  } else {
    startProbing();
  }
}

/** A request got no answer, or the answer came from a proxy in front of a server that is down (502, 503, 504). */
export function markUnreachable(): void {
  set(false);
}

/** A request got the server's own answer. */
export function markReachable(): void {
  set(true);
}

/** Looks at the server once; any answer of its own means it is back. */
async function probe(): Promise<void> {
  try {
    const res = await fetch(probePath, { cache: 'no-store' });
    if (!isProxyFailure(res.status)) markReachable();
  } catch {
    // Still down: the next look is already set.
  }
}

/** The answer a proxy gives when the server behind it is down or restarting. */
export function isProxyFailure(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function startProbing() {
  const next = () => {
    timer = setTimeout(() => {
      void probe().then(() => {
        if (!reachable) next();
      });
    }, PROBE_MS);
  };
  next();
  window.addEventListener('online', probeNow);
  stopReturn = onPageReturn(probeNow);
}

function probeNow() {
  void probe();
}

function stopProbing() {
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener('online', probeNow);
  stopReturn?.();
  stopReturn = null;
}

/** Back to a reachable server with nothing listening, between tests. */
export function resetConnection(): void {
  stopProbing();
  reachable = true;
  probePath = '/';
  listeners.clear();
  reconnectListeners.clear();
}
