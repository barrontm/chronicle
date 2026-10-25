import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));

// The map (WebGL under SwiftShader) loads beside the reader in every test here, which is slow with parallel workers.
test.describe.configure({ timeout: 60_000 });

/**
 * Each test gets a fresh browser context, so IndexedDB starts empty. On a phone the map and the
 * timeline are a sheet over the reader, so `open` opens it.
 */
async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await openSheet(page);
}

const isPhone = (page: Page) => page.viewportSize()!.width <= 860;

/** On a phone, open the map sheet from the reader (it starts closed after every reload). */
async function openSheet(page: Page) {
  if (isPhone(page)) await page.getByTestId('reader').getByRole('button', { name: 'Map', exact: true }).click();
}

/** Open an entry through Search, for one the short timeline beside the reader may have out of view. */
async function openBySearch(page: Page, q: string, title: string) {
  // On a phone, Search opens from its magnifier button.
  if (isPhone(page)) await page.getByRole('button', { name: 'Search Chronicle' }).click();
  else {
    await page.locator('.brand').click();
    await page.keyboard.press('/');
  }
  await page.getByRole('combobox', { name: 'Search Chronicle' }).fill(q);
  await page.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: new RegExp(title) }).first().click();
  await expect(page.getByTestId('item-view').getByRole('heading', { name: title })).toBeVisible();
}

/**
 * The sample fixture has no polities or periods, so the timeline (the overview) draws none of its
 * entries: they're opened from Search, as Bob would.
 */
async function importFixture(page: Page) {
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.locator('.doc-title')).toHaveValue('Test fixture');
}

