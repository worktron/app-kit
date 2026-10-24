import { afterEach, expect, mock, test } from 'bun:test';
import { configureConnection, isProxyFailure, markUnreachable, onReconnect, resetConnection, serverReachable } from '../src/connection';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetConnection();
});

test('while unreachable it looks at the probe path, and once the server answers it is back and says so', async () => {
  let up = false;
  const looked: string[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    looked.push(String(url));
    if (!up) throw new TypeError('Failed to fetch');
    return new Response('ok');
  }) as unknown as typeof fetch;
  configureConnection({ probePath: '/api/health' });
  let reconnects = 0;
  onReconnect(() => reconnects++);

  markUnreachable();
  expect(serverReachable()).toBe(false);
  // Coming back in front looks at once, rather than waiting for the next look.
  up = true;
  window.dispatchEvent(new Event('online'));
  await Bun.sleep(10);
  expect(looked).toEqual(['/api/health']);
  expect(serverReachable()).toBe(true);
  expect(reconnects).toBe(1);
});

test('a proxy failure is 502, 503 or 504 and nothing else', () => {
  expect([500, 502, 503, 504, 404].map(isProxyFailure)).toEqual([false, true, true, true, false]);
});
