import { afterEach, expect, test } from 'bun:test';
import { builtEntry, isNewBuild, runningEntry, somethingTyped } from '../src/new-build';

afterEach(() => {
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
  expect(somethingTyped()).toBe(false);
  (document.getElementById('title') as HTMLInputElement).value = 'Call the dentist';
  expect(somethingTyped()).toBe(true);
});
