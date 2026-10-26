// The types of playwright.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.
import type { Page } from '@playwright/test';

/** The seconds Clerk asked to wait, or null when `error` is not a refusal for too many requests. */
export type RefusedFor = (error: unknown) => number | null;

export interface BackoffOptions {
  /** How a wait is spent; a plain timer by default. */
  wait?: (ms: number) => Promise<void>;
  /** Reads a refusal's seconds; by default a Clerk Backend API answer of 429 and the seconds it asks for. */
  refusedFor?: RefusedFor;
  /** The most it waits in all before it throws the refusal as it came; 20 seconds by default. */
  maxWaitMs?: number;
}

/**
 * Runs `call`, and when Clerk refuses it for too many requests, waits as long as Clerk asks and runs it again, up to
 * `maxWaitMs` in all. Any other error, or a refusal past the limit, is thrown as it came. A development instance limits
 * requests across every run on the machine, and a parallel suite asks for users and tickets in bursts.
 */
export function withClerkBackoff<T>(what: string, call: () => Promise<T>, options?: BackoffOptions): Promise<T>;

export interface ClerkInstance {
  /** The development instance's secret key, read where the test runs. */
  secretKey: string;
  /** The Backend API's address, when not Clerk's own. */
  apiUrl?: string;
}

export interface ThrowawayUser {
  email: string;
  userId: string;
  /** A one-time sign-in ticket for the user, good for ten minutes, as an app's server makes one. */
  ticket(): Promise<string>;
  /** Deletes the user, as a test's fixture does once the test is done with it. */
  remove(): Promise<void>;
}

/**
 * Makes a new user on a development instance, at `<prefix>-<10 hex>+clerk_test@<domain>`, which Clerk lets sign in by
 * code 424242 with no email sent. Its password, for an instance that asks for one, is random and never used. A test
 * fixture removes it when the test ends, so the instance holds only the users of tests still running.
 */
export function throwawayUser(options: ClerkInstance & { domain: string; prefix: string }): Promise<ThrowawayUser>;

/**
 * Signs the page in with a one-time ticket, through Clerk's testing library, on a page of the app that has loaded
 * Clerk, and waits until the page has a signed-in user. Needs `clerkSetup()` from `@clerk/testing/playwright` in the
 * suite's global setup, which sets `CLERK_FAPI` and `CLERK_TESTING_TOKEN`; without it Clerk's library throws saying so.
 * Every answer of 400 or more from Clerk's browser side is logged with the page it came from. When Clerk refuses the
 * sign-in for too many requests, it waits as the refusal's Retry-After says, up to `maxWaitMs` (a minute) in all, and adds
 * the wait to the test's time limit. A development instance refuses every sign-in from Playwright's WebKit that way, so
 * sign-ins run in Chromium.
 */
export function signInWithTicket(page: Page, ticket: string, options?: { maxWaitMs?: number }): Promise<void>;

/**
 * Removes the users `throwawayUser` made with this `prefix` and `domain` that are older than `olderThanMs` (an hour by
 * default): the ones a run stopped before its tests' fixtures could remove them. A user at any other address, or one
 * young enough to belong to a run still going, is kept. Runs one deletion at a time, best effort: a failure is logged,
 * and the count removed is returned. For a suite's global setup or teardown.
 */
export function removeThrowawayUsers(
  options: ClerkInstance & { domain: string; prefix: string; olderThanMs?: number; now?: () => number },
): Promise<number>;
