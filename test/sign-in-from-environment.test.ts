import { expect, test } from 'bun:test';
import { signInFromEnvironment, useClerkSession } from '../authentication/clerk';
import { noAccountFor } from '../web';

test('the stand-in under VITE_SIGN_IN=stand-in, even beside a Clerk key, for browser tests with no network', () => {
  const provider = signInFromEnvironment({ VITE_SIGN_IN: 'stand-in', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' });
  expect(provider && 'calls' in provider).toBe(true);
});

test('Clerk with a publishable key', () => {
  const provider = signInFromEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' });
  expect(provider?.useSession).toBe(useClerkSession);
});

test('nobody with neither, or a blank key, so the gate draws the app with no sign-in', () => {
  expect(signInFromEnvironment({})).toBeNull();
  expect(signInFromEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: '' })).toBeNull();
  expect(signInFromEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: ' ' })).toBeNull();
});

test('the message for an address with no account is one the app can read from the web entry', () => {
  expect(noAccountFor('a@example.com')).toBe('There is no account for a@example.com.');
});