/** Double-click an empty part of the timeline to add an entry by hand, and say what it is. */
async function newEntry(page: Page, kind: 'Event' | 'Period' | 'Person') {
  const editor = page.getByTestId('item-editor');
  // The timeline frames the last entry added, so first step a few screens later in time, past anything on it.
  const wheel = page.getByTestId('thumbwheel');
  for (let n = 0; n < 3; n++) await wheel.press('PageDown');
  // The timeline may still be drawing on the first try.
  await expect(async () => {
    const box = (await page.getByTestId('timeline').boundingBox())!;
    await page.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await expect(editor.getByRole('heading', { name: 'New entry' })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await editor.locator('.segmented').first().getByRole('button', { name: kind, exact: true }).click();
  return editor;
}

async function addEntry(page: Page, kind: 'Event' | 'Period' | 'Person', title: string, start: string, end?: string) {
  const editor = await newEntry(page, kind);
  await editor.getByLabel(/Title|Name/).fill(title);
  await editor.getByLabel(/^(Date|From|Born)$/).fill(start);
  if (end) await editor.getByLabel(/^(To|Died)$/).fill(end);
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(page.getByTestId('item-view').getByRole('heading', { name: title })).toBeVisible();
}

test('a new timeline starts empty and says it fills in as Bob reads @phone', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('empty-state')).toHaveText('Your map and timeline fill in as you add what you read.');
  await expect(page.getByTestId('timeline').locator('.tl-mark')).toHaveCount(0);
});

test('add an event, reading BCE dates the way people write them', async ({ page }) => {
  await open(page);
  const editor = await newEntry(page, 'Event');
  await editor.getByLabel('Title').fill('Battle of Marathon');
  await editor.getByLabel('Date').fill('490 BCE');
  await expect(editor.getByText('Reads as 490 BCE')).toBeVisible();
  await editor.getByLabel('Category').selectOption('war');
  await editor.getByLabel('Summary').fill('Athens defeats the first Persian invasion.');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();

  const view = page.getByTestId('item-view');
  await expect(view.getByRole('heading', { name: 'Battle of Marathon' })).toBeVisible();
  await expect(view.getByText('490 BCE')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
});

test('rejects dates it cannot read and ends before starts', async ({ page }) => {
  await open(page);
  const editor = await newEntry(page, 'Period');
  await editor.getByLabel('Title').fill('Backwards war');
  await editor.getByLabel('From', { exact: true }).fill('sometime');
  await expect(editor.getByText('Try 1914, 1914-07-28, 431 BCE or c. 1440')).toBeVisible();
  await editor.getByLabel('From', { exact: true }).fill('1918');
  await editor.getByLabel('To', { exact: true }).fill('1914');
  await expect(editor.getByText('The end date is before the start date.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Add to timeline' })).toBeDisabled();
});

test('entries survive a reload', async ({ page }) => {
  await open(page);
  await addEntry(page, 'Person', 'Hypatia', 'c. 360', '415');
  await page.waitForTimeout(400); // debounce
  await page.reload();
  await openBySearch(page, 'Hypatia', 'Hypatia');
});

test('write a note linked to two people, with a cited source', async ({ page }) => {
  await open(page);
  await addEntry(page, 'Person', 'Plato', 'c. 428 BCE', 'c. 348 BCE');
  await addEntry(page, 'Person', 'Aristotle', '384 BCE', '322 BCE');

  await page.getByTestId('item-view').getByRole('button', { name: 'Write a note' }).click();
  const editor = page.getByTestId('note-editor');
  await editor.getByLabel('Title').fill('Forms vs. substances');
  await editor.getByLabel('Note').fill('Aristotle rejected separately existing Forms.');
  await editor.getByPlaceholder('Link to an entry or trend…').fill('Pla');
  await editor.getByRole('option', { name: /Plato/ }).click();

  await editor.getByRole('button', { name: 'New source' }).click();
  const quick = page.getByTestId('quick-source');
  await quick.getByLabel('Title').fill('Aristotle: A Very Short Introduction');
  await quick.getByLabel('Author(s)').fill('Jonathan Barnes');
  await quick.getByRole('button', { name: 'Add and cite' }).click();
  await editor.getByLabel('Pages or location').fill('ch. 6');
  await editor.getByRole('button', { name: 'Save note' }).click();

  const note = page.getByTestId('note-view');
  await expect(note.getByRole('heading', { name: 'Forms vs. substances' })).toBeVisible();
  await expect(note.getByRole('button', { name: 'Plato' })).toBeVisible();
  await expect(note.getByText('Jonathan Barnes, Aristotle: A Very Short Introduction, ch. 6')).toBeVisible();

  // Follow the link to Plato: the note is listed there too.
  await note.getByRole('button', { name: 'Plato' }).click();
  await expect(page.getByTestId('item-view').getByRole('button', { name: /^Forms vs\. substances/ })).toBeVisible();

  // The source shows where it is cited.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByTestId('library').getByRole('tab', { name: /^Sources/ }).click();
  await page.getByTestId('library').getByRole('button', { name: /Very Short Introduction/ }).click();
  await expect(page.getByTestId('source-view').getByText('Forms vs. substances')).toBeVisible();
});

test('connect two entries and navigate between them', async ({ page }) => {
  await open(page);
  await addEntry(page, 'Person', 'Socrates', 'c. 470 BCE', '399 BCE');
  await addEntry(page, 'Person', 'Plato', 'c. 428 BCE', 'c. 348 BCE');
  await page.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('item-editor');
  await editor.getByLabel('Kind of connection').selectOption({ label: 'Influenced by' });
  await editor.getByPlaceholder('…which entry?').fill('Soc');
  await editor.getByRole('option', { name: /Socrates/ }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();

  const view = page.getByTestId('item-view');
  await expect(view.getByText('Influenced by')).toBeVisible();
  await view.getByRole('button', { name: /Socrates/ }).click();
  await expect(page.getByTestId('item-view').getByText('Influenced', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Plato' })).toBeVisible();
});

test('add a picture from Wikimedia Commons with its credit', async ({ page }) => {
  await page.route('https://commons.wikimedia.org/w/api.php**', (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        query: {
          pages: {
            '1': {
              title: 'File:Rosetta Stone.jpg', index: 1,
              imageinfo: [{
                url: 'https://upload.wikimedia.org/rosetta.jpg', thumburl: 'https://upload.wikimedia.org/rosetta-640.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Rosetta_Stone.jpg', mime: 'image/jpeg',
                extmetadata: { Artist: { value: 'Hans Hillewaert' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
              }],
            },
          },
        },
      },
    }),
  );
  // Serve a tiny image for the picked thumbnail so nothing leaves the test.
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }),
  );
  await open(page);
  const editor = await newEntry(page, 'Event');
  await editor.getByLabel('Title').fill('Rosetta Stone carved');
  await editor.getByLabel('Date').fill('196 BCE');
  await editor.getByRole('button', { name: 'Add a picture' }).click();
  await page.getByLabel('Search Wikimedia Commons').fill('Rosetta Stone');
  await page.getByRole('dialog').getByRole('button', { name: 'Search' }).click();
  await page.getByTestId('commons-results').getByRole('button', { name: /Rosetta Stone/ }).click();
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(page.getByTestId('item-view').getByText(/Hans Hillewaert, CC BY-SA 4\.0/)).toBeVisible();
});

test('add a trend by pasting numbers; it lines up under the timeline', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add a trend' }).click();
  const editor = page.getByTestId('series-editor');
  await editor.getByLabel('Name').fill('World population');
  await editor.getByLabel('Unit').fill('people');
  await editor.getByLabel('One “year, value” per line').fill('1800, 990000000\n1900, 1650000000\n1950, 2500000000\n2000, 6100000000');
  await expect(editor.getByText('4 points read')).toBeVisible();
  await editor.getByRole('button', { name: 'Add trend' }).click();
  await expect(page.locator('.strip', { hasText: 'World population' })).toBeVisible();
});

test('import a backup, then merge in a copy edited elsewhere', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await expect(page.locator('.strip')).toHaveCount(2);
  // Importing again into a non-empty timeline asks merge vs replace.
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-choice')).toBeVisible();
  await page.getByRole('button', { name: 'Merge into my timeline' }).click();
  // Merged, not doubled: one of each trend, and one Aristotle.
  await expect(page.locator('.strip')).toHaveCount(2);
  await page.locator('.brand').click();
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search Chronicle' }).fill('Aristotle');
  await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: /^Aristotle\b.*BCE/ })).toHaveCount(1);
});

test('explains why a bad file cannot be imported', async ({ page }) => {
  await open(page);
  await page.getByTestId('import-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"items":[{"id":"a"}]}') });
  await expect(page.getByRole('alert')).toContainText('isn’t a valid timeline'.replace('’', "'"));
});

test('works offline after the first visit', async ({ page, context }) => {
  await open(page);
  await addEntry(page, 'Event', 'Fall of Constantinople', '1453-05-29');
  await page.waitForTimeout(400);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the service worker take control
  await context.setOffline(true);
  await page.reload();
  await openBySearch(page, 'Constantinople', 'Fall of Constantinople');
  await context.setOffline(false);
});

