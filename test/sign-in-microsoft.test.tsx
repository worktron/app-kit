// Microsoft beside Google: the gate's trip, the remembered provider for Continue as, the desktop app's window asking
// the browser for Microsoft, the browser page that hands sign-in back, and the iPhone's sheet and its lines.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_UNFINISHED,
  MICROSOFT_UNFINISHED,
  OPENING_MICROSOFT,
  SIGNING_IN_WITH_MICROSOFT,
  SignInGate,
  useSignIn,
  useSignOut,
  type GoogleAccount,
} from '../web/sign-in/SignInGate';
import { googleCallback, lastAccount, lastAccountWith } from '../web/sign-in/remembered';
import type { IphoneSignIn, IphoneSignInWindow } from '../web/sign-in/iphone-sign-in';
import type { SignInWith } from '../web/sign-in/provider';
import { STAND_IN_CODE, standInSignIn, type StandInSignIn } from '../authentication/stand-in';
import { desktopSignInAddress, desktopSignInRequest, startGoogleHere, useDesktopSignInBrowserPage, WITH_PARAM } from '../tauri/sign-in';
import { iphoneSignInForGate } from '../tauri/iphone-sign-in';
import { fingerprint, randomHex } from '../tauri/sign-in/fingerprint';

/** happy-dom moves to whatever address the page sets; each test starts back on the site. */
const goTo = (address: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://localhost:5173${address}`);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  goTo('/');
});

afterEach(() => {
  cleanup();
  goTo('/');
});

/** An app's sign-in screen with both providers, Continue as going back to the provider the account used. */
function SignInScreen() {
  const signIn = useSignIn();
  const [message, setMessage] = useState<string>();
  const go = (signInWith: SignInWith, account: GoogleAccount) => async () => {
    const outcome = await signIn[signInWith](account);
    if (!outcome.ok) setMessage(outcome.message);
  };
  return (
    <main>
      <h1>Sign in</h1>
      {signIn.notice && <p role="alert">{signIn.notice}</p>}
      {message && <p>{message}</p>}
      {signIn.lastAccount && <button onClick={go(signIn.lastAccountWith, 'remembered')}>Continue as {signIn.lastAccount}</button>}
      <button onClick={go('google', 'choose')}>Google</button>
      <button onClick={go('microsoft', 'choose')}>Microsoft</button>
      <button
        onClick={async () => {
          await signIn.sendEmailCode('ana@example.com');
          await signIn.checkEmailCode(STAND_IN_CODE, 'ana@example.com');
        }}
      >
        Email code
      </button>
    </main>
  );
}

function App() {
  const signOut = useSignOut();
  return (
    <main>
      <h1>The app</h1>
      <button onClick={() => signOut?.()}>Sign out</button>
    </main>
  );
}

function draw(provider: StandInSignIn, iphoneSignIn?: IphoneSignIn) {
  const iphone = iphoneSignIn ? { iphoneSignIn, placeholderWithLine: (line: string) => <div role="progressbar">{line}</div> } : {};
  return render(
    <SignInGate provider={provider} placeholder={<div role="progressbar">wordmark</div>} signedOut={<SignInScreen />} {...iphone}>
      <App />
    </SignInGate>,
  );
}

const heading = () => screen.queryByRole('heading')?.textContent ?? null;
const press = (name: string | RegExp) => act(async () => screen.getByRole('button', { name }).click());

/** Google's or Microsoft's return to the callback path, as the page loads again there. */
async function comeBack(provider: StandInSignIn, iphoneSignIn?: IphoneSignIn) {
  cleanup();
  const [path, query] = provider.calls.microsoft.concat(provider.calls.google).at(-1)!.callbackPath.split('?');
  goTo(`${path}?${query}`);
  draw(provider, iphoneSignIn);
  await waitFor(() => expect(heading()).not.toBe(null));
}

