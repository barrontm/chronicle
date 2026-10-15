// Visual check: imports the test fixture and captures the main views.
// Usage: npm run build && npm run preview &   then   npm run shots
// Output: screenshots/*.png (git-ignored). Set PW_CHROMIUM_PATH in sandboxes without Playwright browsers.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SHOTS_URL ?? 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const errors = [];

async function page(name, options) {
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(BASE);
  await p.getByTestId('save-state').waitFor({ state: 'attached' });
  return p;
}

async function withFixture(p) {
  await p.getByTestId('import-input').setInputFiles(FIXTURE);
  await p.locator('.vis-item', { hasText: 'Aristotle' }).waitFor();
  await p.getByRole('button', { name: 'More' }).click();
  await p.getByRole('menuitem', { name: 'Show everything' }).click();
  await p.waitForTimeout(300);
}

const desktop = { viewport: { width: 1440, height: 900 } };

let p = await page('empty', desktop);
await p.screenshot({ path: `${OUT}desktop-empty.png` });

p = await page('desktop', desktop);
await withFixture(p);
await p.screenshot({ path: `${OUT}desktop-timeline.png` });
await p.locator('.vis-item', { hasText: 'Plato' }).click();
await p.screenshot({ path: `${OUT}desktop-entry.png` });
await p.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
await p.screenshot({ path: `${OUT}desktop-editor.png`, fullPage: true });

p = await page('dark', { ...desktop, colorScheme: 'dark' });
await withFixture(p);
await p.screenshot({ path: `${OUT}desktop-dark.png` });

p = await page('phone', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
await withFixture(p);
await p.screenshot({ path: `${OUT}phone-timeline.png` });

await browser.close();
console.log(`Saved screenshots to ${OUT}`);
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
