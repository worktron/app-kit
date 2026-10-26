/**
 * The session the sign-in gate holds, for the fetch wrapper, which runs outside React. The gate sets it as it draws;
 * with no gate, as in local development without a provider, requests go without a token and a 401 is an error.
 */
export interface CurrentSession {
  token(options?: { fresh?: boolean }): Promise<string | null>;
  /** The server refused the session: the gate brings sign-in up over the current address. */
  refused(): void;
  /** When the person last signed in on this page, or 0 when the page loaded already signed in. */
  signedInAt: number;
}

let current: CurrentSession | null = null;

export function setCurrentSession(session: CurrentSession | null): void {
  current = session;
}

export function currentSession(): CurrentSession | null {
  return current;
}

const signedOutListeners = new Set<() => void>();

/** Calls `listener` each time the gate learns nobody is signed in, for what the page keeps that belongs to a person. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

/** The gate has learned nobody is signed in: signed out here, in another tab or by the session ending. */
export function announceSignedOut(): void {
  for (const listener of signedOutListeners) listener();
}