test('Microsoft goes to Microsoft for its list, comes back to the asked address, and Continue as goes back to Microsoft', async () => {
  goTo('/week');
  const provider = standInSignIn({ store: sessionStorage, leaveForGoogle: () => {} });
  draw(provider);
  await press('Microsoft');
  expect(provider.calls.microsoft).toEqual([{ callbackPath: googleCallback(GOOGLE_CALLBACK_PATH, '/week'), account: null }]);
  expect(provider.calls.google).toEqual([]);

  await comeBack(provider);
  expect(heading()).toBe('The app');
  expect(window.location.pathname).toBe('/week');
  expect(lastAccount()).toBe('chosen@example.com');
  expect(lastAccountWith()).toBe('microsoft');

  // The session ends from elsewhere, keeping the account: Continue as names it to Microsoft, not Google.
  act(() => provider.endSession());
  expect(heading()).toBe('Sign in');
  await press('Continue as chosen@example.com');
  expect(provider.calls.microsoft.at(-1)!.account).toBe('chosen@example.com');
  expect(provider.calls.google).toEqual([]);
});

test('signing out forgets which provider the account used, and an emailed code reads as Google, as before', async () => {
  const provider = standInSignIn({ store: sessionStorage, leaveForGoogle: () => {} });
  draw(provider);
  await press('Microsoft');
  await comeBack(provider);
  expect(lastAccountWith()).toBe('microsoft');

  await press('Sign out');
  expect(lastAccount()).toBeNull();
  expect(lastAccountWith()).toBe('google');

  await press('Microsoft');
  await comeBack(provider);
  act(() => provider.endSession());
  await press('Email code');
  expect(heading()).toBe('The app');
  expect(lastAccount()).toBe('ana@example.com');
  expect(lastAccountWith()).toBe('google');
});

test('a Microsoft return that did not finish says Microsoft did not finish; a Google one still says Google', async () => {
  const provider = standInSignIn({ store: sessionStorage, leaveForGoogle: () => {} });
  draw(provider);
  await press('Microsoft');
  // The provider kept nothing for this tab, as when Chrome moved the return into another profile.
  sessionStorage.removeItem('stand-in.google');
  await comeBack(provider);
  expect(screen.getByRole('alert').textContent).toBe(MICROSOFT_UNFINISHED);

  await press('Google');
  sessionStorage.removeItem('stand-in.google');
  await comeBack(provider);
  expect(screen.getByRole('alert').textContent).toBe(GOOGLE_UNFINISHED);
});

test("the desktop app's window asks the browser for Microsoft by name, Google's address is as before, and a sign-in by ticket remembers Microsoft", async () => {
  const google = new URL(desktopSignInAddress({ account: 'ana@example.com' }));
  expect(google.searchParams.has(WITH_PARAM)).toBe(false);
  expect([...google.searchParams.keys()]).toEqual(['nonce', 'account']);
  const microsoft = new URL(desktopSignInAddress({ account: 'ana@example.com' }, 'microsoft'));
  expect(microsoft.searchParams.get(WITH_PARAM)).toBe('microsoft');
  // The same secret: a second click, on either button, leaves the first tab's sign-in good.
  expect(microsoft.searchParams.get('nonce')).toBe(google.searchParams.get('nonce'));

  // The window then signs in by the ticket the browser handed back, which names no provider.
  const provider = standInSignIn({ store: sessionStorage });
  draw(provider);
  act(() => provider.signInAs({ id: 'p1', email: 'ana@example.com' }));
  expect(heading()).toBe('The app');
  expect(lastAccountWith()).toBe('microsoft');
});

test('the browser page reads the provider the window asked for, Google when it names none', () => {
  const nonce = fingerprint(randomHex());
  goTo(`/desktop-sign-in?nonce=${nonce}&account=ana%40example.com`);
  expect(desktopSignInRequest()?.with).toBe('google');
  goTo(`/desktop-sign-in?nonce=${nonce}&account=ana%40example.com&with=microsoft`);
  expect(desktopSignInRequest()?.with).toBe('microsoft');
  goTo(`/desktop-sign-in?nonce=${nonce}&with=elsewhere`);
  expect(desktopSignInRequest()?.with).toBe('google');
});

/** The browser page: the app's sign-in screen goes to the provider the window asked for, once per tab. */
function BrowserSignIn() {
  const signIn = useSignIn();
  useEffect(() => {
    const asked = desktopSignInRequest();
    if (asked && startGoogleHere()) void signIn[asked.with](asked.account ?? 'choose');
  }, [signIn]);
  return <h1>Sign in</h1>;
}

function HandOver({ provider }: { provider: StandInSignIn }) {
  const page = useDesktopSignInBrowserPage({ session: provider.useSession(), scheme: 'example-app' });
  return <h1>{page.state}</h1>;
}

