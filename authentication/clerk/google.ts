import type { Outcome } from '../../web/sign-in/provider';
import { googleAccountParams, messageFor } from './email-code';

/**
 * Clerk's classic sign-in as Google's start uses it. Its creation takes the account to sign in as, which it passes to
 * Google as `login_hint`. Clerk's redirect call (`authenticateWithRedirect`) never took one, and the newer sign-in
 * object's `sso()` takes none either, so the kit starts Google here and goes to the address Clerk answers with, as
 * Clerk's own Expo kit does.
 */
export interface GoogleStartSignIn {
  create(params: {
    strategy: 'oauth_google';
    redirectUrl: string;
    actionCompleteRedirectUrl: string;
    oidcLoginHint?: string;
    oidcPrompt?: string;
  }): Promise<{ status: string | null; firstFactorVerification: { externalVerificationRedirectURL: URL | null } }>;
}

/**
 * Sends the page to Google for `account`, or for Google's list with null, coming back to `back`. On success the page
 * is already leaving, so only a failure comes back: a refusal, or a sign-in Clerk answers with no Google address, as
 * when its bot check asks first.
 */
export async function startGoogle(
  signIn: GoogleStartSignIn,
  { back, account, go = (address) => window.location.assign(address) }: { back: string; account: string | null; go?: (address: string) => void },
): Promise<Outcome> {
  try {
    const started = await signIn.create({ strategy: 'oauth_google', redirectUrl: back, actionCompleteRedirectUrl: back, ...googleAccountParams(account) });
    const google = started.firstFactorVerification.externalVerificationRedirectURL;
    if (!google) {
      console.warn(`[app-kit clerk] Google did not start: the sign-in is ${started.status ?? 'without a status'}, with no Google address`);
      return { ok: false, message: messageFor(undefined, account ?? '') };
    }
    go(google.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageFor(error, account ?? '') };
  }
}

/** How Clerk asks to move the page: to a path, with its own way of loading an address, which fires its unload event. */
export type ClerkMove = (to: string, metadata?: { windowNavigate?: (to: URL | string) => void }) => void;

// The path a return from Google is finishing on, while Clerk finishes it.
let finishingOn: string | null = null;

/**
 * Runs `finish`, Clerk's handling of Google's return, on `path`. Meanwhile Clerk's move back to that same path, which
 * it makes after a sign-in it had to make or link an account for, stays in the page: the gate moves on to the address
 * the person asked for by itself. Every move is logged while it runs, so a later Clerk that moves elsewhere shows.
 */
export async function whileGoogleReturns<T>(path: string, finish: () => Promise<T>): Promise<T> {
  finishingOn = path;
  try {
    return await finish();
  } finally {
    finishingOn = null;
  }
}

/**
 * Clerk's `routerPush` and `routerReplace`: the move back to the page a return from Google is finishing on stays in the
 * page; any other move loads its address, as Clerk does with no router given.
 */
export const clerkMove: ClerkMove = (to, metadata) => {
  const address = new URL(to, window.location.href);
  if (finishingOn !== null) {
    const kept = address.origin === window.location.origin && address.pathname === finishingOn;
    console.log(`[app-kit clerk] back from Google: Clerk moved to ${address.pathname}, ${kept ? 'kept in the page' : 'loading it'}`);
    if (kept) return;
  }
  if (metadata?.windowNavigate) metadata.windowNavigate(address);
  else window.location.assign(address.href);
};

/** Clerk as a return from Google uses it. */
export interface RedirectClerk {
  session: unknown;
  handleRedirectCallback(
    params: { signInFallbackRedirectUrl: string; signUpFallbackRedirectUrl: string },
    customNavigate?: (to: string) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Finishes the sign-in Google has sent back to this page with Clerk's own handling, and calls `onUnfinished` when it
 * ends with no session. It calls the loaded Clerk, which the page holds as `window.Clerk`, rather than `useClerk()`'s:
 * Clerk React's own `handleRedirectCallback` (6.18.1) starts Clerk's without waiting for it, drops the function Clerk
 * calls when the sign-in is not done, and swallows its errors. `clerk` is used only before Clerk has loaded.
 */
export async function finishGoogleReturn(clerk: RedirectClerk, onUnfinished: () => void): Promise<void> {
  const loaded = (globalThis as { Clerk?: RedirectClerk }).Clerk ?? clerk;
  const here = window.location.pathname;
  try {
    await whileGoogleReturns(here, () =>
      loaded.handleRedirectCallback({ signInFallbackRedirectUrl: here, signUpFallbackRedirectUrl: here }, async () => {
        if (!loaded.session) onUnfinished();
      }),
    );
  } catch (error) {
    console.warn('[app-kit clerk] back from Google: Clerk could not finish the sign-in', error);
    onUnfinished();
  }
}
