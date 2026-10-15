/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow to "/<repo-name>/". Locally it's "/".
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        // geo/*.json is the bundled basemap, so the map works offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2}', 'geo/*.json'],
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
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
