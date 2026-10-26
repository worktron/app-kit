import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { resetConnection } from '../web/connection';
import { ErrorBoundary } from '../web/ErrorBoundary';
import { savedCopies, thisBuild, useSavedCopy, useSaveAfterDraw, useScreenData, type CopyStore, type SavedCopies, type SavedCopy } from '../web/saved-copies';
import { SignInGate } from '../web/sign-in/SignInGate';
import { standInSignIn } from '../authentication/stand-in';

const realFetch = globalThis.fetch;
const quiet = console.error;

/** The server, played here: each path's answer, a status with no body, or `hold`, which waits for the test to answer. */
let answers: Record<string, unknown> = {};
let asked: string[] = [];
/** The held requests for each path, oldest first, each answered when the test calls it. */
let held: Record<string, ((body: unknown) => void)[]> = {};

beforeEach(() => {
  localStorage.clear();
  answers = {};
  asked = [];
  held = {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    asked.push(path);
    const answer = path in answers ? answers[path] : 'hold';
    if (answer === 'hold') return new Promise<Response>((resolve) => (held[path] ??= []).push((body) => resolve(Response.json(body))));
    if (typeof answer === 'number') return new Response('', { status: answer });
    return Response.json(answer);
  }) as typeof fetch;
  // The kit's error boundary reports each crash on the console, as React does: expected here.
  console.error = () => {};
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  console.error = quiet;
  resetConnection();
  document.head.innerHTML = '';
});

type Shelf = { items: string[] };

/** A screen that draws a shelf as this build knows it, and crashes on any other shape, as a screen does. */
function ShelfScreen({ copies, path = '/api/shelf' }: { copies: SavedCopies; path?: string }) {
  const shelf = useScreenData<Shelf>(copies, path);
  if (shelf.missing) return <p>Not found</p>;
  if (!shelf.data) return <p>{shelf.failure ?? (shelf.previous ? `Still showing ${shelf.previous.items.join(', ')}` : 'Loading')}</p>;
  return (
    <>
      {shelf.failure && <p>{shelf.failure}</p>}
      <ul>
        {shelf.data.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** A load of the page: the app's copies made as its code loads, and its screen drawn inside the error boundary. */
function load(build: string | null, path?: string) {
  cleanup();
  const copies = savedCopies('shop', { build });
  render(
    <ErrorBoundary>
      <ShelfScreen copies={copies} path={path} />
    </ErrorBoundary>,
  );
  return copies;
}

const copyKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('shop:copy:'));
const saved = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as SavedCopy<Shelf> | null;

/** Waits for the request to `path` the test holds, and answers the oldest one. */
async function answer(path: string, body: unknown) {
  await waitFor(() => expect(held[path]?.length).toBeGreaterThan(0));
  await act(async () => held[path]!.shift()!(body));
}

test('an answer this build cannot draw is never saved, so the next load draws from the network', async () => {
  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:anyone:/api/shelf']));

  // A newer server's answer, as an open page gets while a deploy goes out or is rolled back.
  answers['/api/shelf'] = { at: '2026-10-25T20:00:00Z' };
  load('index-a');
  expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
  expect(saved('shop:copy:index-a:anyone:/api/shelf')?.data).toEqual({ items: ['Milk'] });

  // The server is rolled back. The next load paints the copy it last drew and then the server's answer.
  answers['/api/shelf'] = { items: ['Milk', 'Bread'] };
  load('index-a');
  expect(screen.getByText('Milk')).toBeTruthy();
  await screen.findByText('Bread');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a first answer this build cannot draw leaves no copy, and the next load asks the server', async () => {
  answers['/api/shelf'] = { at: '2026-10-25T20:00:00Z' };
  load('index-a');
  await screen.findByRole('alert');
  // Every effect of what drew is run by now, as act runs them all before it returns.
  await act(async () => {});
  expect(copyKeys()).toEqual([]);

  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  expect(asked.filter((path) => path === '/api/shelf')).toHaveLength(2);
});

test("copies saved by another build are never read, and are deleted as the app's copies are made", async () => {
  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-old');
  await screen.findByText('Milk');
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-old:anyone:/api/shelf']));
  // The app's other storage under its name, which is not a copy.
  localStorage.setItem('shop:theme', 'dark');

  delete answers['/api/shelf'];
  load('index-new');
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.queryByText('Milk')).toBeNull();
  expect(copyKeys()).toEqual([]);
  expect(localStorage.getItem('shop:theme')).toBe('dark');

  await answer('/api/shelf', { items: ['Bread'] });
  await screen.findByText('Bread');
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-new:anyone:/api/shelf']));
});

test('on the dev server, which has no build to tell code apart, nothing is kept and earlier copies are deleted', async () => {
  localStorage.setItem('shop:copy:dev:anyone:/api/shelf', JSON.stringify({ data: { items: ['Old'] }, fetchedAt: 1 }));
  answers['/api/shelf'] = { items: ['Milk'] };
  load(null);
  expect(screen.getByText('Loading')).toBeTruthy();
  await screen.findByText('Milk');
  await act(async () => {});
  expect(copyKeys()).toEqual([]);
});

test('the build is the built entry this page runs, and none on the dev server', () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-Ab12.js"></script>';
  expect(thisBuild()).toBe('index-Ab12');
  document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
  expect(thisBuild()).toBeNull();
});

