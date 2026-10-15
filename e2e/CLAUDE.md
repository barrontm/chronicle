# E2E notes

- Tests run against the production build (`vite preview`), so the service worker is live. It serves Wikimedia images and historical-basemaps files CacheFirst, which hides those requests from `page.route`. Tests that mock them use `test.use({ serviceWorkers: 'block' })`.
- Every mocked response needs `headers: { 'Access-Control-Allow-Origin': '*' }`.
- Chromium launches with SwiftShader (`playwright.config.ts`) so the map has WebGL. Wait for `[data-testid=map][data-ready]` before asserting on the map; map labels are HTML (`.map-label.territory`, `.map-label.pin`).
- Tag a test `@phone` to also run it at Pixel 7 size.
- In the Claude cloud sandbox use the preinstalled browser: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Run one test while iterating: `npx playwright test -g "name" --reporter=line`.
