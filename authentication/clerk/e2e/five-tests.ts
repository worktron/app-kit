// The five signed-in tests both projects run, each on a page of the app as an app's test opens one. Every test counts
// the requests its pages sent to Clerk's browser side (the Frontend API) and says how many, and whether any was a
// sign-in, so the two ways can be compared request by request.
import { expect, type BrowserContext, type Page } from '@playwright/test';

export interface ClerkRequests {
  all: number;
  signIns: number;
}

/** Counts the context's requests to Clerk's Frontend API from now on. */
export function countClerkRequests(context: BrowserContext): ClerkRequests {
  const counted = { all: 0, signIns: 0 };
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.host !== process.env.CLERK_FAPI) return;
    counted.all++;
    if (request.method() === 'POST' && url.pathname === '/v1/client/sign_ins') counted.signIns++;
  });
  return counted;
}

/** What each of the five tests does once its page is signed in: a page of the app shows who is signed in. */
export const FIVE: { name: string; run: (page: Page, email: string) => Promise<void> }[] = [1, 2, 3, 4, 5].map((n) => ({
  name: `signed-in test ${n} sees who is signed in`,
  run: async (page, email) => {
    await page.goto(`/?test=${n}`);
    await expect(page.getByTestId('person')).toHaveText(email);
  },
}));
