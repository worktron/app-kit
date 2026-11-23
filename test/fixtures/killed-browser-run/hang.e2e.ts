// A browser test as the Dock and offline audio tests are, killed partway by test/browser-test-killed.test.ts: it makes
// its scratch folder in the temporary folder with an app in it, says where on a line of its own, and waits.
import { test } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('makes a scratch folder with an app in it, says where, and waits to be killed', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'killed-run-'));
  mkdirSync(join(scratch, 'Stand-in.app'));
  console.log(`scratch folder: ${scratch}`);
  // Killed long before; Playwright's time limit ends a run whose test was stopped before it could kill this one.
  await new Promise((resolve) => setTimeout(resolve, 60_000));
});
