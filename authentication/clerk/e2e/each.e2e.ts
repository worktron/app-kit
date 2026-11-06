// The same five signed-in tests, each making a user of its own, signing it in and removing it, as tests did before the
// shared user: the counts global-setup.ts checks, and the requests each test prints, compare the two.
import { test, expect } from '@playwright/test';
import { signInWithTicket, throwawayUser } from '../playwright.js';
import { countClerkRequests, FIVE } from './five-tests';
import { countedApi, DOMAIN, PREFIX, secretKey } from './names';

for (const { name, run } of FIVE) {
  test(name, async ({ page, context }) => {
    const requests = countClerkRequests(context);
    const user = await throwawayUser({ secretKey: secretKey(), apiUrl: countedApi('each'), domain: DOMAIN, prefix: PREFIX });
    try {
      await page.goto('/');
      await signInWithTicket(page, await user.ticket());
      await run(page, user.email);
      console.log(`[clerk e2e] each: ${name}: ${requests.all} requests to Clerk's browser side, ${requests.signIns} sign-ins`);
      expect(requests.signIns).toBe(1);
    } finally {
      await user.remove();
    }
  });
}
