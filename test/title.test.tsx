import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { NotFound } from '../web/NotFound';
import { NavigateProvider } from '../web/RowLink';
import { nameApp, titleFor, useTitle } from '../web/title';

beforeEach(() => {
  nameApp('argon-watcher');
  document.title = 'argon-watcher';
});
afterEach(() => {
  cleanup();
  nameApp('');
  window.history.replaceState(null, '', '/');
});

function Screen({ words }: { words: string | null }) {
  useTitle(words);
  return null;
}

test("a screen's title is its words, then the app's name", () => {
  expect(titleFor('Inbox')).toBe('Inbox · argon-watcher');
});

test("a screen with no words of its own shows the app's name alone", () => {
  expect(titleFor(null)).toBe('argon-watcher');
  expect(titleFor('')).toBe('argon-watcher');
});

test('an app that never named itself shows the words alone', () => {
  nameApp('');
  expect(titleFor('Inbox')).toBe('Inbox');
});

test('the title is set while the screen shows and put back when it goes', () => {
  const { rerender, unmount } = render(<Screen words="Inbox" />);
  expect(document.title).toBe('Inbox · argon-watcher');
  rerender(<Screen words="Archive" />);
  expect(document.title).toBe('Archive · argon-watcher');
  unmount();
  expect(document.title).toBe('argon-watcher');
});

test('an unknown address shows that address, a link home and its own title, with no move away', () => {
  window.history.replaceState(null, '', '/mail/gone?from=digest');
  const went: string[] = [];
  render(
    <NavigateProvider navigate={(href) => went.push(href)}>
      <NotFound />
    </NavigateProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Not found' })).toBeTruthy();
  expect(screen.getByText('Nothing is at /mail/gone?from=digest.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
  expect(document.title).toBe('Not found · argon-watcher');
  expect(window.location.pathname).toBe('/mail/gone');
  expect(went).toEqual([]);
});

test("the link goes to the app's own home when it has another", () => {
  render(<NotFound home="/inbox" />);
  expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/inbox');
});
