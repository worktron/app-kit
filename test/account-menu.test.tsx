import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountMenu, type AccountMenuItem, type AccountMenuProps } from '../web/AccountMenu';
import { NavigateProvider } from '../web/RowLink';
import { SignInGate } from '../web/sign-in/SignInGate';
import { standInSignIn, type StandInSignIn } from '../authentication/stand-in';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(cleanup);

const ana = { id: 'p1', email: 'ana@example.com' };

function draw(provider: StandInSignIn | null, items?: AccountMenuItem[], navigate?: (href: string) => void, props: AccountMenuProps = {}) {
  const menu = <AccountMenu items={items} {...props} />;
  return render(
    <SignInGate provider={provider} placeholder={<div role="progressbar">app</div>} signedOut={<h1>Sign in</h1>}>
      <header>{navigate ? <NavigateProvider navigate={navigate}>{menu}</NavigateProvider> : menu}</header>
    </SignInGate>,
  );
}

const open = () => act(async () => screen.getByRole('button', { name: 'Account' }).click());
const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);
/** Escape closes the menu, and the test waits for it to go, so its transitions end inside the test. */
async function shut() {
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

test('outside the sign-in gate, and with no sign-in provider, there is no account menu', () => {
  render(<AccountMenu />);
  expect(screen.queryByRole('button')).toBeNull();
  cleanup();
  draw(null);
  expect(screen.queryByRole('button')).toBeNull();
});

test('the Account button\'s menu says who is signed in, above Sign out', async () => {
  draw(standInSignIn({ person: ana }));
  const button = screen.getByRole('button', { name: 'Account' });
  expect(button.getAttribute('aria-haspopup')).toBe('menu');
  await open();
  expect(screen.getByText('Signed in as')).toBeTruthy();
  expect(menuItems()).toEqual(['Sign out']);
  await shut();
});

test('Sign out in the menu goes straight to the sign-in screen', async () => {
  const provider = standInSignIn({ person: ana });
  draw(provider);
  await open();
  await act(async () => screen.getByRole('menuitem', { name: 'Sign out' }).click());
  expect(screen.getByRole('heading').textContent).toBe('Sign in');
  expect(provider.calls.signOut).toBe(1);
});

test("the app's items come before Sign out, a screen as a real link and an act as an item", async () => {
  const went: string[] = [];
  let debugged = 0;
  draw(standInSignIn({ person: ana }), [{ label: 'Settings', href: '/settings' }, { label: 'Debug', onSelect: () => debugged++ }], (href) => went.push(href));
  await open();
  expect(menuItems()).toEqual(['Settings', 'Debug', 'Sign out']);
  const settings = screen.getByRole('menuitem', { name: 'Settings' });
  expect(settings.tagName).toBe('A');
  expect(settings.getAttribute('href')).toBe('/settings');

  await act(async () => settings.click());
  expect(went).toEqual(['/settings']);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  await open();
  await act(async () => screen.getByRole('menuitem', { name: 'Debug' }).click());
  expect(debugged).toBe(1);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('⌘-click on a screen in the menu is left to the browser, which opens a new tab', async () => {
  const went: string[] = [];
  draw(standInSignIn({ person: ana }), [{ label: 'Settings', href: '/settings' }], (href) => went.push(href));
  await open();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
  act(() => void screen.getByRole('menuitem', { name: 'Settings' }).dispatchEvent(click));
  expect(click.defaultPrevented).toBe(false);
  expect(went).toEqual([]);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('an account with no address has no Signed in as', async () => {
  draw(standInSignIn({ person: { id: 'p2', email: null } }));
  await open();
  expect(screen.queryByText('Signed in as')).toBeNull();
  expect(menuItems()).toEqual(['Sign out']);
  await shut();
});

test("the person's name, when the provider knows it, goes above the address, unless the app says not to", async () => {
  draw(standInSignIn({ person: { ...ana, name: 'Ana Lima' } }));
  await open();
  const header = screen.getByText('Signed in as').parentElement!;
  expect([...header.children].map((line) => line.textContent)).toEqual(['Signed in as', 'Ana Lima', 'ana@example.com']);
  await shut();
  cleanup();
  draw(standInSignIn({ person: { ...ana, name: 'Ana Lima' } }), undefined, undefined, { showName: false });
  await open();
  expect(screen.queryByText('Ana Lima')).toBeNull();
  expect(screen.getByText('ana@example.com')).toBeTruthy();
  await shut();
});

test("with button set to initial, the button is the first letter of the person's name, or of the address with no name, still called Account", async () => {
  draw(standInSignIn({ person: { ...ana, name: 'Ana Lima' } }), undefined, undefined, { button: 'initial' });
  expect(screen.getByRole('button', { name: 'Account' }).textContent).toBe('A');
  cleanup();
  draw(standInSignIn({ person: { id: 'p3', email: 'zoe@example.com' } }), undefined, undefined, { button: 'initial' });
  expect(screen.getByRole('button', { name: 'Account' }).textContent).toBe('Z');
  await open();
  expect(menuItems()).toEqual(['Sign out']);
  await shut();
});
