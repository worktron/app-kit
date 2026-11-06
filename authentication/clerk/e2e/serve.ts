// The Clerk test page's server: its built page, sent by the kit's own server half on the kit's server start.
import { join } from 'path';
import { appServer, listen } from '../../../server/start';
import { serveBuiltPage } from '../../../web/server';

const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the Clerk browser test through scripts/e2e-clerk.sh, which gives it its own port.');

const page = serveBuiltPage(join(import.meta.dir, 'page', 'dist'));
const app = appServer({ service: 'clerk-page', print: (line) => console.log(`[clerk-page] ${line}`) });
app.get('*', (c) => page(c.req.raw));
listen(app, { port, hostname: 'localhost', print: (line) => console.log(`[clerk-page] ${line}`) });
