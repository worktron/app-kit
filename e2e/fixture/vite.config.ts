import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A small app built on the kit with the stand-in sign-in, which the browser test runs built, as a deploy serves it.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // Any address is the app, as the app's own server answers them.
  appType: 'spa',
});