test('move through time with the wheel, the thumbwheel and the zoom bar; opening a person from Search zooms to their time @phone', async ({ page }) => {
  await open(page);
  await importFixture(page);
  const span = page.getByTestId('zoom-span');
  const wheel = page.getByTestId('thumbwheel');
  const centre = async () => Number(await wheel.getAttribute('aria-valuenow'));

  // A zoom stop sets how much time is in view.
  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await expect(span).toHaveText('100 years in view');
  await expect(page.getByTestId('time-bar').getByRole('button', { name: 'Century' })).toHaveAttribute('aria-pressed', 'true');

  // The plain wheel moves through time without zooming.
  const before = await centre();
  const box = (await page.getByTestId('timeline').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(centre).toBeGreaterThan(before);
  await expect(span).toHaveText('100 years in view');

  // Dragging the thumbwheel right goes back in time; the arrow keys step forward.
  const w = (await wheel.boundingBox())!;
  const afterWheel = await centre();
  await page.mouse.move(w.x + w.width * 0.3, w.y + w.height / 2);
  await page.mouse.down();
  await page.mouse.move(w.x + w.width * 0.6, w.y + w.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(centre).toBeLessThan(afterWheel);
  // A key press also stops a flick's glide, so read the year once it has stopped changing
  // (the timeline reports its window on the next frame).
  // Under load a frame can take longer than a poll, so wait for the step back to land as well.
  const beforeStep = await centre();
  await wheel.press('ArrowLeft');
  let settled = NaN;
  await expect.poll(async () => { const was = settled; settled = await centre(); return settled === was && settled < beforeStep; }, { intervals: [200] }).toBe(true);
  await wheel.press('ArrowRight');
  await expect.poll(centre).toBeGreaterThan(settled);

  // Opening Plato from Search frames his life with Socrates and Aristotle.
  await page.getByTestId('time-bar').getByRole('button', { name: 'Millennium' }).click();
  await expect(span).toHaveText('1,000 years in view');
  await openBySearch(page, 'Plato', 'Plato');
  await expect(span).toHaveText('180 years in view');

  // His bibliography: what notes and connections cite, and what he wrote.
  const bib = page.getByTestId('bibliography');
  await expect(bib.getByRole('button', { name: /Aristotle: A Very Short Introduction.*Cited in Socrates → Plato → Aristotle/ })).toBeVisible();
  await expect(bib.getByTestId('works-by')).toContainText('Republic');

  // Back to where I was (on a phone the entry's panel covers the timeline, so close it first).
  if (isPhone(page)) await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Back to where I was' }).click();
  await expect(span).toHaveText('1,000 years in view');
  await expect(page.getByRole('button', { name: 'Back to where I was' })).toHaveCount(0);
});

test('Wikipedia suggests influences: connect one on the timeline, add one that isn’t', async ({ page }) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const snak = (value: unknown) => ({ mainsnak: { snaktype: 'value', datavalue: { value } }, rank: 'normal' });
  await page.route('https://www.wikidata.org/w/api.php**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'query') {
      expect(url.searchParams.get('srsearch')).toBe('haswbstatement:P737=Q99999912');
      return route.fulfill({ headers: cors, json: { query: { search: [{ title: 'Q99999930' }] } } });
    }
    if (url.searchParams.get('props') === 'labels|sitelinks') {
      const page = (label: string) => ({ labels: { en: { value: label } }, sitelinks: { enwiki: { title: label } } });
      return route.fulfill({ headers: cors, json: { entities: {
        Q99999910: page('Plato'), Q99999911: page('Socrates'), Q99999930: page('Alexander the Great'),
      } } });
    }
    return route.fulfill({ headers: cors, json: { entities: { Q99999912: { claims: {
      P31: [snak({ id: 'Q5' })], P737: [snak({ id: 'Q99999910' }), snak({ id: 'Q99999911' })],
    } } } } });
  });
  await open(page);
  await importFixture(page);
  await openBySearch(page, 'Aristotle', 'Aristotle');
  const view = page.getByTestId('item-view');
  const suggestions = view.getByTestId('influence-suggestions');
  await suggestions.getByRole('button', { name: 'Suggest influences' }).click();

  // Plato is already connected, so only Socrates is offered.
  await expect(suggestions.getByText('Plato')).toHaveCount(0);
  await suggestions.getByRole('listitem').filter({ hasText: 'Socrates' }).getByRole('button', { name: 'Connect' }).click();
  await expect(view.getByRole('button', { name: 'Influenced by Socrates' })).toBeVisible();
  await expect(suggestions.getByText('Socrates')).toHaveCount(0);
  await expect(suggestions.getByRole('listitem').filter({ hasText: 'Alexander the Great' }).getByRole('button', { name: 'Add from Wikipedia' })).toBeVisible();
});

// ---------- Help ----------

