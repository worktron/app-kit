// The Vite plugin that serves the kit's notification worker (worker.js) at /push-worker.js: from the dev server as it
// runs, and written into the build at that address. A worker's address is its identity, so it never changes from build
// to build, and it is emitted with a file name and no name, which keeps it out of Vite's manifest: serveBuiltPage then
// sends it with no-cache, as a file the browser must ask for again, rather than as a built file kept for a year.
// Plain JavaScript, typed by vite.d.ts, since an app's vite.config loads it in Node, which refuses TypeScript from
// inside node_modules, where an app has the kit.
import { readFileSync } from 'node:fs';

const WORKER_ADDRESS = '/push-worker.js';
const worker = () => readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

/** @type {typeof import('./vite').pushWorker} */
export function pushWorker() {
  return {
    name: 'app-kit-push-worker',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== WORKER_ADDRESS) return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(worker());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKER_ADDRESS.slice(1), source: worker() });
    },
  };
}
