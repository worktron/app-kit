// The Clerk browser test's setup and its teardown. Clerk's testing token for the run (clerkSetup), and a pass-through
// to Clerk's Backend API on a free port that counts, for each project by the first part of its path (/shared, /own,
// /each), the users made, the tickets minted and the users removed. Its teardown, once every worker has ended and
// removed its user, fails the run unless the five tests on the shared user made one user, minted one ticket and removed
// one, where the same five tests making their own made five of each.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { clerkSetup } from '@clerk/testing/playwright';
import { removeThrowawayUsers } from '../playwright.js';
import { DOMAIN, PREFIX } from './names';

const CLERK_API = 'https://api.clerk.com';
type Counts = { made: number; tickets: number; removed: number };

export default async function globalSetup() {
  await clerkSetup();
  const counts = new Map<string, Counts>();
  const server = createServer(async (incoming, outgoing) => {
    const [, project, ...rest] = (incoming.url ?? '/').split('/');
    const path = `/${rest.join('/')}`;
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (name !== 'host' && name !== 'connection' && name !== 'content-length' && typeof value === 'string') headers.set(name, value);
    }
    const answer = await fetch(`${CLERK_API}${path}`, { method: incoming.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    if (answer.ok) {
      const count = counts.get(project) ?? { made: 0, tickets: 0, removed: 0 };
      if (incoming.method === 'POST' && path === '/v1/users') count.made++;
      if (incoming.method === 'POST' && path === '/v1/sign_in_tokens') count.tickets++;
      if (incoming.method === 'DELETE' && /^\/v1\/users\/[^/]+$/.test(path)) count.removed++;
      counts.set(project, count);
    }
    // Status, headers and bytes as Clerk sent them, but for the ones fetch has already undone.
    const body = Buffer.from(await answer.arrayBuffer());
    const sent: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (name !== 'content-encoding' && name !== 'content-length' && name !== 'transfer-encoding' && name !== 'connection') sent[name] = value;
    });
    outgoing.writeHead(answer.status, { ...sent, 'content-length': String(body.length) });
    outgoing.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  process.env.CLERK_COUNTED_API = `http://localhost:${(server.address() as AddressInfo).port}`;

  return async () => {
    try {
      const of = (project: string) => counts.get(project) ?? { made: 0, tickets: 0, removed: 0 };
      console.log(`[clerk e2e] shared user: ${JSON.stringify(of('shared'))}; a user of its own: ${JSON.stringify(of('own'))}; a user per test: ${JSON.stringify(of('each'))}`);
      const want = (project: string, expected: Counts) => {
        const got = of(project);
        if (got.made !== expected.made || got.tickets !== expected.tickets || got.removed !== expected.removed) {
          throw new Error(`the ${project} tests made ${got.made} users, minted ${got.tickets} tickets and removed ${got.removed}, where ${JSON.stringify(expected)} was expected`);
        }
      };
      want('shared', { made: 1, tickets: 1, removed: 1 });
      want('own', { made: 1, tickets: 1, removed: 1 });
      want('each', { made: 5, tickets: 5, removed: 5 });
    } finally {
      // What a run stopped before its fixtures could remove: only users past the default hour, so a run going on in
      // another checkout keeps its own.
      await removeThrowawayUsers({ secretKey: process.env.CLERK_SECRET_KEY ?? '', domain: DOMAIN, prefix: PREFIX });
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
