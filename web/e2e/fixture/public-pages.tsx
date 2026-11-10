// The fixture's public pages, written after its vite build by scripts/e2e.sh, as an app's build script writes its own.
import { join } from 'path';
import { writePublicPages } from '../../public-pages';
import { Privacy, wrap } from './Privacy';

await writePublicPages({
  folder: join(import.meta.dirname, 'dist'),
  appName: 'Kit fixture',
  pages: [{ address: '/privacy', title: 'Privacy policy', page: <Privacy /> }],
  wrap,
  // Built because wordmark.html's stylesheet uses it.
  fonts: ['figtree-latin-wght-normal.woff2'],
});