test('a browser already signed in as the account the window named, maybe with Google, goes to Microsoft before handing over when the window asked for Microsoft', async () => {
  const nonce = fingerprint(randomHex());
  const ana = { id: 'p1', email: 'ana@example.com' };
  const render1 = (address: string, provider: StandInSignIn) => {
    cleanup();
    goTo(address);
    sessionStorage.clear();
    render(
      <SignInGate provider={provider} placeholder={<div role="progressbar" />} signedOut={<BrowserSignIn />}>
        <HandOver provider={provider} />
      </SignInGate>,
    );
  };

  // Google, as before: signed in as the account named, the page is ready to hand over.
  const google = standInSignIn({ person: ana, leaveForGoogle: () => {} });
  render1(`/desktop-sign-in?nonce=${nonce}&account=ana%40example.com`, google);
  await waitFor(() => expect(heading()).toBe('ready'));
  expect(google.calls.signOut).toBe(0);

  // Microsoft: the same browser signs out and goes to Microsoft for the account named.
  const microsoft = standInSignIn({ person: ana, leaveForGoogle: () => {} });
  render1(`/desktop-sign-in?nonce=${nonce}&account=ana%40example.com&with=microsoft`, microsoft);
  await waitFor(() => expect(microsoft.calls.signOut).toBe(1));
  await waitFor(() => expect(microsoft.calls.microsoft).toHaveLength(1));
  expect(microsoft.calls.microsoft[0]!.account).toBe('ana@example.com');
  expect(microsoft.calls.google).toEqual([]);
});

/** iPhone sign-in as the gate takes it, with the sheet in the test's hands. */
function fakeIphone({ asked = null, askedWith = 'google', inApp = false }: { asked?: GoogleAccount | null; askedWith?: SignInWith; inApp?: boolean } = {}) {
  let noted = false;
  const sheets: { choice: GoogleAccount; signInWith: SignInWith | undefined; close: (handed: boolean) => void }[] = [];
  const iphone: IphoneSignIn = {
    asked: () => asked,
    askedWith: () => askedWith,
    wentToGoogle: () => noted,
    noteGoingToGoogle: () => {
      if (noted) return false;
      noted = true;
      return true;
    },
    opensSheet: () => inApp,
    open: (choice, _last, signInWith) => new Promise<boolean>((close) => sheets.push({ choice, signInWith, close })),
    useWindow: (): IphoneSignInWindow => ({ state: 'waiting' }),
  };
  return { iphone, sheets };
}

test("in the iPhone app, Microsoft opens the sheet for Microsoft, with Microsoft's line under the wordmark", async () => {
  const { iphone, sheets } = fakeIphone({ inApp: true });
  draw(standInSignIn(), iphone);
  await press('Microsoft');
  expect(sheets.map((sheet) => [sheet.choice, sheet.signInWith])).toEqual([['choose', 'microsoft']]);
  expect(screen.getByRole('progressbar').textContent).toBe(SIGNING_IN_WITH_MICROSOFT);
  await act(async () => sheets[0]!.close(false));
  expect(heading()).toBe('Sign in');
});

test("on the page Apple's sheet opens for Microsoft, the gate goes to Microsoft, with Microsoft's line", async () => {
  goTo('/desktop-sign-in?nonce=abc&account=choose&with=microsoft');
  const provider = standInSignIn({ leaveForGoogle: () => {} });
  draw(provider, fakeIphone({ asked: 'choose', askedWith: 'microsoft' }).iphone);
  await waitFor(() => expect(provider.calls.microsoft).toHaveLength(1));
  expect(provider.calls.google).toEqual([]);
  expect(screen.getByRole('progressbar').textContent).toBe(OPENING_MICROSOFT);
});

test("the kit's iPhone sign-in reads the provider from the sheet's page, and asks the sheet's page for it", () => {
  const sheet = iphoneSignInForGate({ scheme: 'com.example.app', invoke: async () => ({}) });
  goTo(`/desktop-sign-in?nonce=${fingerprint(randomHex())}&account=choose&with=microsoft`);
  expect(sheet.askedWith?.()).toBe('microsoft');
  goTo(`/desktop-sign-in?nonce=${fingerprint(randomHex())}&account=choose`);
  expect(sheet.askedWith?.()).toBe('google');
  goTo('/');
  expect(sheet.askedWith?.()).toBe('google');
});
