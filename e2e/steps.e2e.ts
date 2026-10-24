import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { serveNewerBuild } from '../testing/playwright';

// The Playwright steps' own guard; kit.e2e.ts drives the steps against the fixture.

test('serving a newer build fails at once, saying why, on a page that names no Vite entry', async ({ browser }) => {
  const server = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<p>No build here</p>'));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  try {
    await expect(serveNewerBuild(await context.newPage())).rejects.toThrow('names no module script under /assets/ to rename');
  } finally {
    await context.close();
    server.close();
  }
});
