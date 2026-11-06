import type { GoogleAccount } from './SignInGate';
import type { ProviderSession } from './provider';

/** Where the window's sign-in through the sheet stands, as `useDesktopSignInWindow` says it. */
export type IphoneSignInWindow = { state: 'waiting' } | { state: 'signing-in' } | { state: 'signed-in' } | { state: 'failed'; message: string };

/**
 * What the sign-in gate needs to run iPhone Google sign-in's in-between steps itself: in the app, Apple's sheet and the
 * sign-in it hands back; on the page the sheet opens, the trip to Google. `app-kit/tauri/iphone-sign-in`'s
 * `iphoneSignInForGate` makes one, so nothing under `web/` imports Tauri.
 */
export interface IphoneSignIn {
  /** On the page Apple's sheet (or a desktop app's browser) opened, the Google account the app asked for; null elsewhere. */
  asked(): GoogleAccount | null;
  /** Whether this tab has gone to Google for this page's request already, as after Back from Google. */
  wentToGoogle(): boolean;
  /** Notes that this tab goes to Google for this page's request, and says whether it could: false with storage blocked. */
  noteGoingToGoogle(): boolean;
  /** Whether Continue with Google opens Apple's sheet here: only in the iPhone app. */
  opensSheet(): boolean;
  /** Opens Apple's sheet for the choice, and says whether it handed a sign-in over: false when it was closed or failed. */
  open(choice: GoogleAccount, lastAccount: string | null): Promise<boolean>;
  /** Signs in with the sign-in the sheet hands back. A hook: the gate calls it on every render. */
  useWindow(session: Pick<ProviderSession, 'loaded' | 'person' | 'ticket' | 'token'>): IphoneSignInWindow;
}
