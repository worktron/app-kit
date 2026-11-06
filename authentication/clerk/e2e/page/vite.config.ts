import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A page of an app on the kit's Clerk adapter, built with the App Kit development instance's publishable key, which
// scripts/e2e-clerk.sh reads from 1Password and hands to the build.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, manifest: true },
  appType: 'spa',
});
