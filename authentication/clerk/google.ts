import type { Outcome, SignInWith } from '../../web/sign-in/provider';
import { googleAccountParams, messageFor } from './email-code';

/**
 * Clerk's classic sign-in as the start of Google or Microsoft uses it. Its creation takes the account to sign in as,
 * which it passes to the provider as `login_hint`. Clerk's redirect call (`authenticateWithRedirect`) never took one, and the newer sign-in
 * object's `sso()` takes none either, so the kit starts Google here and goes to the address Clerk answers with, as
 * Clerk's own Expo kit does.
 */
export interface GoogleStartSignIn {
  create(params: {
    strategy: 'oauth_google' | 'oauth_microsoft';
    redirectUrl: string;
    actionCompleteRedirectUrl: string;
    oidcLoginHint?: string;
    oidcPrompt?: string;
  }): Promise<{ status: string | null; firstFactorVerification: { externalVerificationRedirectURL: URL | null } }>;
}

/** Clerk's strategy for each provider the kit signs in with. */
const STRATEGIES = { google: 'oauth_google', microsoft: 'oauth_microsoft' } as const;
const NAMES = { google: 'Google', microsoft: 'Microsoft' } as const;

export interface ProviderStart {
  back: string;
  account: string | null;
  go?: (address: string) => void;
}

/**
 * Sends the page to Google or Microsoft for `account`, or for the provider's list with null, coming back to `back`. On
 * success the page is already leaving, so only a failure comes back: a refusal, or a sign-in Clerk answers with no
 * provider's address, as when its bot check asks first.
 */
export async function startProvider(
  signIn: GoogleStartSignIn,
  signInWith: SignInWith,
  { back, account, go = (address) => window.location.assign(address) }: ProviderStart,
): Promise<Outcome> {
  const name = NAMES[signInWith];
  try {
    const started = await signIn.create({ strategy: STRATEGIES[signInWith], redirectUrl: back, actionCompleteRedirectUrl: back, ...googleAccountParams(account) });
    const address = started.firstFactorVerification.externalVerificationRedirectURL;
    if (!address) {
      console.warn(`[app-kit clerk] ${name} did not start: the sign-in is ${started.status ?? 'without a status'}, with no ${name} address`);
      return { ok: false, message: messageFor(undefined, account ?? '') };
    }
    go(address.toString());
    return { ok: true };
  } catch (error) {
    console.warn(`[app-kit clerk] ${name} did not start: ${clerkReason(error)}`);
    return { ok: false, message: messageFor(error, account ?? '') };
  }
}

/** Sends the page to Google: `startProvider` for Google. */
export const startGoogle = (signIn: GoogleStartSignIn, start: ProviderStart): Promise<Outcome> => startProvider(signIn, 'google', start);

/**
 * Clerk's own reason for a refusal, for the console: its error code, the HTTP status and its words, as its API errors
 * carry them, since the person is told only to try again.
 */
export function clerkReason(error: unknown): string {
  const refusal = (typeof error === 'object' && error !== null ? error : {}) as {
    status?: unknown;
    message?: unknown;
    errors?: { code?: unknown; message?: unknown; longMessage?: unknown }[];
  };
  const first = refusal.errors?.[0];
  const code = typeof first?.code === 'string' ? first.code : 'no code';
  const status = typeof refusal.status === 'number' ? `HTTP ${refusal.status}` : 'no HTTP status';
  const words = [first?.longMessage, first?.message, refusal.message].find((each) => typeof each === 'string') ?? String(error);
  return `${code} (${status}): ${words}`;
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

/** Clerk as a return from Google or Microsoft uses it. */
export interface RedirectClerk {
  session: unknown;
  /** The sign-in the return was for, whose state says why it ended with no session. */
  client?: { signIn?: { status?: string | null; firstFactorVerification?: { status?: string | null; error?: unknown } | null } | null } | null;
  handleRedirectCallback(
    params: { signInFallbackRedirectUrl: string; signUpFallbackRedirectUrl: string },
    customNavigate?: (to: string) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * What Clerk's own sign-in says about a return that ended with no session, for the console: its status, the first
 * factor's, and the first factor's error, as when Clerk will not take an address the provider has not verified.
 */
export function unfinishedReason(clerk: Pick<RedirectClerk, 'client'>): string {
  const signIn = clerk.client?.signIn;
  if (!signIn) return 'no sign-in in this browser';
  const verification = signIn.firstFactorVerification;
  const error = verification?.error ? `, ${clerkReason(verification.error)}` : '';
  return `sign-in ${signIn.status ?? 'without a status'}, first factor ${verification?.status ?? 'without a status'}${error}`;
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
        if (loaded.session) return;
        // As when Chrome moved Google's return into another of its profiles: Clerk keeps a sign-in in the client of the
        // browser that started it, and this one holds none it can finish.
        console.log(`[app-kit clerk] back from Google: Clerk ended with no session in this browser (${unfinishedReason(loaded)})`);
        onUnfinished();
      }),
    );
  } catch (error) {
    console.warn('[app-kit clerk] back from Google: Clerk could not finish the sign-in', error);
    onUnfinished();
  }
}
