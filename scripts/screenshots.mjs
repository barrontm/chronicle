// Visual check: imports the test fixture and captures the main views.
// Usage: npm run build && npm run preview &   then   npm run shots [-- --only map,phone] [--sheet]
//   --only  comma-separated name fragments; only matching shots are taken (and only their flows run)
//   --sheet also tiles the shots into screenshots/sheet.png at half size: one image to review
// Gallery shots (the app on the Classical Greece fixture; need the dev server, started for you unless SHOTS_URL is set):
//   --gallery [ids]       one shot per gallery preset (all, or comma-separated ids from src/ui/gallery/presets.ts)
//   --filmstrip <view>    map | split | timeline played from --from to --to (BCE years, default 480 to 400) in --frames steps (default 9),
//                         tiled into screenshots/filmstrip-<view>.png: one image to see motion
//   --video               the same run recorded as screenshots/video-<view>.webm (Play at 10 years a second)
// Output: screenshots/*.png (git-ignored). Set PW_CHROMIUM_PATH in sandboxes without Playwright browsers.
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let BASE = process.env.SHOTS_URL ?? 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const only = onlyArg.split(',').map((x) => x.trim()).filter(Boolean);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const galleryMode = ['--gallery', '--filmstrip', '--video'].some((f) => argv.includes(f));
if (galleryMode && !only.length) only.push('__gallery__'); // the regular shots stay off unless asked for with --only
const wanted = (name) => !only.length || only.some((o) => name.includes(o));
const taken = [];

/** Take a screenshot only if it was asked for. */
async function shot(p, name, opts = {}) {
  if (!wanted(name)) return;
  await p.screenshot({ path: `${OUT}${name}.png`, ...opts });
  taken.push(name);
}

// The gallery is dev-only, so its shots come from a Vite dev server.
let devServer = null;
if (galleryMode && !process.env.SHOTS_URL) {
  const { createServer } = await import('vite');
  devServer = await createServer({ logLevel: 'silent', server: { port: 5199 } });
  await devServer.listen();
  BASE = devServer.resolvedUrls.local[0].replace(/\/$/, '');
}

// SwiftShader gives the map WebGL without a GPU.
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function page(name, options, path = '') {
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(BASE + path);
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
const SIZE_OF = { desktop: { width: 1440, height: 900 }, phone: { width: 412, height: 860 } };

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
await p.waitForTimeout(600); // the timeline zooms to his time
await shot(p, 'desktop-entry');
await p.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
await shot(p, 'desktop-editor', { fullPage: true });
await p.getByRole('button', { name: 'Close panel' }).click();
await showMap(p, 'Map', '300 BCE');
await shot(p, 'desktop-map');
await showMap(p, 'Both', '1215');
await shot(p, 'desktop-split');
}

if (any('desktop-dark', 'desktop-dark-split', 'desktop-dark-influences')) {

p = await page('dark', { ...desktop, colorScheme: 'dark' });
await withFixture(p);
await shot(p, 'desktop-dark');
if (wanted('desktop-dark-influences')) {
  await p.locator('.vis-item', { hasText: 'Plato' }).click();
  await p.waitForTimeout(600); // the timeline zooms to his time
  await shot(p, 'desktop-dark-influences');
  await p.getByRole('button', { name: 'Close panel' }).click();
}
await showMap(p, 'Both', '200 BCE');
await shot(p, 'desktop-dark-split');
}

