import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { resetConnection } from '../web/connection';
import { ErrorBoundary } from '../web/ErrorBoundary';
import { savedCopies, thisBuild, useSaveAfterDraw, useScreenData, type CopyStore, type SavedCopies, type SavedCopy } from '../web/saved-copies';

const realFetch = globalThis.fetch;
const quiet = console.error;

/** The server, played here: each path's answer, a status with no body, or an answer that never comes. */
let answers: Record<string, unknown> = {};
let asked: string[] = [];
let held: Record<string, (body: unknown) => void> = {};

beforeEach(() => {
  localStorage.clear();
  answers = {};
  asked = [];
  held = {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    asked.push(path);
    const answer = path in answers ? answers[path] : 'hold';
    if (answer === 'hold') return new Promise<Response>((resolve) => (held[path] = (body) => resolve(Response.json(body))));
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
function load(build: string, path?: string) {
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

test('an answer this build cannot draw is never saved, so the next load draws from the network', async () => {
  answers['/api/shelf'] = { items: ['Milk'] };
  load('index-a');
  await screen.findByText('Milk');
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-a:/api/shelf']));

  // A newer server's answer, as an open page gets while a deploy goes out or is rolled back.
  answers['/api/shelf'] = { at: '2026-10-25T20:00:00Z' };
  load('index-a');
  expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
  expect(JSON.parse(localStorage.getItem('shop:copy:index-a:/api/shelf')!).data).toEqual({ items: ['Milk'] });

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
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-old:/api/shelf']));
  // The app's other storage under its name, which is not a copy.
  localStorage.setItem('shop:theme', 'dark');

  delete answers['/api/shelf'];
  load('index-new');
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.queryByText('Milk')).toBeNull();
  expect(copyKeys()).toEqual([]);
  expect(localStorage.getItem('shop:theme')).toBe('dark');

  await waitFor(() => expect(held['/api/shelf']).toBeDefined());
  held['/api/shelf']!({ items: ['Bread'] });
  await screen.findByText('Bread');
  await waitFor(() => expect(copyKeys()).toEqual(['shop:copy:index-new:/api/shelf']));
});

test('the build is the built entry this page runs, and dev on the dev server', () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-Ab12.js"></script>';
  expect(thisBuild()).toBe('index-Ab12');
  document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
  expect(thisBuild()).toBe('dev');
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
  answers['/api/shelf/c'] = { items: ['Eggs'] };
  act(() => screen.getByText('C').click());
  await screen.findByText('Eggs');

  // B's answer comes after C is shown: dropped, neither drawn nor saved.
  await act(async () => held['/api/shelf/b']!({ items: ['Bread'] }));
  expect(screen.getByText('Eggs')).toBeTruthy();
  expect(screen.queryByText('Bread')).toBeNull();
  expect(copies.read('/api/shelf/b')).toBeNull();
});

test('a 404 is missing, and a failure keeps the data shown', async () => {
  answers['/api/shelf'] = 404;
  load('index-a');
  await screen.findByText('Not found');

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
  expect(copies.read('/api/shelf')).toBeNull();
});

test('useSaveAfterDraw alone saves what an app holds once it has drawn, and only data passed as new', async () => {
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
    const [ticks, setTicks] = useState(0);
    useSaveAfterDraw(copies, 'list', fresh);
    return <button onClick={() => setTicks(ticks + 1)}>Tick {ticks}</button>;
  }
  const fresh = { data: { items: ['Milk'] }, fetchedAt: 1 };
  render(<List fresh={fresh} />);
  await waitFor(() => expect(copies.read('list')).toEqual(fresh));
  act(() => screen.getByRole('button').click());
  act(() => screen.getByRole('button').click());
  expect(screen.getByText('Tick 2')).toBeTruthy();
  expect(writes).toEqual(['shop:copy:index-a:list']);
});
