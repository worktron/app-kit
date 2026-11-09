// The notification worker and the Vite plugin are plain JavaScript that cannot import web/push/names.ts, so this reads
// them and holds their copies of its names, and loads the plugin by its import name under Node, as an app's
// vite.config does, from inside node_modules.
import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECLARATIVE_PUSH, LOG_PREFIX, WORKER_ADDRESS } from '../web/push/names';
import { pushWorker } from '../web/push/vite';

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test("the worker's and the plugin's copies of the names are the names", () => {
  const worker = read('web/push/worker.js');
  expect(worker).toContain(`const DECLARATIVE_PUSH = ${DECLARATIVE_PUSH};`);
  expect(worker).toContain(`const LOG_PREFIX = '${LOG_PREFIX}';`);
  expect(read('web/push/vite.js')).toContain(`const WORKER_ADDRESS = '${WORKER_ADDRESS}';`);
});

test('the dev server answers the worker at its address, asked for again each time, and passes everything else on', () => {
  let handler: Parameters<ReturnType<typeof pushWorker>['configureServer']>[0]['middlewares']['use'] extends (h: infer H) => void ? H : never;
  pushWorker().configureServer({ middlewares: { use: (h) => (handler = h) } });
  const headers: Record<string, string> = {};
  let body = '';
  let passed = 0;
  const response = { setHeader: (name: string, value: string) => void (headers[name] = value), end: (text: string) => void (body = text) };
  handler!({ url: `${WORKER_ADDRESS}?v=1` }, response, () => passed++);
  expect(body).toBe(read('web/push/worker.js'));
  expect(headers).toEqual({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  handler!({ url: '/app.js' }, response, () => passed++);
  expect(passed).toBe(1);
});

test("the build writes the worker at its address under a file name, which keeps it out of Vite's manifest", () => {
  const emitted: unknown[] = [];
  pushWorker().generateBundle.call({ emitFile: (file) => (emitted.push(file), 'id') });
  expect(emitted).toEqual([{ type: 'asset', fileName: WORKER_ADDRESS.slice(1), source: read('web/push/worker.js') }]);
});

const app = mkdtempSync(join(tmpdir(), 'app-kit-push-plugin-'));
afterAll(() => rmSync(app, { recursive: true, force: true }));

test('an app loads the plugin by its import name with Node, from inside node_modules, and it reads the worker beside it', () => {
  const kit = join(app, 'node_modules', 'app-kit');
  mkdirSync(join(kit, 'web/push'), { recursive: true });
  cpSync(join(root, 'package.json'), join(kit, 'package.json'));
  for (const file of ['web/push/vite.js', 'web/push/worker.js']) cpSync(join(root, file), join(kit, file));
  const load = "const { pushWorker } = await import('app-kit/web/push/vite'); const files = []; pushWorker().generateBundle.call({ emitFile: (f) => files.push(f.fileName + ' ' + f.source.length) }); console.log(files.join());";
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(done.stdout.toString().trim()).toBe(`push-worker.js ${read('web/push/worker.js').length}`);
});
