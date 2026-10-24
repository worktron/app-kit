import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'path';

// A small app built on the kit with the stand-in sign-in, which the browser test runs built, as a deploy serves it, and
// a page whose text follows the phone's Text Size (text-size.html).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: [join(import.meta.dirname, 'index.html'), join(import.meta.dirname, 'text-size.html')] },
  },
  // Any address is the app, as the app's own server answers them.
  appType: 'spa',
});