/** The screen behind the sign-in gate, signed in as `email`. */
function signedIn(copies: SavedCopies, email: string) {
  const provider = standInSignIn({ person: { id: `person-${email}`, email } });
  render(
    <SignInGate provider={provider} placeholder={<p>Placeholder</p>} signedOut={<p>Signed out</p>}>
      <ShelfScreen copies={copies} />
    </SignInGate>,
  );
  return provider;
}

test('copies are kept per person: another person never sees one, and signing out deletes them all', async () => {
  answers['/api/shelf'] = { items: ["Ana's milk"] };
  signedIn(savedCopies('shop', { build: 'index-a' }), 'ana@example.com');
  await screen.findByText("Ana's milk");
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:person-ana%40example.com:/api/shelf']));

  // Someone else on the same browser, as after the provider's session changed with no sign-out on this page.
  cleanup();
  delete answers['/api/shelf'];
  const bea = signedIn(savedCopies('shop', { build: 'index-a' }), 'bea@example.com');
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.queryByText("Ana's milk")).toBeNull();
  expect(copyKeys()).toEqual([]);
  await answer('/api/shelf', { items: ["Bea's bread"] });
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:person-bea%40example.com:/api/shelf']));

  act(() => bea.endSession());
  await screen.findByText('Signed out');
  expect(copyKeys()).toEqual([]);
});

test("when someone else signs in while the screen is up, the last person's data is neither shown nor saved for them", async () => {
  answers['/api/shelf'] = { items: ["Ana's milk"] };
  const ana = signedIn(savedCopies('shop', { build: 'index-a' }), 'ana@example.com');
  await screen.findByText("Ana's milk");
  await waitFor(() => expect(copyKeys()).toHaveLength(1));

  // The provider's session changes straight to another person, with no sign-out between.
  delete answers['/api/shelf'];
  act(() => ana.signInAs({ id: 'person-bea@example.com', email: 'bea@example.com' }));
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.queryByText("Ana's milk")).toBeNull();
  // Bea's own load is out, so every effect of the switch has run.
  await waitFor(() => expect(held['/api/shelf']).toHaveLength(1));
  expect(copyKeys()).toEqual([]);

  await answer('/api/shelf', { items: ["Bea's bread"] });
  await screen.findByText("Bea's bread");
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:person-bea%40example.com:/api/shelf']));
});

test("useSaveAfterDraw never saves one person's data for the next who signs in", async () => {
  const copies = savedCopies('shop', { build: 'index-a' });
  const provider = standInSignIn({ person: { id: 'person-ana@example.com', email: 'ana@example.com' } });
  const fresh = { data: { items: ["Ana's milk"] }, fetchedAt: 1 };
  function List() {
    useSaveAfterDraw(copies, 'list', fresh);
    return <p>List</p>;
  }
  render(
    <SignInGate provider={provider} placeholder={<p>Placeholder</p>} signedOut={<p>Signed out</p>}>
      <List />
    </SignInGate>,
  );
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:person-ana%40example.com:list']));
  act(() => provider.signInAs({ id: 'person-bea@example.com', email: 'bea@example.com' }));
  await act(async () => {});
  expect(copyKeys()).toEqual(['shop:copy:index-a:person-ana%40example.com:list']);
});

test("useSaveAfterDraw never saves one screen's data under the next screen's key", async () => {
  const copies = savedCopies('shop', { build: 'index-a' });
  const fresh = { data: { items: ['Milk'] }, fetchedAt: 1 };
  // An app that keeps the last screen's data up while the next one loads.
  function List({ which }: { which: string }) {
    useSaveAfterDraw(copies, which, fresh);
    return <p>{which}</p>;
  }
  const { rerender } = render(<List which="dairy" />);
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:anyone:dairy']));
  rerender(<List which="bakery" />);
  await screen.findByText('bakery');
  await act(async () => {});
  expect(copyKeys()).toEqual(['shop:copy:index-a:anyone:dairy']);
});

