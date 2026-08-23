import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests only, in a plain node environment.
 *
 * Nothing here loads jsdom: the tested surface is the renderer-free, network-free
 * half of lib/ — the geometry, the parsers, the validators — and giving it a fake
 * DOM would only hide an accidental `document` reference in a module that is not
 * allowed one. A module that needs a browser is tested by using the app.
 */
export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./*" alias in tsconfig.json. Written out by hand
    // rather than read through vite-tsconfig-paths: one line, one fewer
    // dependency for a contributor to install.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
