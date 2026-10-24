import type { ComponentType, ReactNode } from 'react';

/** The person signed in, as the app shows them. */
export interface SignedInPerson {
  id: string;
  email: string | null;
}

/** Whether a step worked, and if not, what to tell the person, in words that say what to do next. */
export type Outcome = { ok: true } | { ok: false; message: string };

/**
 * What the kit needs from a sign-in provider such as Clerk or WorkOS, read on each render inside the provider's
 * `Root`. An adapter for another provider implements this and nothing in an app changes beyond which adapter it
 * passes to the gate.
 */
export interface ProviderSession {
  /** False until the provider knows whether anyone is signed in. */
  loaded: boolean;
  person: SignedInPerson | null;
  /** A token for a request to the app's server. `fresh` asks the provider for a new one rather than its cached one. */
  token(options?: { fresh?: boolean }): Promise<string | null>;
  /**
   * Sends the browser to Google. Google returns to `callbackPath`, where the gate draws the provider's
   * `GoogleReturn`. `account` names the account to sign in as, so Google shows no page while it is still signed in to
   * it; null has Google list its accounts. On success the browser is already leaving, so only a failure comes back.
   */
  google(options: { callbackPath: string; account: string | null }): Promise<Outcome>;
  /** Starts a sign-in for the address and emails it a code. */
  sendEmailCode(email: string): Promise<Outcome>;
  /** Checks the emailed code and makes its session the active one. */
  checkEmailCode(code: string, email: string): Promise<Outcome>;
  /** Ends the session and stays on this page: no page load. */
  signOut(): Promise<void>;
}

/**
 * Finishes a sign-in Google has just sent back, drawing nothing of its own. Once its session is active the gate
 * moves to the address the person asked for, with no page load; a sign-in Google did not finish calls `onUnfinished`.
 */
export interface GoogleReturnProps {
  onUnfinished: () => void;
}

/** A sign-in provider as the gate takes it: its own context around the app, the session hook, and Google's return. */
export interface SignInProvider {
  Root: ComponentType<{ children: ReactNode }>;
  useSession(): ProviderSession;
  GoogleReturn: ComponentType<GoogleReturnProps>;
}
