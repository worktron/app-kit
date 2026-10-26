// The fixture's server: its built page, sent by the kit's own server half as an app's server sends it.
import { join } from 'path';
import { serveBuiltPage } from '../server';

const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the browser tests through scripts/e2e.sh, which gives them their own port.');

const server = Bun.serve({ port, hostname: 'localhost', fetch: serveBuiltPage(join(import.meta.dir, 'fixture', 'dist')) });
console.log(`[fixture] serving on ${server.url}`);
