// Steps for an app's Playwright tests against a Clerk development instance: waiting as Clerk asks when it refuses too
// many requests, a throwaway user with a one-time ticket, signing the page in with it, one user signed in once per
// worker and shared by its tests, and removing the throwaway users a run left, so the instance never reaches its cap of
// 100 users. Plain JavaScript, typed by
// playwright.d.ts, since Playwright's test runner loads nothing written in TypeScript from inside node_modules, where an
// app has the kit.

import { randomBytes, randomUUID } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import('./playwright').RefusedFor} */
const backendRefusal = (error) => (isClerkAPIResponseError(error) && error.status === 429 ? (error.retryAfter ?? 1) : null);

/** @type {typeof import('./playwright').withClerkBackoff} */
export async function withClerkBackoff(what, call, { wait = sleep, refusedFor = backendRefusal, maxWaitMs = 20_000 } = {}) {
  let waited = 0;
  for (;;) {
    try {
      return await call();
    } catch (error) {
      const seconds = refusedFor(error);
      if (seconds === null) throw error;
      const ms = Math.max(1, seconds) * 1000;
      if (waited + ms > maxWaitMs) {
        console.warn(`[app-kit clerk] ${what}: too many requests, Clerk asks ${ms / 1000}s, past the ${maxWaitMs / 1000}s limit`);
        throw error;
      }
      console.warn(`[app-kit clerk] ${what}: too many requests, waiting ${ms / 1000}s as Clerk asks`);
      await wait(ms);
      waited += ms;
    }
  }
}

/**
 * The address shape `throwawayUser` makes and `removeThrowawayUsers` removes, and nothing else: a fixed test user such
 * as owner+clerk_test@example.com never matches.
 * @param {string} prefix
 * @param {string} domain
 */
function throwawayAddress(prefix, domain) {
  const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escape(prefix)}-[0-9a-f]{10}\\+clerk_test@${escape(domain)}$`, 'i');
}

/** @param {{ secretKey: string; apiUrl?: string }} options */
const clientFor = ({ secretKey, apiUrl }) => createClerkClient({ secretKey, apiUrl });

/** @type {typeof import('./playwright').throwawayUser} */
export async function throwawayUser({ secretKey, domain, prefix, apiUrl }) {
  const backend = clientFor({ secretKey, apiUrl });
  // A short local part: Clerk's address checks refuse some long ones that are valid.
  const email = `${prefix}-${randomBytes(5).toString('hex')}+clerk_test@${domain}`;
  // An instance with passwords asks one of every new user; this one is never used and never written down.
  const user = await withClerkBackoff('createUser', () => backend.users.createUser({ emailAddress: [email], password: `${randomUUID()}-A1` }));
  return {
    email,
    userId: user.id,
    // Made from the id rather than looked up by address, which a user made a moment ago sometimes is not yet.
    ticket: async () => (await withClerkBackoff('createSignInToken', () => backend.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 600 }))).token,
    remove: async () => {
      await withClerkBackoff('deleteUser', () => backend.users.deleteUser(user.id));
    },
  };
}

/** @type {typeof import('./playwright').signInWithTicket} */
export async function signInWithTicket(page, ticket, { maxWaitMs = 60_000 } = {}) {
  // Every refusal from Clerk's browser side is logged with the page it came from, so a test that finds itself signed
  // out says what Clerk answered; a refusal for too many requests keeps the seconds it asks for.
  let retryAfter = 1;
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.host !== process.env.CLERK_FAPI || response.status() < 400) return;
    console.log(`[app-kit clerk] ${response.status()} ${response.request().method()} ${url.pathname} (page ${new URL(page.url()).pathname})`);
    if (response.status() === 429) retryAfter = Number(response.headers()['retry-after']) || 1;
  });
  // Clerk's browser side refuses a busy machine too, after its testing library's own quick tries, saying only "Too Many
  // Requests": the step waits as the refusal's Retry-After says and signs in again with the same ticket, which a refusal
  // leaves unused. The wait is added to the test's time, so the test's own work keeps its whole budget.
  await withClerkBackoff('sign in', () => clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket } }), {
    refusedFor: (error) => (error instanceof Error && /Too Many Requests/.test(error.message) ? retryAfter : null),
    wait: async (ms) => {
      const info = await currentTest();
      if (info) info.setTimeout(info.timeout + ms);
      await sleep(ms);
    },
    maxWaitMs,
  });
  // The testing library returns once Clerk took the ticket, before the session is the page's.
  await page.waitForFunction(() => Boolean(/** @type {{ Clerk?: { user?: unknown } }} */ (/** @type {unknown} */ (window)).Clerk?.user));
}

/** @type {typeof import('./playwright').testSignedInPerWorker} */
export function testSignedInPerWorker(test, { secretKey, domain, prefix, apiUrl, signInPath = '/', cleanAccount, signInWaitMs = 150_000 }) {
  /** @type {any} Playwright's extend is typed for the app's own fixtures, which this generic function cannot name. */
  const base = test;
  return base.extend({
    // One user and one sign-in for the worker, made when its first test asks for the shared sign-in, and removed when
    // the worker ends; a worker that fails to sign in removes its user too. Its own time limit covers waiting out
    // Clerk's refusals, which a busy machine's other runs bring, past the test's.
    clerkSharedSignIn: [
      /** @param {{ browser: import('@playwright/test').Browser }} fixtures */
      async ({ browser }, /** @type {(value: unknown) => Promise<void>} */ use, /** @type {import('@playwright/test').WorkerInfo} */ workerInfo) => {
        const user = await throwawayUser({ secretKey, domain, prefix, apiUrl });
        /** @type {import('@playwright/test').BrowserContext | undefined} */
        let context;
        try {
          context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
          // The page signed in on is the app's, and plays no sound aloud, as a test's own page does. Loaded here: it
          // imports @playwright/test, which fails beside the unit tests' simulated page.
          const { offlineAudio } = await import('../../web/playwright-offline-audio.js');
          await offlineAudio(context);
          await setupClerkTestingToken({ context });
          const page = await context.newPage();
          await page.goto(signInPath);
          await signInWithTicket(page, await user.ticket(), { maxWaitMs: signInWaitMs });
          // Kept in memory only: a file would hand a later run the session of a user this worker removes.
          const storageState = await context.storageState();
          await context.close();
          context = undefined;
          console.log(`[app-kit clerk] worker ${workerInfo.workerIndex} signed in ${user.email} once for its tests`);
          await use({ user: { email: user.email, userId: user.userId }, storageState });
        } finally {
          await context?.close();
          await user.remove().catch((error) => console.warn(`[app-kit clerk] could not remove the worker's user ${user.userId}`, error));
        }
      },
      { scope: 'worker', timeout: signInWaitMs + 60_000 },
    ],
    /** @param {{ clerkSharedSignIn: SharedSignIn }} fixtures */
    storageState: async ({ clerkSharedSignIn }, /** @type {(value: unknown) => Promise<void>} */ use) => {
      if (cleanAccount) await cleanAccount(clerkSharedSignIn.user);
      await use(clerkSharedSignIn.storageState);
    },
    /** @param {{ context: import('@playwright/test').BrowserContext }} fixtures */
    context: async ({ context }, /** @type {(value: unknown) => Promise<void>} */ use) => {
      await setupClerkTestingToken({ context });
      await use(context);
    },
    /** @param {{ clerkSharedSignIn: SharedSignIn }} fixtures */
    clerkUser: async ({ clerkSharedSignIn }, /** @type {(value: unknown) => Promise<void>} */ use) => {
      await use(clerkSharedSignIn.user);
    },
  });
}