test('the manual opens offline, shows the version and jumps to a section @phone', async ({ page, context }) => {
  await open(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Help' }).click();
  const help = page.getByTestId('help');
  await expect(help.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(help).toContainText(/Version \w+, built/);
  await help.getByRole('navigation', { name: 'Manual contents' }).getByRole('link', { name: 'Territories' }).click();
  await expect(help.getByRole('heading', { name: 'Territories', exact: true })).toBeInViewport();
});

test('“How drawing works” opens the manual at territories', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add a territory' }).click();
  await page.getByTestId('own-borders').getByRole('button', { name: 'How drawing works' }).click();
  await expect(page.getByTestId('help').getByRole('heading', { name: 'Draw your own' })).toBeInViewport();
});

// ---------- Carrying data into later versions ----------

const FIXTURE_V5 = fileURLToPath(new URL('../tests/fixtures/sample-history-v5.json', import.meta.url));
const FIXTURE_V6 = fileURLToPath(new URL('../tests/fixtures/sample-history-v6.json', import.meta.url));
const FIXTURE_V7 = fileURLToPath(new URL('../tests/fixtures/sample-history-v7.json', import.meta.url));
const FIXTURE_V8 = fileURLToPath(new URL('../tests/fixtures/sample-history-v8.json', import.meta.url));

/** Replace the saved doc in IndexedDB, as an older or newer version of the app would have left it. */
async function seedSavedDoc(page: Page, doc: Record<string, unknown>) {
  await page.evaluate((d) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('chronicle');
    req.onsuccess = () => {
      const tx = req.result.transaction(['docs', 'meta'], 'readwrite');
      tx.objectStore('docs').put(d);
      tx.objectStore('meta').put(d.id, 'activeDocId');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), doc);
}

async function savedState(page: Page) {
  return page.evaluate(() => new Promise<{ schemaVersion: number; title: string; backups: number }>((resolve) => {
    const req = indexedDB.open('chronicle');
    req.onsuccess = () => {
      const tx = req.result.transaction(['docs', 'meta', 'backups']);
      const id = tx.objectStore('meta').get('activeDocId');
      const count = tx.objectStore('backups').count();
      id.onsuccess = () => {
        const doc = tx.objectStore('docs').get(id.result);
        tx.oncomplete = () => { req.result.close(); resolve({ schemaVersion: doc.result.schemaVersion, title: doc.result.title, backups: count.result }); };
      };
    };
  }));
}

test('a timeline saved by an older version opens upgraded, with a copy kept', async ({ page }) => {
  await open(page);
  const { readFileSync } = await import('node:fs');
  await seedSavedDoc(page, JSON.parse(readFileSync(FIXTURE_V5, 'utf8')));
  await page.reload();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect.poll(() => savedState(page)).toMatchObject({ schemaVersion: 9, backups: 1 });
  // The v5 excerpt is now a highlight, still shown on its entry.
  await openBySearch(page, 'Magna', 'Magna Carta');
  await expect(page.getByTestId('item-view').getByTestId('excerpt')).toContainText('royal charter of rights');
});

test('a timeline saved before entries said what they are opens upgraded, each entry as it was', async ({ page }) => {
  await open(page);
  const { readFileSync } = await import('node:fs');
  await seedSavedDoc(page, JSON.parse(readFileSync(FIXTURE_V6, 'utf8')));
  await page.reload();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect.poll(() => savedState(page)).toMatchObject({ schemaVersion: 9, backups: 1 });
  await openBySearch(page, 'industrial', 'Industrial Revolution');
  await page.getByTestId('item-view').getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('item-editor').getByLabel('Kind of thing')).toHaveValue('');
  await expect(page.getByTestId('item-editor').getByLabel('Region')).toHaveValue('');
});

test('a timeline saved before places could go without dates opens upgraded', async ({ page }) => {
  await open(page);
  const { readFileSync } = await import('node:fs');
  await seedSavedDoc(page, JSON.parse(readFileSync(FIXTURE_V7, 'utf8')));
  await page.reload();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect.poll(() => savedState(page)).toMatchObject({ schemaVersion: 9, backups: 1 });
  await openBySearch(page, 'Peloponnesian', 'Peloponnesian War');
});

test('a timeline saved before lanes opens upgraded, each entry in the lane its dimension became', async ({ page }) => {
  await open(page);
  const { readFileSync } = await import('node:fs');
  await seedSavedDoc(page, JSON.parse(readFileSync(FIXTURE_V8, 'utf8')));
  await page.reload();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect.poll(() => savedState(page)).toMatchObject({ schemaVersion: 9, backups: 1 });
  await openBySearch(page, 'Magna', 'Magna Carta');
  await expect(page.getByTestId('item-view').getByTestId('item-lanes')).toHaveText('Politics and law');
});

test('an older copy of the app never overwrites data from a newer one', async ({ page }) => {
  await open(page);
  await seedSavedDoc(page, { schemaVersion: 99, id: 'doc_newer', title: 'From the future', categories: [], items: [], series: [], territories: [], notes: [], sources: [], relations: [], deleted: {}, updatedAt: 1 });
  await page.reload();
  await expect(page.getByTestId('read-only')).toContainText('saved by a newer version of Chronicle');
  await expect(page.getByTestId('save-state')).toHaveText('Read-only');
  await page.getByLabel('Timeline name').fill('Changed by an old tab');
  await page.waitForTimeout(500);
  expect(await savedState(page)).toMatchObject({ schemaVersion: 99, title: 'From the future' });
});

test('a new version waits for Bob to reload', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new Event('chronicle:update-ready')));
  const banner = page.getByTestId('update-ready');
  await expect(banner).toContainText('A new version of Chronicle is ready.');
  await banner.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect(banner).toHaveCount(0);
});

// ---------- Map ----------

/** The map beside the reader (on a phone, in the sheet `open` opened), once it has loaded. */
async function openMap(page: Page) {
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
}

async function goToYear(page: Page, year: string) {
  const input = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.click();
  await input.fill(year);
  await input.press('Enter');
  await expect(input).toHaveValue(year);
}

const territoryLabel = (page: Page, name: string) => page.locator('.map-label.territory', { hasText: name });

test('the map shows borders and entries for the chosen year @phone', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await openMap(page);
  await goToYear(page, '300 BCE');
  await expect(territoryLabel(page, 'Fixture Republic')).toBeVisible();
  await goToYear(page, '500');
  await expect(territoryLabel(page, 'Fixture Republic')).toHaveCount(0);
  await goToYear(page, '1215');
  await expect(page.locator('.map-label.pin', { hasText: 'Magna Carta sealed' })).toBeVisible();
});