if (any('phone-timeline', 'phone-map', 'phone-influences')) {

p = await page('phone', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
await withFixture(p);
await shot(p, 'phone-timeline');
if (wanted('phone-influences')) {
  await p.locator('.vis-item', { hasText: 'Plato' }).click();
  await p.waitForTimeout(600); // the timeline zooms to his time
  await shot(p, 'phone-influences');
  await p.getByRole('button', { name: 'Close panel' }).click();
}
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

// Migration: the fixture's famine routes in 1850, then the editor.
async function migration(p, prefix) {
  await withFixture(p);
  await showMap(p, prefix === 'phone' ? 'Map' : 'Both', '1850');
  await p.getByRole('button', { name: 'Layers' }).click();
  await p.waitForTimeout(600);
  await shot(p, `${prefix}-migration`);
  await p.getByRole('button', { name: 'Layers' }).click();
  await p.getByRole('button', { name: 'Library' }).click();
  await p.getByRole('tab', { name: /Migration/ }).click();
  await p.getByRole('button', { name: /Famine emigration/ }).click();
  await p.getByTestId('flow-view').getByRole('button', { name: 'Edit' }).click();
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-migration-editor`);
}

if (any('desktop-migration')) await migration(await page('desktop-migration', desktop), 'desktop');
if (any('dark-migration')) await migration(await page('dark-migration', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-migration')) await migration(await page('phone-migration', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// Find a trend: search the bundled catalogue (no network needed).
async function trendSearch(p, prefix) {
  await p.getByRole('button', { name: 'Add a trend' }).click();
  await p.getByTestId('series-editor').getByLabel('Search trends').fill('population');
  await p.locator('.trend-results li').first().waitFor();
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-trends`);
}
if (any('desktop-trends')) await trendSearch(await page('desktop-trends', desktop), 'desktop');
if (any('dark-trends')) await trendSearch(await page('dark-trends', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-trends')) await trendSearch(await page('phone-trends', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// The place picker in the entry editor, with Wikipedia's answer mocked.
async function places(p, prefix) {
  await p.route('https://en.wikipedia.org/w/api.php**', (route) => route.fulfill({
    json: { query: { pages: [
      { title: 'Platonic Academy', index: 1, description: 'School founded by Plato in Athens', coordinates: [{ lat: 37.9925, lon: 23.7083 }] },
      { title: 'Academy of Athens (modern)', index: 2, description: 'National academy of Greece', coordinates: [{ lat: 37.9802, lon: 23.7327 }] },
    ] } },
    headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await withFixture(p);
  await p.locator('.vis-item', { hasText: 'Plato' }).click();
  await p.waitForTimeout(600); // the timeline zooms to his time
  await p.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
  await p.getByRole('button', { name: 'Add a place' }).click();
  await p.getByLabel('Place name').fill('Academy');
  await p.getByRole('button', { name: 'Look up' }).click();
  await p.getByTestId('place-results').waitFor();
  await p.getByLabel('Coordinates').fill('37°59′N 23°42′E');
  await p.getByTestId('place-form').scrollIntoViewIfNeeded();
  await shot(p, `${prefix}-places`);
}
if (any('desktop-places')) await places(await page('desktop-places', desktop), 'desktop');
if (any('dark-places')) await places(await page('dark-places', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-places')) await places(await page('phone-places', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// The manual.
async function help(p, prefix) {
  await p.getByRole('button', { name: 'Help' }).click();
  await p.getByTestId('help').waitFor();
  await shot(p, `${prefix}-help`);
}
if (any('desktop-help')) await help(await page('desktop-help', desktop), 'desktop');
if (any('dark-help')) await help(await page('dark-help', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-help')) await help(await page('phone-help', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// The new layout's reader on a saved article, with the sample timeline beside it.
async function reader(p, prefix) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await p.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (r) => r.fulfill({ headers: cors, json: { pages: [{ key: 'Peloponnesian_War', title: 'Peloponnesian War', description: 'War between Athens and Sparta (431–404 BC)', thumbnail: null }] } }));
  // A real article (CC BY-SA, saved by the reader spike) so the shot shows true Wikipedia content.
  const html = gunzipSync(readFileSync(fileURLToPath(new URL('../tests/fixtures/articles/Peloponnesian_War.html.gz', import.meta.url)))).toString('utf8');
  await p.route('https://en.wikipedia.org/w/rest.php/v1/page/*/html', (r) => r.fulfill({ headers: { ...cors, 'Content-Type': 'text/html' }, body: html }));
  // What the article is about, recorded from Wikidata (no class walk needed for a war).
  const subject = JSON.parse(readFileSync(fileURLToPath(new URL('../tests/fixtures/subjects/Peloponnesian_War.json', import.meta.url)), 'utf8'));
  await p.route('https://www.wikidata.org/w/api.php**', (r) => {
    const ids = new URL(r.request().url()).searchParams.get('ids');
    if (!ids) return r.fulfill({ headers: cors, json: subject.entity });
    return r.fulfill({ headers: cors, json: { entities: Object.fromEntries(ids.split('|').map((q) => [q, { id: q, labels: subject.labels[q] ? { en: { value: subject.labels[q] } } : {} }])) } });
  });
  await withFixture(p);
  await p.getByRole('button', { name: 'More' }).click();
  await p.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await p.getByTestId('article-search').getByLabel('Search Wikipedia').fill('peloponnesian');
  await p.getByTestId('article-search').getByRole('button', { name: 'Search' }).click();
  await p.getByTestId('article-results').getByRole('button').first().click();
  await p.getByTestId('article').locator('.reader-text').waitFor();
  await p.waitForTimeout(800);
  await shot(p, `${prefix}-reader`);
  if (any(`${prefix}-reader-highlight`)) await readerHighlight(p, prefix);
}

// Highlighting: one kept highlight, one just made, and (on the laptop) a selection with its button.
async function readerHighlight(p, prefix) {
  // Select (or find) from the start of `from` to the end of `to`, which may be in different text nodes.
  const where = (from, to = from, select = false) => p.evaluate(([a, b, sel]) => {
    const find = (t) => {
      const w = document.createTreeWalker(document.querySelector('.reader-text'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(t); if (i >= 0) return [n, i]; }
      throw new Error(`no "${t}"`);
    };
    const [sn, si] = find(a);
    const [en, ei] = find(b);
    const r = document.createRange();
    r.setStart(sn, si);
    r.setEnd(en, ei + b.length);
    if (!sel) sn.parentElement.scrollIntoView({ block: 'center' });
    if (sel) { getSelection().removeAllRanges(); getSelection().addRange(r); }
    const box = r.getClientRects()[0];
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, [from, to, select]);
  const highlight = async (from, to) => {
    // On the phone, a tap in the middle of `to` (away from links) highlights its sentence.
    if (prefix === 'phone') { const at = await where(to); await p.touchscreen.tap(at.x, at.y); return; }
    await where(from, to, true);
    await p.getByRole('button', { name: 'Highlight' }).waitFor();
    await p.keyboard.press('h');
  };
  await where('was fought in the');
  await highlight('was fought in the', 'from 431 to 404 BC');
  await p.keyboard.press('Escape');
  await highlight('Initially inconclusive', 'Initially inconclusive');
  if (prefix !== 'phone') await where('allowed the Spartan', 'allowed the Spartan', true);
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-reader-highlight`);
}
if (any('desktop-reader')) await reader(await page('desktop-reader', desktop), 'desktop');
if (any('dark-reader')) await reader(await page('dark-reader', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-reader')) await reader(await page('phone-reader', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// Draft with AI: a recorded run replayed (no network, no key needed), one entry accepted.
async function aiDraft(p, prefix) {
  const rec = JSON.parse(readFileSync(fileURLToPath(new URL('../tests/ai-evals/entries/recordings/handmade-persian-wars.json', import.meta.url)), 'utf8'));
  const used = new Set();
  const anthropic = (u) => u.startsWith('https://api.anthropic.com/');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  for (const pattern of ['https://api.anthropic.com/**', 'https://en.wikipedia.org/**', 'https://www.wikidata.org/**']) {
    await p.route(pattern, (route) => {
      const url = route.request().url();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const i = rec.exchanges.findIndex((e, n) => !used.has(n) && (anthropic(url) ? anthropic(e.url) : e.url === url));
      if (i < 0) return route.fulfill({ status: 404, headers: cors, body: '' });
      used.add(i);
      return route.fulfill({ headers: cors, json: rec.exchanges[i].body });
    });
  }
  await withFixture(p);
  await showMap(p, prefix === 'phone' ? 'Map' : 'Both', '-480');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByRole('menuitem', { name: 'Draft with AI…' }).click();
  const panel = p.getByTestId('draft-review');
  await panel.getByLabel('Your Anthropic API key').fill('sk-ant-screenshot-1234');
  await panel.getByRole('button', { name: 'Save key' }).click();
  await panel.getByLabel('What should Claude draft?').fill('The main battles of the Greco-Persian Wars');
  await panel.getByRole('button', { name: 'Draft' }).click();
  await panel.getByTestId('draft-entry').nth(2).waitFor();
  await panel.getByTestId('draft-entry').nth(0).getByRole('button', { name: 'Accept' }).click();
  await p.waitForTimeout(800); // the map frames the dashed pins
  await shot(p, `${prefix}-ai-draft`);
}
if (any('desktop-ai-draft')) await aiDraft(await page('desktop-ai-draft', desktop), 'desktop');
if (any('dark-ai-draft')) await aiDraft(await page('dark-ai-draft', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-ai-draft')) await aiDraft(await page('phone-ai-draft', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// ---------- gallery: the app on the Classical Greece fixture ----------
let presets = [];
if (galleryMode) {
  const vite = devServer ?? (await (await import('vite')).createServer({ logLevel: 'silent', appType: 'custom', server: { middlewareMode: true } }));
  presets = (await vite.ssrLoadModule('/src/ui/gallery/presets.ts')).PRESETS;
  if (!devServer) await vite.close();
}
const phoneOpts = { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true };
const galleryPage = (preset, extra = {}) => page(`gallery-${preset.id}`, { ...(preset.device === 'phone' ? phoneOpts : desktop), ...extra }, `/#gallery/${preset.id}`);

if (argv.includes('--gallery')) {
  const ids = (flag('--gallery', '') ?? '').split(',').filter((x) => x && !x.startsWith('--'));
  for (const preset of presets.filter((x) => !ids.length || ids.includes(x.id))) {
    p = await galleryPage(preset);
    if (preset.view !== 'timeline') await p.locator('[data-testid=map][data-ready]').waitFor({ timeout: 20000 });
    else await p.locator('.vis-item').first().waitFor();
    await p.waitForTimeout(800);
    taken.push(`gallery-${preset.id}`);
    await p.screenshot({ path: `${OUT}gallery-${preset.id}.png` });
  }
}

// A run through time on the map (or split / timeline): frames tiled into one image, or a video of the same run.
async function setYear(p, year) {
  const input = p.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.click();
  await input.fill(String(year));
  await input.press('Enter');
}
const runView = flag('--filmstrip', null) ?? (argv.includes('--video') ? flag('--view', 'map') : null);
if (runView && !runView.startsWith('--')) {
  const preset = { map: 'map-war', split: 'split-decelea', timeline: 'timeline' }[runView];
  if (!preset) throw new Error(`--filmstrip needs map, split or timeline (got ${runView})`);
  const base = presets.find((x) => x.id === preset);
  const from = 1 - Number(flag('--from', 480)), to = 1 - Number(flag('--to', 400)); // BCE → astronomical
  const frames = Number(flag('--frames', 9));
  const bce = (y) => `${1 - y} BCE`;
  if (argv.includes('--filmstrip')) {
    p = await galleryPage(base);
    if (runView !== 'timeline') await p.locator('[data-testid=map][data-ready]').waitFor({ timeout: 20000 });
    const target = runView === 'map' ? p.getByTestId('map') : p.locator('body');
    const strip = [];
    for (let i = 0; i < frames; i++) {
      const year = Math.round(from + ((to - from) * i) / (frames - 1));
      await setYear(p, year);
      await p.waitForTimeout(700);
      strip.push({ caption: bce(year), png: (await target.screenshot()).toString('base64') });
    }
    const sheet = await (await browser.newContext({ viewport: { width: 1500, height: 100 } })).newPage();
    const cols = Math.min(3, frames), w = Math.floor(1480 / cols) - 8;
    await sheet.setContent(`<style>body{margin:8px;font:14px system-ui;display:flex;flex-wrap:wrap;gap:8px}figure{margin:0}img{width:${w}px;display:block;border:1px solid #ccc}figcaption{padding:2px 0;font-weight:600}</style>${strip.map((f) => `<figure><img src="data:image/png;base64,${f.png}"><figcaption>${f.caption}</figcaption></figure>`).join('')}`);
    await sheet.screenshot({ path: `${OUT}filmstrip-${runView}.png`, fullPage: true });
    taken.push(`filmstrip-${runView}`);
  }
  if (argv.includes('--video')) {
    const dir = `${OUT}video-tmp`;
    const size = SIZE_OF[base.device];
    const ctx = await browser.newContext({ ...(base.device === 'phone' ? phoneOpts : desktop), recordVideo: { dir, size } });
    p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`video: ${e.message}`));
    await p.addInitScript(() => { try { localStorage.setItem('chronicle.speed', '10'); } catch { /* fine */ } });
    await p.goto(`${BASE}/#gallery/${base.id}`);
    await p.getByTestId('save-state').waitFor({ state: 'attached' });
    if (runView !== 'timeline') await p.locator('[data-testid=map][data-ready]').waitFor({ timeout: 20000 });
    await setYear(p, from);
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'Play through time' }).click();
    await p.waitForTimeout(((to - from) / 10) * 1000);
    await p.getByRole('button', { name: 'Pause' }).click();
    await p.waitForTimeout(500);
    const video = p.video();
    await ctx.close();
    await video.saveAs(`${OUT}video-${runView}.webm`);
    rmSync(dir, { recursive: true, force: true });
    taken.push(`video-${runView}.webm`);
  }
}

if (argv.includes('--sheet') && taken.filter((n) => !n.endsWith('.webm') && !n.startsWith('filmstrip')).length) {
  // Tile the shots at half size into one page and capture it: one image to review instead of many.
  const imgs = taken.filter((n) => !n.endsWith('.webm') && !n.startsWith('filmstrip')).map((n) => `<figure class="${n.includes('phone') ? 'phone' : ''}"><img src="data:image/png;base64,${readFileSync(`${OUT}${n}.png`).toString('base64')}"><figcaption>${n}</figcaption></figure>`).join('');
  const sheet = await (await browser.newContext({ viewport: { width: 1180, height: 100 } })).newPage();
  await sheet.setContent(`<style>body{margin:8px;font:14px system-ui;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}figure{margin:0}img{width:720px;display:block;border:1px solid #ccc}.phone img{width:206px}figcaption{padding:2px 0}</style>${imgs}`);
  await sheet.screenshot({ path: `${OUT}sheet.png`, fullPage: true });
  taken.push('sheet');
}

await browser.close();
await devServer?.close();
console.log(taken.length ? `Saved ${taken.join(', ')} to ${OUT}` : `No shot matched --only ${onlyArg}`);
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
