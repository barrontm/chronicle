// Visual check: imports the test fixture and captures the main views.
// Usage: npm run build && npm run preview &   then   npm run shots [-- --only map,phone] [--sheet]
//   --only  comma-separated name fragments; only matching shots are taken (and only their flows run)
//   --sheet also tiles the shots into screenshots/sheet.png at half size: one image to review
// Output: screenshots/*.png (git-ignored). Set PW_CHROMIUM_PATH in sandboxes without Playwright browsers.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SHOTS_URL ?? 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const only = onlyArg.split(',').map((x) => x.trim()).filter(Boolean);
const wanted = (name) => !only.length || only.some((o) => name.includes(o));
const taken = [];

/** Take a screenshot only if it was asked for. */
async function shot(p, name, opts = {}) {
  if (!wanted(name)) return;
  await p.screenshot({ path: `${OUT}${name}.png`, ...opts });
  taken.push(name);
}

// SwiftShader gives the map WebGL without a GPU.
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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

async function showMap(p, view, year) {
  await p.getByRole('button', { name: view, exact: true }).click();
  await p.locator('[data-testid=map][data-ready]').waitFor({ timeout: 20000 });
  const input = p.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.click();
  await input.fill(year);
  await input.press('Enter');
  await p.waitForTimeout(600);
}

const desktop = { viewport: { width: 1440, height: 900 } };

const any = (...names) => names.some(wanted);
let p;

if (any('desktop-empty')) {
p = await page('empty', desktop);
await shot(p, 'desktop-empty');
}

if (any('desktop-timeline', 'desktop-entry', 'desktop-editor', 'desktop-map', 'desktop-split')) {

p = await page('desktop', desktop);
await withFixture(p);
await shot(p, 'desktop-timeline');
await p.locator('.vis-item', { hasText: 'Plato' }).click();
await shot(p, 'desktop-entry');
await p.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
await shot(p, 'desktop-editor', { fullPage: true });
await p.getByRole('button', { name: 'Close panel' }).click();
await showMap(p, 'Map', '300 BCE');
await shot(p, 'desktop-map');
await showMap(p, 'Both', '1215');
await shot(p, 'desktop-split');
}

if (any('desktop-dark', 'desktop-dark-split')) {

p = await page('dark', { ...desktop, colorScheme: 'dark' });
await withFixture(p);
await shot(p, 'desktop-dark');
await showMap(p, 'Both', '200 BCE');
await shot(p, 'desktop-dark-split');
}

if (any('phone-timeline', 'phone-map')) {

p = await page('phone', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
await withFixture(p);
await shot(p, 'phone-timeline');
await showMap(p, 'Map', '300 BCE');
await shot(p, 'phone-map');
}

// Drawing a border: zoom toward Greece, outline a shape, then the form after Done.
async function drawBorder(p, prefix) {
  await showMap(p, prefix === 'phone' ? 'Map' : 'Both', '450 BCE');
  for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Zoom in' }).click();
  await p.getByRole('button', { name: 'Add a territory' }).click();
  await p.getByTestId('own-borders').getByRole('button', { name: 'Draw on the map' }).click();
  const box = await p.getByTestId('map').boundingBox();
  const canvas = p.locator('[data-testid=map] canvas');
  for (const [dx, dy] of [[-60, -10], [40, -40], [70, 30], [0, 70]]) await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-draw`);
  await p.getByTestId('draw-toolbar').getByRole('button', { name: 'Done' }).click();
  await p.getByTestId('own-borders').getByLabel('Name').fill('Athens');
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-draw-form`);
}

if (any('desktop-draw')) await drawBorder(await page('desktop-draw', desktop), 'desktop');
if (any('dark-draw')) await drawBorder(await page('dark-draw', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-draw')) await drawBorder(await page('phone-draw', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// The manual.
async function help(p, prefix) {
  await p.getByRole('button', { name: 'Help' }).click();
  await p.getByTestId('help').waitFor();
  await shot(p, `${prefix}-help`);
}
if (any('desktop-help')) await help(await page('desktop-help', desktop), 'desktop');
if (any('dark-help')) await help(await page('dark-help', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-help')) await help(await page('phone-help', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

if (argv.includes('--sheet') && taken.length) {
  // Tile the shots at half size into one page and capture it: one image to review instead of many.
  const imgs = taken.map((n) => `<figure class="${n.startsWith('phone') ? 'phone' : ''}"><img src="data:image/png;base64,${readFileSync(`${OUT}${n}.png`).toString('base64')}"><figcaption>${n}</figcaption></figure>`).join('');
  const sheet = await (await browser.newContext({ viewport: { width: 1180, height: 100 } })).newPage();
  await sheet.setContent(`<style>body{margin:8px;font:14px system-ui;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}figure{margin:0}img{width:720px;display:block;border:1px solid #ccc}.phone img{width:206px}figcaption{padding:2px 0}</style>${imgs}`);
  await sheet.screenshot({ path: `${OUT}sheet.png`, fullPage: true });
  taken.push('sheet');
}

await browser.close();
console.log(taken.length ? `Saved ${taken.join(', ')} to ${OUT}` : `No shot matched --only ${onlyArg}`);
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
