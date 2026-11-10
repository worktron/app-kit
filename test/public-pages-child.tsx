// A small app's public pages build, run by public-pages.test.ts in a process of its own, with no simulated page, as an
// app's bun script after vite build runs. Its arguments: the built folder, and which build to run.
// Loaded only here, never in the unit tests' shared process, where React's server renderer upsets later files' drawing.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { lookTheme } from '../web/theme';

const [folder, which = 'pages'] = process.argv.slice(2);
if (!folder) throw new Error('Give the built folder.');
// As under bun test with the simulated page preloaded.
if (which === 'in-page') GlobalRegistrator.register({ url: 'http://localhost/' });
const { writePublicPages } = await import('../web/public-pages');
const theme = lookTheme();

const Privacy = () => (
  <main>
    <Typography variant="h1">Privacy policy</Typography>
    <Typography color="text.secondary">The shop reads only the orders you open, and keeps none of them.</Typography>
  </main>
);

try {
  const written = await writePublicPages({
    folder,
    appName: 'shop',
    pages:
      which === 'empty'
        ? [{ address: '/privacy', title: 'Privacy policy', page: <main /> }]
        : which === 'nested'
          ? [{ address: '/legal/privacy', title: 'Privacy policy', page: <Privacy /> }]
          : [
            { address: '/privacy', title: 'Privacy policy', page: <Privacy /> },
            { address: '/terms', title: 'Terms', page: <Typography>Use the shop & be kind.</Typography> },
          ],
    wrap: (page) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {page}
      </ThemeProvider>
    ),
    fonts: [which === 'missing-font' ? 'nowhere-latin.woff2' : 'figtree-latin-wght-normal.woff2'],
    style: ':root { --shop-line: #ddd; }',
  });
  console.log(JSON.stringify(written));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