test('an answer for an address no longer shown is dropped, and the last address stays as previous while the new one loads', async () => {
  const copies = savedCopies('shop', { build: 'index-a' });
  answers['/api/shelf/a'] = { items: ['Milk'] };
  function Choice() {
    const [path, setPath] = useState('/api/shelf/a');
    return (
      <>
        <button onClick={() => setPath('/api/shelf/b')}>B</button>
        <button onClick={() => setPath('/api/shelf/c')}>C</button>
        <ShelfScreen copies={copies} path={path} />
      </>
    );
  }
  render(<Choice />);
  await screen.findByText('Milk');

  act(() => screen.getByText('B').click());
  expect(screen.getByText('Still showing Milk')).toBeTruthy();
  await waitFor(() => expect(held['/api/shelf/b']).toHaveLength(1));
  answers['/api/shelf/c'] = { items: ['Eggs'] };
  act(() => screen.getByText('C').click());
  await screen.findByText('Eggs');

  // B's answer comes after C is shown: dropped, neither drawn nor saved.
  await answer('/api/shelf/b', { items: ['Bread'] });
  expect(screen.getByText('Eggs')).toBeTruthy();
  expect(screen.queryByText('Bread')).toBeNull();
  expect(localStorage.getItem('shop:copy:index-a:anyone:/api/shelf/b')).toBeNull();
});

test('only the latest load counts: an earlier answer that comes last is dropped', async () => {
  load('index-a');
  await waitFor(() => expect(held['/api/shelf']).toHaveLength(1));
  // The page comes back in front while the first load is still out.
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(held['/api/shelf']).toHaveLength(2));

  await act(async () => held['/api/shelf']![1]!({ items: ['Bread'] }));
  await screen.findByText('Bread');
  await act(async () => held['/api/shelf']![0]!({ items: ['Milk'] }));
  expect(screen.getByText('Bread')).toBeTruthy();
  expect(screen.queryByText('Milk')).toBeNull();
  expect(saved('shop:copy:index-a:anyone:/api/shelf')?.data).toEqual({ items: ['Bread'] });
});

test("a 404 is missing and deletes the address's copy, and a failure keeps the data shown", async () => {
  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  await waitFor(() => expect(copyKeys()).toHaveLength(1));

  answers['/api/shelf'] = 404;
  load('index-a');
  await screen.findByText('Not found');
  expect(copyKeys()).toEqual([]);

  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  answers['/api/shelf'] = 500;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await screen.findByText('HTTP 500');
  expect(screen.getByText('Milk')).toBeTruthy();
});

test('the screen loads again when the page comes back in front', async () => {
  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  answers['/api/shelf'] = { items: ['Milk', 'Bread'] };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await screen.findByText('Bread');
});

test('with storage blocked the screen draws from the server', async () => {
  const blocked = (): CopyStore => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  const copies = savedCopies('shop', { build: 'index-a', store: blocked });
  answers['/api/shelf'] = { items: ['Milk'] };
  render(<ShelfScreen copies={copies} />);
  await screen.findByText('Milk');
});

test('useSavedCopy and useSaveAfterDraw alone keep what an app holds, saving it once drawn and only when passed as new', async () => {
  const writes: string[] = [];
  const recording: CopyStore = {
    get length() {
      return localStorage.length;
    },
    key: (index) => localStorage.key(index),
    getItem: (key) => localStorage.getItem(key),
    removeItem: (key) => localStorage.removeItem(key),
    setItem: (key, value) => {
      writes.push(key);
      localStorage.setItem(key, value);
    },
  };
  const copies = savedCopies('shop', { build: 'index-a', store: () => recording });
  // An app with edits of its own, which saves only the lists the server sends.
  function List({ fresh }: { fresh: SavedCopy<Shelf> | null }) {
    const last = useSavedCopy<Shelf>(copies, 'list');
    const [ticks, setTicks] = useState(0);
    useSaveAfterDraw(copies, 'list', fresh);
    return (
      <button onClick={() => setTicks(ticks + 1)}>
        Tick {ticks}, {last ? last.data.items.join(', ') : 'nothing saved'}
      </button>
    );
  }
  const fresh = { data: { items: ['Milk'] }, fetchedAt: 1 };
  render(<List fresh={fresh} />);
  expect(screen.getByRole('button').textContent).toBe('Tick 0, nothing saved');
  await waitFor(() => expect(saved('shop:copy:index-a:anyone:list')).toEqual(fresh));
  act(() => screen.getByRole('button').click());
  act(() => screen.getByRole('button').click());
  expect(screen.getByRole('button').textContent).toBe('Tick 2, nothing saved');
  expect(writes).toEqual(['shop:copy:index-a:anyone:list']);

  // The next load reads what was saved.
  cleanup();
  render(<List fresh={null} />);
  expect(screen.getByRole('button').textContent).toBe('Tick 0, Milk');
});
