import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { markUnreachable, resetConnection } from '../web/connection';
import { ErrorBoundary } from '../web/ErrorBoundary';
import { NotFound } from '../web/NotFound';
import { ConnectionLine } from '../web/lines';
import { PullToRefresh } from '../web/PullToRefresh';
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

/** A theme whose colors are CSS variables, which an app changes at run time, as getter's are with the time of day. */
const variableTheme = () =>
  createTheme({
    // Without native color, MUI throws working out a shade of a variable as it draws a Button or a Link.
    cssVariables: { nativeColor: true },
    palette: {
      primary: { main: 'var(--ink)', contrastText: 'var(--paper)' },
      background: { default: 'var(--paper)', paper: 'var(--paper)' },
      text: { primary: 'var(--ink)', secondary: 'var(--ink-soft)' },
      divider: 'var(--rule)',
    },
  });

test("the kit's own pieces draw under a theme whose colors are CSS variables", () => {
  const quiet = console.error;
  console.error = () => {};
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  markUnreachable();
  try {
    // Its own style cache: other tests replace the page's head, taking the shared cache's style tags with it.
    render(
      <CacheProvider value={createCache({ key: 'variables' })}>
        <ThemeProvider theme={variableTheme()}>
          <ConnectionLine />
          <RowLink href="/events/42">Dentist on Tuesday</RowLink>
          <PullToRefresh />
          <ErrorBoundary>
            <Broken />
          </ErrorBoundary>
        </ThemeProvider>
      </CacheProvider>,
    );
    // The pull's mark, drawn mid-pull.
    for (const [type, y] of [['touchstart', 100], ['touchmove', 160], ['touchmove', 240]] as const) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: 100, clientY: y }] });
      act(() => {
        document.body.dispatchEvent(event);
      });
    }
  } finally {
    console.error = quiet;
    delete (navigator as { standalone?: unknown }).standalone;
    resetConnection();
  }
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Dentist on Tuesday' })).toBeTruthy();
  expect(screen.getAllByRole('status').map((s) => s.getAttribute('aria-label') ?? s.textContent)).toEqual([
    'Cannot reach the server. This page reconnects by itself.',
    'Release to refresh',
  ]);
});

test("the crash screen's and the not-found page's message is in the theme's secondary text color", () => {
  const quiet = console.error;
  console.error = () => {};
  const theme = createTheme({ palette: { text: { primary: 'rgb(10, 10, 10)', secondary: 'rgb(120, 120, 120)' } } });
  try {
    // Its own style cache, as above.
    render(
      <CacheProvider value={createCache({ key: 'secondary' })}>
        <ThemeProvider theme={theme}>
          <ErrorBoundary>
            <Broken />
          </ErrorBoundary>
          <NotFound />
        </ThemeProvider>
      </CacheProvider>,
    );
  } finally {
    console.error = quiet;
  }
  // MUI 9 reads only `textSecondary` or `sx` for this; `color="text.secondary"` drew it in the primary color.
  expect(getComputedStyle(screen.getByText('Cannot read the calendar')).color).toBe('rgb(120, 120, 120)');
  expect(getComputedStyle(screen.getByText(/^Nothing is at /)).color).toBe('rgb(120, 120, 120)');
});
