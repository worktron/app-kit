import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'path';
// By the import name, as an app's config takes it, so the build loads it from Node as an app's does.
import { firstPaint } from 'app-kit/web/first-paint';

// A small app built on the kit with the stand-in sign-in, which the browser test runs built, as a deploy serves it; the
// same app as a later deploy builds it (newer.html), with its own built entry; and a page whose text follows the
// phone's Text Size (text-size.html); the pieces an installed app adds (pieces.html); a page drawn after its fonts
// (fonts.html). Every page's first frame follows the system's light or dark setting.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    react(),
    firstPaint({
      schemes: { light: { background: '#f4efe6', color: '#2c2420' }, dark: { background: '#14110f', color: '#efe6dc', dark: true } },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: ['index.html', 'newer.html', 'text-size.html', 'pieces.html', 'fonts.html'].map((page) => join(import.meta.dirname, page)) },
  },
  // Any address is the app, as the app's own server answers them.
  appType: 'spa',
});
