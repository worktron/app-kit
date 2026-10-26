import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'path';

// A small app built on the kit with the stand-in sign-in, which the browser test runs built, as a deploy serves it; the
// same app as a later deploy builds it (newer.html), with its own built entry; and a page whose text follows the
// phone's Text Size (text-size.html).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: ['index.html', 'newer.html', 'text-size.html'].map((page) => join(import.meta.dirname, page)) },
  },
  // Any address is the app, as the app's own server answers them.
  appType: 'spa',
});
