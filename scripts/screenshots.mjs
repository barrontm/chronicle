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
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

/** `classic`: open in the classic layout (More → Use the classic layout) unless the page has chosen since. */
async function page(name, options, path = '', classic = false) {
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  if (classic) await p.addInitScript(() => { try { if (localStorage.getItem('chronicle.classicLayout') === null) localStorage.setItem('chronicle.classicLayout', 'true'); } catch { /* fine */ } });
  await p.goto(BASE + path);
  await p.getByTestId('save-state').waitFor({ state: 'attached' });
  return p;
}

async function withFixture(p) {
  await p.getByTestId('import-input').setInputFiles(FIXTURE);
  await p.locator('.tl-mark[data-id=i_aristotle]').waitFor({ state: 'attached' });
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
p = await page('empty', desktop, '', true);
await shot(p, 'desktop-empty');
}

if (any('desktop-timeline', 'desktop-entry', 'desktop-editor', 'desktop-map', 'desktop-split')) {

p = await page('desktop', desktop, '', true);
await withFixture(p);
await shot(p, 'desktop-timeline');
await p.locator('.tl-mark[data-id=i_plato]').click({ force: true });
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

p = await page('dark', { ...desktop, colorScheme: 'dark' }, '', true);
await withFixture(p);
await shot(p, 'desktop-dark');
if (wanted('desktop-dark-influences')) {
  await p.locator('.tl-mark[data-id=i_plato]').click({ force: true });
  await p.waitForTimeout(600); // the timeline zooms to his time
  await shot(p, 'desktop-dark-influences');
  await p.getByRole('button', { name: 'Close panel' }).click();
}
await showMap(p, 'Both', '200 BCE');
await shot(p, 'desktop-dark-split');
}

