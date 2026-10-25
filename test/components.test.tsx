import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../web/ErrorBoundary';
import { NavigateProvider, RowLink } from '../web/RowLink';

afterEach(cleanup);

function rowGoingTo(href: string, navigate?: (href: string) => void) {
  const link = <RowLink href={href}>Dentist on Tuesday</RowLink>;
  render(navigate ? <NavigateProvider navigate={navigate}>{link}</NavigateProvider> : link);
  return screen.getByRole('link', { name: 'Dentist on Tuesday' });
}

test('a row is a real link to its address', () => {
  expect(rowGoingTo('/events/42').getAttribute('href')).toBe('/events/42');
});

test("a plain click moves within the page through the app's navigate", () => {
  const went: string[] = [];
  const row = rowGoingTo('/events/42', (href) => went.push(href));
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  row.dispatchEvent(click);
  expect(went).toEqual(['/events/42']);
  expect(click.defaultPrevented).toBe(true);
});

test('⌘-click, ctrl-click, shift-click and middle-click are left to the browser, which opens a new tab or window', () => {
  const went: string[] = [];
  const row = rowGoingTo('/events/42', (href) => went.push(href));
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    row.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  }
  expect(went).toEqual([]);
});

test('with no navigate given, the link loads its page as any link does', () => {
  const row = rowGoingTo('/events/42');
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  row.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);
});

function Broken(): never {
  throw new Error('Cannot read the calendar');
}

test('a crash shows what failed and a Reload button', () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
  } finally {
    console.error = quiet;
  }
  expect(screen.getByRole('alert').textContent).toContain('Cannot read the calendar');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
});

test("an app's own fallback is drawn in place of the default", () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    render(
      <ErrorBoundary fallback={(error) => <p>timescale stopped: {error.message}</p>}>
        <Broken />
      </ErrorBoundary>,
    );
  } finally {
    console.error = quiet;
  }
  expect(screen.getByText('timescale stopped: Cannot read the calendar')).toBeTruthy();
  fireEvent.click(document.body);
});
