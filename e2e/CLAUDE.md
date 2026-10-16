# E2E notes

- Tests run against the production build (`vite preview`), so the service worker is live. It serves Wikimedia images and historical-basemaps files CacheFirst, which hides those requests from `page.route`. Tests that mock them use `test.use({ serviceWorkers: 'block' })`.
- Every mocked response needs `headers: { 'Access-Control-Allow-Origin': '*' }`.
- Chromium launches with SwiftShader (`playwright.config.ts`) so the map has WebGL. Wait for `[data-testid=map][data-ready]` before asserting on the map; map labels are HTML (`.map-label.territory`, `.map-label.pin`).
- Tag a test `@phone` to also run it at Pixel 7 size.
- In the Claude cloud sandbox use the preinstalled browser: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Run one test while iterating: `npx playwright test -g "name" --reporter=line`.
- `visual.spec.ts` compares the timeline, map, dark split and phone views against baselines in `visual.spec.ts-snapshots/`. They run on macOS only (Linux fonts differ), so CI skips them. After an intended visual change: `npx playwright test e2e/visual.spec.ts --update-snapshots`, look at the new images, commit them.
- Map-heavy tests that load the map more than once need `test.slow()`: SwiftShader with parallel workers can pass the default 30s.