if (any('phone-timeline', 'phone-map', 'phone-influences')) {

p = await page('phone', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true);
await withFixture(p);
await shot(p, 'phone-timeline');
if (wanted('phone-influences')) {
  await p.locator('.tl-mark[data-id=i_plato]').click({ force: true });
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

if (any('desktop-draw')) await drawBorder(await page('desktop-draw', desktop, '', true), 'desktop');
if (any('dark-draw')) await drawBorder(await page('dark-draw', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-draw')) await drawBorder(await page('phone-draw', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

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

if (any('desktop-migration')) await migration(await page('desktop-migration', desktop, '', true), 'desktop');
if (any('dark-migration')) await migration(await page('dark-migration', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-migration')) await migration(await page('phone-migration', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

// Find a trend: search the bundled catalogue (no network needed).
async function trendSearch(p, prefix) {
  await p.getByRole('button', { name: 'Add a trend' }).click();
  await p.getByTestId('series-editor').getByLabel('Search trends').fill('population');
  await p.locator('.trend-results li').first().waitFor();
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-trends`);
}
if (any('desktop-trends')) await trendSearch(await page('desktop-trends', desktop, '', true), 'desktop');
if (any('dark-trends')) await trendSearch(await page('dark-trends', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-trends')) await trendSearch(await page('phone-trends', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

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
  await p.locator('.tl-mark[data-id=i_plato]').click({ force: true });
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
if (any('desktop-places')) await places(await page('desktop-places', desktop, '', true), 'desktop');
if (any('dark-places')) await places(await page('dark-places', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-places')) await places(await page('phone-places', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

// The timeline in the reader layout: everything in view, then zoomed out far enough to cluster.
async function newTimeline(p, prefix) {
  await p.getByTestId('import-input').setInputFiles(FIXTURE);
  if (prefix === 'phone') await p.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  await p.locator('[data-testid=timeline][data-ready]').waitFor();
  await p.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await p.waitForTimeout(600);
  await shot(p, `${prefix}-new-timeline`);
  await p.getByTestId('time-bar').getByRole('button', { name: 'Zoom the timeline out' }).click();
  await p.waitForTimeout(600);
  await shot(p, `${prefix}-new-timeline-wide`);
  // Plato open: his influences lit up with arrows, the rest faded.
  await p.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await p.waitForTimeout(600);
  await p.locator('.tl-mark[data-id=i_plato]').click({ force: true });
  await p.waitForTimeout(700);
  await shot(p, `${prefix}-new-timeline-plato`);
}
// Every kind of thing on the new timeline (tests/fixtures/every-kind.json), framed on the Classical period.
const KINDS = fileURLToPath(new URL('../tests/fixtures/every-kind.json', import.meta.url));
async function kinds(p, prefix) {
  await p.getByTestId('import-input').setInputFiles(KINDS);
  if (prefix === 'phone') await p.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  await p.locator('[data-testid=timeline][data-ready]').waitFor();
  await p.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await p.waitForTimeout(400);
  await p.locator('.tl-mark[data-id=classical]').click({ force: true });
  await p.getByTestId('item-view').getByRole('button', { name: 'Show its time' }).click();
  await p.getByRole('button', { name: 'Close panel' }).click();
  await p.waitForTimeout(700);
  await shot(p, `${prefix}-kinds`);
}
// Level 0 on the Classical Greece fixture: the Eras stop, then the Classical period hovered.
const GREECE = fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url));
async function eras(p, prefix) {
  await p.getByTestId('import-input').setInputFiles(GREECE);
  if (prefix === 'phone') await p.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  await p.locator('[data-testid=timeline][data-ready]').waitFor();
  await p.getByTestId('time-bar').getByRole('button', { name: 'Eras' }).click();
  await p.waitForTimeout(700);
  await shot(p, `${prefix}-eras`);
  const band = p.locator('.tl-era[data-id=i_classical]');
  const box = await band.boundingBox();
  if (box) await p.mouse.move(box.x + 40, box.y + 12);
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-eras-hover`);
}
// Level 1: the Classical period opened into its six lanes. With `era-zoom`, the opening itself as
// a filmstrip of frames 50 ms apart (the page's clock is paused and stepped, so frames are exact).
async function eraLanes(p, prefix) {
  await p.getByTestId('import-input').setInputFiles(GREECE);
  if (prefix === 'phone') await p.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = p.locator('[data-testid=timeline][data-ready]');
  await timeline.waitFor();
  await p.getByTestId('time-bar').getByRole('button', { name: 'Eras' }).click();
  await p.waitForTimeout(700);
  const box = await p.locator('.tl-era[data-id=i_classical]').boundingBox();
  const film = wanted(`${prefix}-era-zoom`);
  if (film) {
    await p.clock.install();
    await p.clock.pauseAt(new Date(Date.now() + 1000));
  }
  await p.mouse.click(box.x + 30, box.y + 12);
  if (film) {
    const frames = [];
    for (let i = 0; i <= 8; i++) {
      frames.push({ caption: `${i * 50} ms`, png: (await timeline.screenshot()).toString('base64') });
      await p.clock.runFor(50);
    }
    await p.clock.resume();
    const sheet = await (await browser.newContext({ viewport: { width: 1500, height: 100 } })).newPage();
    const w = Math.floor(1480 / 3) - 8;
    await sheet.setContent(`<style>body{margin:8px;font:14px system-ui;display:flex;flex-wrap:wrap;gap:8px}figure{margin:0}img{width:${w}px;display:block;border:1px solid #ccc}figcaption{padding:2px 0;font-weight:600}</style>${frames.map((f) => `<figure><img src="data:image/png;base64,${f.png}"><figcaption>${f.caption}</figcaption></figure>`).join('')}`);
    await sheet.screenshot({ path: `${OUT}${prefix}-era-zoom.png`, fullPage: true });
    taken.push(`${prefix}-era-zoom`);
  }
  await p.waitForTimeout(700);
  await shot(p, `${prefix}-era-lanes`);
  // Further down the lanes: the quieter dimensions and an empty lane's note.
  const t = await timeline.boundingBox();
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await p.keyboard.down('Shift');
  await p.mouse.wheel(0, prefix === 'phone' ? 900 : 330);
  await p.keyboard.up('Shift');
  await p.waitForTimeout(300);
  await shot(p, `${prefix}-era-lanes-below`);
}
if (any('desktop-era-lanes') || any('desktop-era-zoom')) await eraLanes(await page('desktop-era-lanes', desktop), 'desktop');
if (any('dark-era-lanes')) await eraLanes(await page('dark-era-lanes', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-era-lanes') || any('phone-era-zoom')) await eraLanes(await page('phone-era-lanes', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');
if (any('desktop-eras')) await eras(await page('desktop-eras', desktop), 'desktop');
if (any('dark-eras')) await eras(await page('dark-eras', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-eras')) await eras(await page('phone-eras', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// Tall, so every lane is in view.
const tall = { ...desktop, viewport: { width: desktop.viewport.width, height: 1500 } };
if (any('desktop-kinds')) await kinds(await page('desktop-kinds', tall), 'desktop');
if (any('dark-kinds')) await kinds(await page('dark-kinds', { ...tall, colorScheme: 'dark' }), 'dark');
if (any('phone-kinds')) await kinds(await page('phone-kinds', { viewport: { width: 412, height: 1500 }, isMobile: true, hasTouch: true }), 'phone');

if (any('desktop-new-timeline')) await newTimeline(await page('desktop-new-timeline', desktop), 'desktop');
if (any('dark-new-timeline')) await newTimeline(await page('dark-new-timeline', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-new-timeline')) await newTimeline(await page('phone-new-timeline', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// The manual.
async function help(p, prefix) {
  await p.getByRole('button', { name: 'Help' }).click();
  await p.getByTestId('help').waitFor();
  await shot(p, `${prefix}-help`);
}
if (any('desktop-help')) await help(await page('desktop-help', desktop, '', true), 'desktop');
if (any('dark-help')) await help(await page('dark-help', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-help')) await help(await page('phone-help', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

// The reader on a saved article, with the sample timeline beside it.
async function reader(p, prefix) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await p.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (r) => r.fulfill({ headers: cors, json: { pages: [{ key: 'Peloponnesian_War', title: 'Peloponnesian War', description: 'War between Athens and Sparta (431–404 BC)', thumbnail: null }] } }));
  // A real article (CC BY-SA, saved by the reader spike) so the shot shows true Wikipedia content.
  const html = gunzipSync(readFileSync(fileURLToPath(new URL('../tests/fixtures/articles/Peloponnesian_War.html.gz', import.meta.url)))).toString('utf8');
  await p.route('https://en.wikipedia.org/w/rest.php/v1/page/*/html', (r) => r.fulfill({ headers: { ...cors, 'Content-Type': 'text/html' }, body: html }));
  // What the article and the pages it links are about, recorded from Wikidata (tests/fixtures/subjects).
  const dir = new URL('../tests/fixtures/subjects/', import.meta.url);
  const recs = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  const parents = Object.assign({}, ...recs.map((r) => r.parents));
  const labels = Object.assign({}, ...recs.map((r) => r.labels));
  await p.route('https://www.wikidata.org/w/api.php**', (r) => {
    const u = new URL(r.request().url());
    const title = u.searchParams.get('titles');
    if (title) {
      const rec = recs.find((x) => x.title === title);
      return r.fulfill({ headers: cors, json: rec ? rec.entity : { entities: { '-1': { site: 'enwiki', title, missing: '' } } } });
    }
    const ids = (u.searchParams.get('ids') ?? '').split('|');
    return r.fulfill({ headers: cors, json: { entities: Object.fromEntries(ids.map((q) => [q, { id: q, labels: labels[q] ? { en: { value: labels[q] } } : {} }])) } });
  });
  await p.route('https://query.wikidata.org/sparql**', (r) => {
    const ids = [...(new URL(r.request().url()).searchParams.get('query') ?? '').matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
    const entity = (q) => ({ value: `http://www.wikidata.org/entity/${q}` });
    return r.fulfill({ headers: cors, json: { results: { bindings: ids.flatMap((c) => (parents[c] ?? []).map((x) => ({ c: entity(c), p: entity(x) }))) } } });
  });
  // On the phone the timeline is behind the map sheet, so there's nothing to wait for or fit.
  if (prefix === 'phone') { await p.getByTestId('import-input').setInputFiles(FIXTURE); await p.waitForTimeout(500); }
  else await withFixture(p);
  await p.getByTestId('article-search').getByLabel('Search Wikipedia').fill('peloponnesian');
  await p.getByTestId('article-search').getByRole('button', { name: 'Search' }).click();
  await p.getByTestId('article-results').getByRole('button').first().click();
  await p.getByTestId('article').locator('.reader-text').waitFor();
  await p.waitForTimeout(800);
  await shot(p, `${prefix}-reader`);
  if (any(`${prefix}-reader-infobox`)) {
    // Opened, then folded again so the next shots start as Bob first sees the article.
    const head = p.getByTestId('article').getByRole('button', { name: /Infobox/ });
    await head.click();
    await p.waitForTimeout(500);
    await shot(p, `${prefix}-reader-infobox`);
    await head.click();
  }
  if (any(`${prefix}-reader-highlight`) || any(`${prefix}-reader-tray`)) await readerHighlight(p, prefix);
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
  await p.waitForTimeout(600); // the tray's card rises in over 400 ms
  await shot(p, `${prefix}-reader-highlight`);
  // The capture tray with a dimension picked, and no selection.
  await p.evaluate(() => getSelection().removeAllRanges());
  await p.getByTestId('capture-tray').getByRole('button', { name: 'Political' }).click();
  await p.waitForTimeout(500);
  await shot(p, `${prefix}-reader-tray`);
}
if (any('desktop-reader')) await reader(await page('desktop-reader', desktop), 'desktop');
if (any('dark-reader')) await reader(await page('dark-reader', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-reader')) await reader(await page('phone-reader', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

// Asking Claude from the tray: the tribute passage in Pericles, a recorded answer replayed, the event accepted, its connection waiting.
async function readerClaude(p, prefix) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const tribute = 'It was from the alliance\'s treasury that Pericles drew the funds necessary to enable his ambitious building plan, centred on the "Periclean Acropolis", which included the Propylaea, the Parthenon and the golden statue of Athena, sculpted by Pericles\'s friend, Phidias. In 449 BC Pericles proposed a decree allowing the use of 9,000 talents to finance the major rebuilding programme of Athenian temples.';
  await p.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (r) => r.fulfill({ headers: cors, json: { pages: [{ key: 'Pericles', title: 'Pericles', description: 'Athenian statesman', thumbnail: null }] } }));
  await p.route('https://en.wikipedia.org/w/rest.php/v1/page/*/html', (r) => r.fulfill({
    headers: { ...cors, 'Content-Type': 'text/html' },
    body: '<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/42"><head><title>Pericles</title></head><body>' +
      '<section data-mw-section-id="0"><p>Pericles was a Greek statesman and general of Athens during its golden age, between the Persian and Peloponnesian wars.</p></section>' +
      '<section data-mw-section-id="1"><h2>Athens\'s rule over its alliance</h2><p>In 454 BC the treasury of the Delian League was moved from Delos to Athens, and the allies’ tribute now came to the city.</p>' +
      `<p>${tribute}</p><p>The building programme employed thousands of craftsmen and labourers for fifteen years.</p></section></body></html>`,
  }));
  const rec = JSON.parse(readFileSync(fileURLToPath(new URL('../tests/ai-evals/highlight/recordings/handmade-tribute.json', import.meta.url)), 'utf8'));
  const used = new Set();
  const anthropic = (u) => u.startsWith('https://api.anthropic.com/');
  for (const pattern of ['https://api.anthropic.com/**', 'https://en.wikipedia.org/w/api.php**', 'https://www.wikidata.org/**']) {
    await p.route(pattern, (route) => {
      const url = route.request().url();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const i = rec.exchanges.findIndex((e, n) => !used.has(n) && (anthropic(url) ? anthropic(e.url) : e.url === url));
      if (i < 0) return route.fulfill({ headers: cors, json: { entities: {} } });
      used.add(i);
      return route.fulfill({ headers: cors, json: rec.exchanges[i].body });
    });
  }
  await p.evaluate(() => localStorage.setItem('chronicle.anthropicKey', 'sk-ant-screenshot-1234'));
  await p.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/ai-evals/highlight/doc.json', import.meta.url)));
  await p.waitForTimeout(500);
  await p.getByTestId('article-search').getByLabel('Search Wikipedia').fill('pericles');
  await p.getByTestId('article-search').getByRole('button', { name: 'Search' }).click();
  await p.getByTestId('article-results').getByRole('button').first().click();
  await p.getByTestId('article').getByText('In 449 BC').waitFor();
  const at = await p.evaluate((phone) => {
    const para = [...document.querySelectorAll('.reader-text p')].find((x) => x.textContent.includes('449 BC'));
    para.scrollIntoView({ block: 'start' });
    const r = document.createRange();
    r.selectNodeContents(para);
    if (!phone) { getSelection().removeAllRanges(); getSelection().addRange(r); }
    const b = r.getClientRects()[r.getClientRects().length - 1];
    return { x: b.left + 20, y: b.top + b.height / 2 };
  }, prefix === 'phone');
  if (prefix === 'phone') await p.touchscreen.tap(at.x, at.y);
  else { await p.getByRole('button', { name: 'Highlight' }).waitFor(); await p.keyboard.press('h'); }
  const tray = p.getByTestId('capture-tray');
  await p.evaluate(() => getSelection().removeAllRanges());
  await tray.getByRole('button', { name: 'Ask Claude' }).click();
  await tray.getByTestId('draft-entry').waitFor();
  await p.waitForTimeout(900); // the tray scrolls to the drafts; the map frames the dashed pin
  await shot(p, `${prefix}-reader-claude`);
  await tray.getByTestId('draft-entry').getByRole('button', { name: 'Accept' }).click();
  await tray.getByRole('button', { name: 'Economic, suggested by Claude' }).click();
  await p.waitForTimeout(700);
  await shot(p, `${prefix}-reader-claude-accepted`);
}
if (any('desktop-reader-claude')) await readerClaude(await page('desktop-reader-claude', desktop), 'desktop');
if (any('dark-reader-claude')) await readerClaude(await page('dark-reader-claude', { ...desktop, colorScheme: 'dark' }), 'dark');
if (any('phone-reader-claude')) await readerClaude(await page('phone-reader-claude', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }), 'phone');

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
if (any('desktop-ai-draft')) await aiDraft(await page('desktop-ai-draft', desktop, '', true), 'desktop');
if (any('dark-ai-draft')) await aiDraft(await page('dark-ai-draft', { ...desktop, colorScheme: 'dark' }, '', true), 'dark');
if (any('phone-ai-draft')) await aiDraft(await page('phone-ai-draft', { viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true }, '', true), 'phone');

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
    else await p.locator('[data-testid=timeline][data-ready]').waitFor();
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
