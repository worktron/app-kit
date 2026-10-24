import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { builtEntry, isNewBuild, lookForNewBuild, runningEntry, unsavedInput, useNewBuild, watchChoices } from '../src/new-build';

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

test('the built entry is the module script under /assets an index page names', () => {
  const html = '<head><script type="module" crossorigin src="/assets/index-Ab12.js"></script></head>';
  expect(builtEntry(html)).toBe('/assets/index-Ab12.js');
  expect(builtEntry('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
});

test('the running entry is read from the page itself', () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-Ab12.js"></script>';
  expect(runningEntry()).toBe('/assets/index-Ab12.js');
  document.head.innerHTML = '<script type="module" src="/src/main.tsx"></script>';
  expect(runningEntry()).toBeNull();
});

test('a new build is a different built entry, never a page from the dev server', () => {
  expect(isNewBuild('/assets/a.js', '/assets/b.js')).toBe(true);
  expect(isNewBuild('/assets/a.js', '/assets/a.js')).toBe(false);
  expect(isNewBuild(null, '/assets/b.js')).toBe(false);
  expect(isNewBuild('/assets/a.js', null)).toBe(false);
});

test('a field with text in it holds back the reload that loses it', () => {
  document.body.innerHTML = '<input type="text" id="title"><textarea></textarea><input type="checkbox">';
  expect(unsavedInput()).toBe(false);
  (document.getElementById('title') as HTMLInputElement).value = 'Call the dentist';
  expect(unsavedInput()).toBe(true);
  // A number, a date or a phone number is as much typed as text.
  document.body.innerHTML = '<input type="number" value="42"><input type="checkbox" value="on">';
  expect(unsavedInput()).toBe(true);
});

test('a choice the person changed holds back the reload, and one only shown does not', () => {
  const stop = watchChoices();
  try {
    document.body.innerHTML = '<input type="checkbox" id="done"><select id="list"><option>Home</option><option>Work</option></select>';
    expect(unsavedInput()).toBe(false);
    const list = document.getElementById('list') as HTMLSelectElement;
    list.value = 'Work';
    list.dispatchEvent(new Event('change', { bubbles: true }));
    expect(unsavedInput()).toBe(true);
    // Gone from the page with its screen, the choice holds nothing back.
    list.remove();
    expect(unsavedInput()).toBe(false);
    (document.getElementById('done') as HTMLInputElement).click();
    expect(unsavedInput()).toBe(true);
  } finally {
    stop();
  }
});

test('a pull to refresh looks for a newer build at once, without the minute between looks', async () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-a.js"></script>';
  const looked = mock(async () => new Response('<script type="module" src="/assets/index-b.js"></script>'));
  globalThis.fetch = looked as unknown as typeof fetch;
  const { result } = renderHook(() => useNewBuild());
  // Back in front within the minute since the page loaded: no look.
  window.dispatchEvent(new Event('focus'));
  expect(looked).not.toHaveBeenCalled();
  lookForNewBuild();
  await waitFor(() => expect(result.current).toBe(true));
  expect(looked).toHaveBeenCalledTimes(1);
});

test('a hidden page with a newer build reloads by itself, but never over typed text', async () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-a.js"></script>';
  globalThis.fetch = mock(async () => new Response('<script type="module" src="/assets/index-b.js"></script>')) as unknown as typeof fetch;
  const reload = mock(() => {});
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  try {
    const { result } = renderHook(() => useNewBuild());
    lookForNewBuild();
    await waitFor(() => expect(result.current).toBe(true));
    document.body.innerHTML = '<textarea>half a note</textarea>';
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).not.toHaveBeenCalled();
    // Nothing typed any more: hidden again, it loads the newer build.
    document.body.innerHTML = '<textarea></textarea>';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    delete (window.location as { reload?: unknown }).reload;
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});

test('an app whose view a reload would lose turns the reload by itself off, and keeps the line', async () => {
  document.head.innerHTML = '<script type="module" src="/assets/index-a.js"></script>';
  globalThis.fetch = mock(async () => new Response('<script type="module" src="/assets/index-b.js"></script>')) as unknown as typeof fetch;
  const reload = mock(() => {});
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  try {
    const { result } = renderHook(() => useNewBuild({ reloadsItself: false }));
    lookForNewBuild();
    await waitFor(() => expect(result.current).toBe(true));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).not.toHaveBeenCalled();
  } finally {
    delete (window.location as { reload?: unknown }).reload;
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});
