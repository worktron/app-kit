import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { GoogleReturnProps, Outcome, ProviderSession, SignedInPerson, SignInProvider } from '../src/sign-in/provider';
import type { KeyValueStore } from '../src/storage';

/** The code the stand-in takes, as Clerk's development instance takes 424242 for a +clerk_test address. */
export const STAND_IN_CODE = '424242';
export const WRONG_CODE = 'That code did not match. Use the newest email, or send a new code.';

const PERSON_KEY = 'stand-in.person';
const GOOGLE_KEY = 'stand-in.google';

/** Everything the stand-in was asked, for tests to check. */
export interface StandInCalls {
  google: { callbackPath: string; account: string | null }[];
  sendEmailCode: string[];
  checkEmailCode: string[];
  signOut: number;
  tokens: { fresh: boolean }[];
}

export interface StandInSignIn extends SignInProvider {
  calls: StandInCalls;
  /** Signs someone in as if the provider had, as a sign-in in another tab would. */
  signInAs(person: SignedInPerson): void;
  /** Ends the session as if from elsewhere: another tab, or the provider. */
  endSession(): void;
  /** The provider now knows whether anyone is signed in. */
  finishLoading(): void;
}

export interface StandInOptions {
  /** Who is signed in when the page loads, unless `store` remembers otherwise. */
  person?: SignedInPerson | null;
  /** False keeps the stand-in loading until `finishLoading`, as a provider's script still on its way. */
  loaded?: boolean;
  /**
   * Keeps who is signed in across page loads, as a provider's cookie does, and the trip to Google. The browser
   * test passes sessionStorage; unit tests leave it out.
   */
  store?: KeyValueStore;
  /** What a Google sign-in does. The default leaves the page for the callback path, as the real trip does. */
  leaveForGoogle?: (callbackPath: string) => void;
}

/** A sign-in provider with no network, for tests of the kit and of apps built on it. */
export function standInSignIn({ person = null, loaded = true, store, leaveForGoogle = (path) => window.location.assign(path) }: StandInOptions = {}): StandInSignIn {
  const stored = store?.getItem(PERSON_KEY);
  let state = { loaded, person: stored ? (JSON.parse(stored) as SignedInPerson) : stored === '' ? null : person };
  let tokenCount = 0;
  const listeners = new Set<() => void>();
  const calls: StandInCalls = { google: [], sendEmailCode: [], checkEmailCode: [], signOut: 0, tokens: [] };

  const set = (next: Partial<typeof state>) => {
    state = { ...state, ...next };
    if ('person' in next) store?.setItem(PERSON_KEY, state.person ? JSON.stringify(state.person) : '');
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const ok: Outcome = { ok: true };

  const session = {
    token: async (options?: { fresh?: boolean }) => {
      calls.tokens.push({ fresh: options?.fresh === true });
      if (!state.person) return null;
      if (options?.fresh) tokenCount++;
      return `stand-in-token-${tokenCount}`;
    },
    google: async ({ callbackPath, account }: { callbackPath: string; account: string | null }) => {
      calls.google.push({ callbackPath, account });
      store?.setItem(GOOGLE_KEY, account ?? 'chosen@example.com');
      leaveForGoogle(callbackPath);
      return ok;
    },
    sendEmailCode: async (email: string) => {
      calls.sendEmailCode.push(email);
      return ok;
    },
    checkEmailCode: async (code: string, email: string): Promise<Outcome> => {
      calls.checkEmailCode.push(code);
      if (code !== STAND_IN_CODE) return { ok: false, message: WRONG_CODE };
      set({ person: { id: `person-${email}`, email } });
      return ok;
    },
    signOut: async () => {
      calls.signOut++;
      set({ person: null });
    },
  };

  function useSession(): ProviderSession {
    const now = useSyncExternalStore(subscribe, () => state);
    return { ...session, loaded: now.loaded, person: now.person };
  }

  /** Google said yes when the trip was started from this tab, and no when the person came back without one. */
  function GoogleReturn({ onUnfinished }: GoogleReturnProps) {
    const ran = useRef(false);
    useEffect(() => {
      if (ran.current) return;
      ran.current = true;
      const account = store?.getItem(GOOGLE_KEY);
      store?.removeItem(GOOGLE_KEY);
      if (account) set({ person: { id: `person-${account}`, email: account } });
      else onUnfinished();
    }, [onUnfinished]);
    return null;
  }

  return {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSession,
    GoogleReturn,
    calls,
    signInAs: (who) => set({ person: who }),
    endSession: () => set({ person: null }),
    finishLoading: () => set({ loaded: true }),
  };
}