/** @typedef {{ user: import('./playwright').ClerkTestUser; storageState: unknown }} SharedSignIn */

/**
 * The running test's info, or null outside a test, as in a global setup. Loaded only here, when a wait needs it:
 * @playwright/test fails to load beside the simulated page the kit's unit tests run in.
 */
async function currentTest() {
  const { test } = await import('@playwright/test');
  try {
    return test.info();
  } catch {
    return null;
  }
}

/** @type {typeof import('./playwright').removeThrowawayUsers} */
export async function removeThrowawayUsers({ secretKey, domain, prefix, olderThanMs = 60 * 60_000, apiUrl, now = Date.now }) {
  const backend = clientFor({ secretKey, apiUrl });
  const shape = throwawayAddress(prefix, domain);
  const cutoff = now() - olderThanMs;
  /** @type {string[]} */
  const ids = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const page = await withClerkBackoff('getUserList', () => backend.users.getUserList({ query: `${prefix}-`, limit, offset }));
    for (const user of page.data) {
      const emails = user.emailAddresses.map((entry) => entry.emailAddress);
      // A young one may be another run's, still signed in; it goes once it is past the age.
      if (emails.length > 0 && emails.every((email) => shape.test(email)) && user.createdAt < cutoff) ids.push(user.id);
    }
    if (page.data.length < limit) break;
  }
  // One at a time, waiting as Clerk asks: deleting refuses a burst, and nothing waits on this.
  let removed = 0;
  for (const id of ids) {
    try {
      await withClerkBackoff('deleteUser', () => backend.users.deleteUser(id));
      removed++;
    } catch (error) {
      console.warn(`[app-kit clerk] could not remove throwaway user ${id}`, error);
    }
  }
  if (removed > 0) console.log(`[app-kit clerk] removed ${removed} throwaway user(s) older than ${olderThanMs / 60_000} minutes`);
  return removed;
}
