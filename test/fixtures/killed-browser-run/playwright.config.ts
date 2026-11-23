// The kit's browser test configuration, run on hang.e2e.ts in this folder instead of the kit's browser tests, by
// test/browser-test-killed.test.ts. Importing it takes the run's temporary folder as the real one does; testDir '.'
// is this folder, since Playwright reads it against the configuration file it was given, and the run's results go in
// the run's temporary folder, not beside this file.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../../../web/e2e/playwright.config.ts';

export default { ...config, testIgnore: undefined, webServer: undefined, outputDir: join(tmpdir(), 'test-results') };
