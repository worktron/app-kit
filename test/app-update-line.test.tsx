/*
 * The Mac app's update line (tauri/window/lines.tsx): what it says in each state the window tells the page, the link its
 * buttons open, and nothing at all outside the Mac window.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AppUpdateLine, appUpdateMessage, UPDATE_EVENT, UPDATE_FLAG } from '../tauri/window';

const page = window as unknown as Record<string, unknown>;

const tell = (state: unknown) => {
  page[UPDATE_FLAG] = state;
  window.dispatchEvent(new Event(UPDATE_EVENT));
};

afterEach(() => {
  cleanup();
  delete page[UPDATE_FLAG];
});

test('outside the Mac window, and until a release is found, the line draws nothing', () => {
  const { container } = render(<AppUpdateLine appName="Atlas" scheme="com.example.app" />);
  expect(container.innerHTML).toBe('');
  // A state the page does not know, as a later shell might send, draws nothing either.
  act(() => tell('something newer'));
  expect(container.innerHTML).toBe('');
});

test('a release found offers Update, which opens the update link', () => {
  render(<AppUpdateLine appName="Atlas" scheme="com.example.app" />);
  act(() => tell('available'));
  expect(screen.getByRole('status').textContent).toContain('A new version of Atlas for Mac is ready.');
  expect(screen.getByRole('link', { name: 'Update' }).getAttribute('href')).toBe('com.example.app://update');
});

test('while the update installs, the line says so and offers nothing', () => {
  page[UPDATE_FLAG] = 'installing';
  render(<AppUpdateLine appName="Atlas" scheme="com.example.app" />);
  expect(screen.getByRole('status').textContent).toBe('Updating Atlas for Mac. It restarts once the new version is in place.');
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

test('a failed update offers Try again, which opens the same link', () => {
  render(<AppUpdateLine appName="Atlas" scheme="com.example.app" />);
  act(() => tell('available'));
  act(() => tell('failed'));
  expect(screen.getByRole('status').textContent).toContain('Atlas for Mac could not update.');
  expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('com.example.app://update');
  // Once the window has nothing to offer again, the line goes.
  act(() => tell(undefined));
  expect(screen.queryByRole('status')).toBeNull();
});

test("the line's words are the ones an app drawing its own lines gets", () => {
  expect(appUpdateMessage('Atlas', 'available')).toEqual({ message: 'A new version of Atlas for Mac is ready.', action: 'Update' });
  expect(appUpdateMessage('Atlas', 'installing').action).toBeNull();
  expect(appUpdateMessage('Atlas', 'failed').action).toBe('Try again');
});
