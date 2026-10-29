// A server built on app-kit/server/start, run in its own process by server-start.test.ts, which stops it with SIGTERM.
import { upgradeWebSocket, websocket } from 'hono/bun';
import { appServer, listen } from '../server/start';

// The test's simulated page, on Vite's port, opens the socket: to this server it is another site, so it is listed.
const app = appServer({ service: 'server-start-child', otherSites: ['http://localhost:5173'] });
app.get(
  '/api/live',
  upgradeWebSocket(() => ({
    onMessage: (event) => console.log(`socket heard ${String(event.data)}`),
  })),
);
// A live-update stream, which sends one line and never ends by itself.
app.get('/api/stream', () => {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new TextEncoder().encode('first\n')),
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
});

listen(app, {
  port: 0,
  hostname: '127.0.0.1',
  websocket,
  graceMs: 200,
  onStop: () => console.log('onStop ran'),
});
