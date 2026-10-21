/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow to "/<repo-name>/". Locally it's "/".
const base = process.env.BASE_PATH ?? '/';

// Which build this is, shown in Help so Bob can tell the stable app from the one in progress.
function appVersion(): string {
  let commit = 'dev';
  try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  return `${commit}, built ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Chronicle',
        short_name: 'Chronicle',
        description: 'A history timeline you build as you learn.',
        theme_color: '#1d2b3a',
        background_color: '#eef0ec',
        display: 'standalone',
        start_url: base,
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // geo/*.json is the bundled basemap, so the map works offline; data/*.json is the
        // trend catalogue, so "Find a trend" searches offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2}', 'geo/*.json', 'data/*.json'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Pictures from Wikimedia stay viewable offline once seen.
        runtimeCaching: [
          {
            // Image bytes only. API calls (Commons search, file info) must stay fresh, so they're not matched here.
            urlPattern: ({ url }) => url.hostname === 'upload.wikimedia.org'
              || (url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/Special:FilePath')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wikimedia-images',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Historical borders: fetched for the reference backdrop or a territory import, kept for offline use.
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/aourednik/historical-basemaps/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'historical-basemaps',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Seshat's borders (public/data/borders/, not precached: tens of MB in all). The last copy
            // answers at once and offline; a rebuild reaches Bob on the next fetch.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/data/borders/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'seshat-borders',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // A trend's numbers: fresh when online, the last copy when offline.
            urlPattern: ({ url }) => (url.hostname === 'ourworldindata.org' && url.pathname.startsWith('/grapher/') && url.pathname.endsWith('.csv'))
              || (url.hostname === 'api.worldbank.org' && url.pathname.startsWith('/v2/country/')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'trend-data',
              networkTimeoutSeconds: 15,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