test('the timeline playhead and the map share one year', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await openMap(page);
  await goToYear(page, '1914');
  await expect(page.getByTestId('timeline').locator('.tl-year')).toHaveText('1914');
  await page.getByRole('button', { name: 'Play through time' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId('yearbar').getByLabel('Year', { exact: true }).inputValue())).toBeGreaterThan(1914);
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('“Show on map” jumps to an entry’s year with the map open', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await openBySearch(page, 'Magna', 'Magna Carta');
  await page.getByTestId('item-view').getByRole('button', { name: 'Show on map' }).click();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId('yearbar').getByLabel('Year', { exact: true })).toHaveValue('1215');
  await expect(page.locator('.map-label.pin', { hasText: 'Magna Carta sealed' })).toBeVisible();
});

test('give a hand-made entry its places: look one up, type one, edit and remove it, and see the pin', async ({ page }) => {
  await page.route('https://en.wikipedia.org/w/api.php**', (route) => route.fulfill({
    json: { query: { pages: [
      { title: 'Salamis Island', index: 1, description: 'Greek island', coordinates: [{ lat: 37.9333, lon: 23.5 }] },
      { title: 'Salamis (disambiguation)', index: 2 },
    ] } },
    headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await open(page);
  const editor = await newEntry(page, 'Event');
  await editor.getByLabel('Title').fill('Battle of Salamis');
  await editor.getByLabel('Date').fill('480 BCE');

  // Look one up on Wikipedia; Enter in the name searches instead of saving the entry.
  await editor.getByRole('button', { name: 'Add a place' }).click();
  await editor.getByLabel('Place name').fill('Salamis');
  await editor.getByLabel('Place name').press('Enter');
  const results = editor.getByTestId('place-results');
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Salamis Island/ }).click();
  await expect(editor.getByLabel('Coordinates')).toHaveValue('37.9333, 23.5');
  await editor.getByRole('button', { name: 'Add place' }).click();
  const places = editor.getByTestId('places-list');
  await expect(places).toContainText('Salamis (37.93°N, 23.50°E)');

  // Type one by hand, fix it, then take it out again.
  await editor.getByRole('button', { name: 'Add a place' }).click();
  await editor.getByLabel('Place name').fill('Piraeus');
  await editor.getByLabel('Coordinates').fill('not a place');
  await expect(editor.getByText('I can’t read these.', { exact: false })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Add place' })).toBeDisabled();
  await editor.getByLabel('Coordinates').fill('37°56′N 23°38′E');
  await editor.getByRole('button', { name: 'Add place' }).click();
  await expect(places).toContainText('Piraeus (37.93°N, 23.63°E)');
  await places.getByRole('button', { name: 'Edit' }).nth(1).click();
  await editor.getByLabel('Place name').fill('Port of Piraeus');
  await editor.getByRole('button', { name: 'Save place' }).click();
  await expect(places).toContainText('Port of Piraeus');
  await places.getByRole('button', { name: 'Remove' }).nth(1).click();
  await expect(places).not.toContainText('Piraeus');

  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  const view = page.getByTestId('item-view');
  await expect(view.getByTestId('item-places')).toHaveText('Salamis (37.93°N, 23.50°E)');
  await view.getByRole('button', { name: 'Show on map' }).click();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('.map-label.pin', { hasText: 'Battle of Salamis' })).toBeVisible();
});

test('color the map by a trend with values per country', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await openMap(page);
  await goToYear(page, '1900');
  await page.getByRole('button', { name: 'Layers' }).click();
  await page.getByLabel('Color the map by').selectOption({ label: 'Regional index (test data)' });
  const legend = page.getByTestId('map-legend');
  await expect(legend).toContainText('Regional index (test data)');
  await expect(legend).toContainText('3 countries with data in 1900');
  await goToYear(page, '1700');
  await expect(legend).toContainText('No data for 1700');
});

test('record a migration and see its arrow only while people were moving', async ({ page }) => {
  await open(page);
  await openMap(page);
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByTestId('library').getByRole('tab', { name: /^Migration/ }).click();
  await page.getByTestId('library').getByRole('button', { name: 'New migration' }).click();
  const editor = page.getByTestId('flow-editor');
  await editor.getByLabel('Name', { exact: true }).fill('Irish famine emigration');
  await editor.getByLabel('Cause').selectOption({ label: 'Famine & disaster' });
  await editor.getByLabel('From country').fill('Ireland');
  await editor.getByLabel('To country').fill('United States of America');
  await editor.getByLabel('People moving each year').fill('1846, 130000\n1855, 130000');
  await editor.getByRole('button', { name: 'Add to map' }).click();
  await expect(page.getByTestId('flow-routes')).toContainText('Ireland → United States of America');

  await goToYear(page, '1850');
  await expect(page.getByTestId('map')).toHaveAttribute('data-flow-count', '1');
  const legend = page.getByTestId('flow-legend');
  await expect(legend).toContainText('Famine & disaster');
  await expect(legend).toContainText('1 route in 1850');
  await goToYear(page, '1870');
  await expect(page.getByTestId('map')).toHaveAttribute('data-flow-count', '0');
  await expect(legend).toContainText('No migration routes in 1870');
});

test('draw a city-state’s borders and date them @phone', async ({ page }) => {
  // Loads the WebGL map twice (before and after reopening); under SwiftShader with
  // parallel workers that alone can pass the default 30s.
  test.slow();
  await open(page);
  await openMap(page);
  await goToYear(page, '450 BCE');
  await page.getByRole('button', { name: 'Add a territory' }).click();
  await page.getByTestId('own-borders').getByRole('button', { name: 'Draw on the map' }).click();

  const toolbar = page.getByTestId('draw-toolbar');
  await expect(toolbar).toContainText('Click on the map to outline the border.');
  const box = (await page.getByTestId('map').boundingBox())!;
  const at = (dx: number, dy: number) => ({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
  const canvas = page.locator('[data-testid=map] canvas');
  await canvas.click(at(-50, -20));
  await canvas.click(at(50, -20));
  await canvas.click(at(50, 50));
  await toolbar.getByRole('button', { name: 'Undo point' }).click();
  await canvas.click(at(0, 60));
  await toolbar.getByRole('button', { name: 'Done' }).click();
  await expect(toolbar).toHaveCount(0);

  const form = page.getByTestId('own-borders');
  await expect(form).toContainText('Borders ready');
  await form.getByLabel('Name').fill('Athens');
  await form.getByLabel('From').fill('508 BCE');
  await form.getByRole('button', { name: 'Add to map' }).click();

  const view = page.getByTestId('territory-view');
  await expect(view.getByRole('heading', { name: 'Athens' })).toBeVisible();
  await expect(view).toContainText('From 508 BCE');
  await expect(view).toContainText('Borders from Drawn by me.');
  await expect(territoryLabel(page, 'Athens')).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await goToYear(page, '600 BCE');
  await expect(territoryLabel(page, 'Athens')).toHaveCount(0);

  // What's drawn on the map is saved: it's still there after reopening the app.
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.reload();
  await openSheet(page);
  await openMap(page);
  await goToYear(page, '450 BCE');
  await expect(territoryLabel(page, 'Athens')).toBeVisible();
});

test('bring city-state borders from a GeoJSON file and date them in the editor', async ({ page }) => {
  await open(page);
  await openMap(page);
  await goToYear(page, '431 BCE');
  await page.getByRole('button', { name: 'Add a territory' }).click();
  const own = page.getByTestId('own-borders');
  await own.getByLabel('Or bring borders from a GeoJSON file').setInputFiles(fileURLToPath(new URL('../tests/fixtures/city-states.geojson', import.meta.url)));
  await own.getByTestId('geojson-areas').getByRole('button', { name: /Test Polis B/ }).click();
  await expect(own.getByLabel('Name')).toHaveValue('Test Polis B');
  await own.getByRole('button', { name: 'Add to map' }).click();
  await expect(territoryLabel(page, 'Test Polis B')).toBeVisible();

  // Give the borders an end date: gone from the map afterwards.
  await page.getByTestId('territory-view').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('territory-editor');
  await editor.getByLabel('Until').fill('404 BCE');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('territory-view')).toContainText('431–404 BCE');
  await goToYear(page, '400 BCE');
  await expect(territoryLabel(page, 'Test Polis B')).toHaveCount(0);
});

test.describe('historical maps', () => {
  // The service worker caches historical maps, which would hide the requests from page.route.
  test.use({ serviceWorkers: 'block' });

  const square = (x: number, y: number, s: number) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
  async function mockBasemaps(page: Page) {
    await page.route('https://raw.githubusercontent.com/aourednik/historical-basemaps/**', (route) => {
      const file = route.request().url().split('/').pop()!;
      // Rome grows between 300 and 100 BCE and appears on no other maps.
      const rome = { 'world_bc300.geojson': 3, 'world_bc200.geojson': 6, 'world_bc100.geojson': 9 }[file];
      const features = [
        { type: 'Feature', properties: { NAME: 'Carthage' }, geometry: square(5, 32, 4) },
        ...(rome ? [{ type: 'Feature', properties: { NAME: 'Rome' }, geometry: square(10, 38, rome) }] : []),
      ];
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { type: 'FeatureCollection', features } });
    });
  }

  test('import a polity’s borders across several maps', async ({ page }) => {
    await mockBasemaps(page);
    await open(page);
    await openMap(page);
    await goToYear(page, '200 BCE');
    await page.getByRole('button', { name: 'Add a territory' }).click();
    const panel = page.getByTestId('territory-import');
    await expect(panel.getByLabel('Map year')).toHaveValue('world_bc200.geojson');
    await panel.getByRole('button', { name: 'Show its polities' }).click();
    await panel.getByLabel('Search polities').fill('ro');
    await panel.getByTestId('polities').getByRole('button', { name: 'Rome' }).click();
    await panel.getByRole('button', { name: /Look through 9 maps/ }).click();
    await expect(panel.getByText('Found on 3 maps: 300 BCE, 200 BCE, 100 BCE.')).toBeVisible();
    await panel.getByLabel('Name').fill('Roman Republic');
    await panel.getByRole('button', { name: 'Add to map' }).click();

    const view = page.getByTestId('territory-view');
    await expect(view.getByRole('heading', { name: 'Roman Republic' })).toBeVisible();
    await expect(view.getByRole('link', { name: /historical-basemaps/ })).toBeVisible();
    await expect(territoryLabel(page, 'Roman Republic')).toBeVisible();
    await goToYear(page, '500');
    await expect(territoryLabel(page, 'Roman Republic')).toHaveCount(0);
  });

  test('a territory takes Seshat’s borders only when Bob confirms', async ({ page }) => {
    await mockBasemaps(page);
    // Test data, not Cliopatria's: Seshat has the Roman Republic in two sets, from 300 BCE.
    const sets = [
      { from: { y: -299 }, to: { y: -199 }, geometry: square(11, 40, 2), areaKm2: 40000 },
      { from: { y: -199 }, to: { y: -26 }, geometry: square(8, 36, 10), areaKm2: 900000 },
    ];
    const index = { release: 'test', polities: [{ id: 'roman-republic', name: 'Roman Republic', wikidata: ['Q17167'], wikipedia: ['Roman Republic'], rows: [[-299, -199, 11, 40, 13, 42], [-199, -26, 8, 36, 18, 46]] }] };
    await page.route('**/data/borders/**', (route) => route.fulfill({ json: route.request().url().endsWith('index.json') ? index : { id: 'roman-republic', name: 'Roman Republic', snapshots: sets } }));
    await open(page);
    await openMap(page);
    await goToYear(page, '200 BCE');
    await page.getByRole('button', { name: 'Add a territory' }).click();
    const panel = page.getByTestId('territory-import');
    await panel.getByRole('button', { name: 'Show its polities' }).click();
    await panel.getByTestId('polities').getByRole('button', { name: 'Rome' }).click();
    await panel.getByRole('button', { name: /Look through 9 maps/ }).click();
    await panel.getByLabel('Name').fill('Roman Republic');
    await panel.getByRole('button', { name: 'Add to map' }).click();

    // Seshat's borders are shown first; keeping his own changes nothing.
    const view = page.getByTestId('territory-view');
    await view.getByRole('button', { name: 'Update borders from Seshat' }).click();
    const offer = view.getByTestId('seshat-update');
    await expect(offer).toContainText('Seshat has 2 sets of borders for Roman Republic, 300–27 BCE. They replace your 3 sets');
    await expect(offer.getByRole('listitem')).toHaveCount(2);
    await offer.getByRole('button', { name: 'Keep mine' }).click();
    await expect(view.getByRole('link', { name: /historical-basemaps/ })).toBeVisible();

    await view.getByRole('button', { name: 'Update borders from Seshat' }).click();
    await offer.getByRole('button', { name: 'Replace borders' }).click();
    await expect(view.getByRole('link', { name: /Cliopatria, Seshat Global History Databank/ })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Update borders from Seshat' })).toHaveCount(0);
    await expect(view.getByRole('listitem')).toHaveCount(2);
    await expect(page.locator('.maplibregl-ctrl-attrib a', { hasText: 'Cliopatria' })).toBeAttached();
  });

  test('reference borders say when they need a connection', async ({ page, context }) => {
    await open(page);
    await openMap(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Layers' }).click();
    await page.getByLabel('Show reference borders').check();
    await expect(page.getByRole('alert')).toContainText('You’re offline. Reference borders for');
  });
});

test.describe('trends from Our World in Data and the World Bank', () => {
  // The service worker caches trend data and the catalogue, which would hide them from page.route.
  test.use({ serviceWorkers: 'block' });

  test('import a trend for every country from Our World in Data and color the map with it', async ({ page }) => {
    await page.route('https://ourworldindata.org/grapher/**', (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'text/csv',
        body: ['Entity,Code,Year,Literacy rate', 'France,FRA,1820,38', 'France,FRA,1900,83', 'India,IND,1900,5', 'World,OWID_WRL,1820,12', 'World,OWID_WRL,1900,21'].join('\n'),
      }),
    );
    await open(page);
    await page.getByRole('button', { name: 'Add a trend' }).click();
    const editor = page.getByTestId('series-editor');
    await editor.getByLabel('Our World in Data chart link').fill('https://ourworldindata.org/grapher/literacy-rate');
    await editor.getByRole('button', { name: 'Fetch' }).click();
    await editor.getByLabel('Country or region').selectOption({ label: 'Every country (colors the map)' });
    await editor.getByRole('button', { name: 'Use data for 2 countries' }).click();
    await expect(editor.getByTestId('country-data')).toContainText('Values for 2 countries color the map.');
    await editor.getByLabel('Unit').fill('%');
    await editor.getByRole('button', { name: 'Add trend' }).click();
    await expect(page.locator('.strip', { hasText: 'Literacy rate' })).toBeVisible(); // the World curve

    await openMap(page);
    await goToYear(page, '1900');
    await page.getByRole('button', { name: 'Layers' }).click();
    await page.getByLabel('Color the map by').selectOption({ label: 'Literacy rate' });
    await expect(page.getByTestId('map-legend')).toContainText('2 countries with data in 1900');
  });

  test('find a trend by searching, then import the World Bank numbers for every country', async ({ page }) => {
    await page.route('**/data/trend-index.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          built: '2026-10-15',
          wbAggregates: ['WLD'],
          items: [
            { s: 'owid', id: 'gdp-per-capita', t: 'GDP per capita', from: 1, to: 2022 },
            { s: 'wb', id: 'SM.POP.TOTL', t: 'International migrant stock, total', d: 'People born in another country.', k: 'Social Development' },
          ],
        }),
      }),
    );
    await page.route('https://api.worldbank.org/v2/country/all/indicator/SM.POP.TOTL**', (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify([{ page: 1, pages: 1 }, [
          ...[['World', 'WLD', 1990, 152986157], ['World', 'WLD', 2020, 280598105], ['Germany', 'DEU', 1990, 5936181], ['Germany', 'DEU', 2020, 15762457], ['Mexico', 'MEX', 2020, 1197624]]
            .map(([name, code, year, value]) => ({ indicator: { id: 'SM.POP.TOTL', value: 'International migrant stock, total' }, country: { id: 'xx', value: name }, countryiso3code: code, date: String(year), value })),
        ]]),
      }),
    );
    await open(page);
    await page.getByRole('button', { name: 'Add a trend' }).click();
    const editor = page.getByTestId('series-editor');
    await editor.getByLabel('Search trends').fill('migrant');
    await editor.getByRole('button', { name: /International migrant stock, total/ }).click();
    await editor.getByLabel('Country or region').selectOption({ label: 'Every country (colors the map)' });
    await editor.getByRole('button', { name: 'Use data for 2 countries' }).click();
    await expect(editor.getByLabel('Name')).toHaveValue('International migrant stock, total');
    await expect(editor.getByLabel('Source', { exact: true })).toHaveValue('World Bank');
    await editor.getByRole('button', { name: 'Add trend' }).click();
    await expect(page.locator('.strip', { hasText: 'International migrant stock' })).toBeVisible();

    await openMap(page);
    await goToYear(page, '2020');
    await page.getByRole('button', { name: 'Layers' }).click();
    await page.getByLabel('Color the map by').selectOption({ label: 'International migrant stock, total' });
    await expect(page.getByTestId('map-legend')).toContainText('2 countries with data in 2020');
  });

  test('searching trends works offline; fetching numbers says it needs a connection', async ({ page, context }) => {
    await page.route('**/data/trend-index.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ built: '', wbAggregates: [], items: [{ s: 'owid', id: 'population', t: 'Population', from: -10000, to: 2023 }] }) }),
    );
    await open(page);
    await page.getByRole('button', { name: 'Add a trend' }).click();
    const editor = page.getByTestId('series-editor');
    await expect(editor.getByText('Loading the list of trends…')).toBeHidden();
    await context.setOffline(true);
    await editor.getByLabel('Search trends').fill('popul');
    await editor.getByRole('button', { name: /Population/ }).click();
    await expect(editor.getByRole('alert')).toContainText('You’re offline. Getting numbers from Our World in Data needs a connection.');
  });
});

// ---------- Drafting with AI ----------

test.describe('drafting with AI', () => {
  /** Replay a recorded drafting run: Anthropic answers in order, Wikipedia and Wikidata by URL. Nothing reaches the network. */
  async function replayRecording(page: Page, name: string) {
    const { readFileSync } = await import('node:fs');
    const { replayer } = await import('../tests/ai-evals/replay');
    const rec = JSON.parse(readFileSync(fileURLToPath(new URL(`../tests/ai-evals/entries/recordings/${name}.json`, import.meta.url)), 'utf8'));
    const next = replayer(rec);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const sent: unknown[] = [];
    for (const pattern of ['https://api.anthropic.com/**', 'https://en.wikipedia.org/**', 'https://www.wikidata.org/**']) {
      await page.route(pattern, (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (req.url().startsWith('https://api.anthropic.com/')) sent.push({ key: req.headers()['x-api-key'], body: req.postDataJSON() });
        const e = next(req.url());
        return e ? route.fulfill({ status: e.status ?? 200, headers: cors, json: e.body }) : route.fulfill({ status: 404, headers: cors, body: 'not recorded' });
      });
    }
    return sent;
  }

  test('draft entries, see them dashed on the map, accept one and reject another', async ({ page }) => {
    test.slow();
    const sent = await replayRecording(page, 'handmade-persian-wars');
    await open(page);
    await openMap(page);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Draft with AI…' }).click();
    const panel = page.getByTestId('draft-review');
    await expect(panel.getByRole('button', { name: 'Draft' })).toBeDisabled();
    await panel.getByLabel('Your Anthropic API key').fill('sk-ant-test-key-1234');
    await panel.getByRole('button', { name: 'Save key' }).click();
    await expect(panel.getByTestId('ai-key')).toContainText('sk-ant-…1234');
    await panel.getByLabel('What should Claude draft?').fill('The main battles of the Greco-Persian Wars');
    await panel.getByRole('button', { name: 'Draft' }).click();

    const entries = panel.getByTestId('draft-entry');
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(1)).toContainText('Battle of Marathon');
    await expect(entries.nth(1)).toContainText('490 BCE');
    await expect(panel.getByText('Left out by the checker (1)')).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ key: 'sk-ant-test-key-1234' });

    // Pending entries with places are dashed pins on the map, whatever the year.
    const draftPins = page.locator('.map-label.draft-pin');
    await expect(draftPins).toHaveCount(2);
    await expect(draftPins.filter({ hasText: 'Battle of Salamis' })).toBeVisible();

    await entries.nth(1).getByRole('button', { name: 'Accept' }).click();
    await expect(entries.nth(1)).toContainText('Added');
    await entries.nth(2).getByRole('button', { name: 'Reject' }).click();
    await expect(entries.nth(2)).toContainText('Left out');
    await expect(draftPins).toHaveCount(0);

    // The connection waits until both its ends are on the timeline.
    const marathonToWar = panel.getByTestId('draft-connection').first();
    await expect(marathonToWar).toContainText('Accept the entry first.');
    await expect(marathonToWar.getByRole('button', { name: 'Accept' })).toBeDisabled();

    await entries.nth(1).getByRole('button', { name: 'Open' }).click();
    await expect(page.getByTestId('item-drafted')).toContainText('Drafted with AI (claude-opus-5-5, entries@1)');
  });

  test('says clearly when offline', async ({ page, context }) => {
    await open(page);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Draft with AI…' }).click();
    await context.setOffline(true);
    await expect(page.getByTestId('draft-review').getByRole('alert')).toContainText('You’re offline. Drafting with AI needs a connection');
    await context.setOffline(false);
  });
});
