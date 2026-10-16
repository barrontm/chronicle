import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));

/** Each test gets a fresh browser context, so IndexedDB starts empty. */
async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
}

async function importFixture(page: Page) {
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.locator('.vis-item', { hasText: 'Aristotle' })).toBeVisible();
}

async function addEntry(page: Page, kind: 'Event' | 'Period, war or movement' | 'Person', title: string, start: string, end?: string) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: kind }).click();
  const editor = page.getByTestId('item-editor');
  await editor.getByLabel(/Title|Name/).fill(title);
  await editor.getByLabel(/^(Date|From|Born)$/).fill(start);
  if (end) await editor.getByLabel(/^(To|Died)$/).fill(end);
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(page.getByTestId('item-view').getByRole('heading', { name: title })).toBeVisible();
}

test('a new timeline starts empty and invites the first entry @phone', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.locator('.vis-item')).toHaveCount(0);
});

test('add an event, reading BCE dates the way people write them', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add an event' }).click();
  const editor = page.getByTestId('item-editor');
  await editor.getByLabel('Title').fill('Battle of Marathon');
  await editor.getByLabel('Date').fill('490 BCE');
  await expect(editor.getByText('Reads as 490 BCE')).toBeVisible();
  await editor.getByLabel('Category').selectOption('war');
  await editor.getByLabel('Summary').fill('Athens defeats the first Persian invasion.');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();

  const view = page.getByTestId('item-view');
  await expect(view.getByRole('heading', { name: 'Battle of Marathon' })).toBeVisible();
  await expect(view.getByText('490 BCE')).toBeVisible();
  await expect(page.locator('.vis-item', { hasText: 'Battle of Marathon' })).toBeVisible();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
});

test('rejects dates it cannot read and ends before starts', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add a period' }).click();
  const editor = page.getByTestId('item-editor');
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
  await expect(page.locator('.vis-item', { hasText: 'Hypatia' })).toBeVisible();
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
  await expect(page.getByTestId('item-view').getByRole('button', { name: /Forms vs\. substances/ })).toBeVisible();

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
  await page.getByRole('button', { name: 'Back' }).click();
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
  await page.getByRole('button', { name: 'Add an event' }).click();
  const editor = page.getByTestId('item-editor');
  await editor.getByLabel('Title').fill('Rosetta Stone carved');
  await editor.getByLabel('Date').fill('196 BCE');
  await editor.getByRole('button', { name: 'Add a picture' }).click();
  await page.getByLabel('Search Wikimedia Commons').fill('Rosetta Stone');
  await page.getByRole('button', { name: 'Search' }).click();
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
  await expect(page.locator('.vis-item', { hasText: 'Aristotle' })).toHaveCount(1);
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
  await expect(page.locator('.vis-item', { hasText: 'Fall of Constantinople' })).toBeVisible();
  await context.setOffline(false);
});

/** Mock Wikipedia, Wikidata and Commons for "Add from Wikipedia". Every response needs CORS headers. */
async function mockWikipedia(page: Page) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const snak = (value: unknown) => ({ mainsnak: { snaktype: 'value', datavalue: { value } }, rank: 'normal' });
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (route) =>
    route.fulfill({ headers: cors, json: { pages: [
      { key: 'Ada_Lovelace', title: 'Ada Lovelace', description: 'English mathematician (1815–1852)', thumbnail: null },
      { key: 'Lovelace_(film)', title: 'Lovelace (film)', description: '2013 film', thumbnail: null },
    ] } }),
  );
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) =>
    route.fulfill({ headers: cors, json: {
      title: 'Ada Lovelace', description: 'English mathematician (1815–1852)', wikibase_item: 'Q7259',
      extract: 'Augusta Ada King, Countess of Lovelace, was an English mathematician and writer.',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
    } }),
  );
  await page.route('https://www.wikidata.org/w/api.php**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'wbgetclaims') {
      return route.fulfill({ headers: cors, json: { claims: { P625: [snak({ latitude: 51.507, longitude: -0.128 })] } } });
    }
    if (url.searchParams.get('props') === 'labels') {
      return route.fulfill({ headers: cors, json: { entities: { Q84: { labels: { en: { value: 'London' } } } } } });
    }
    return route.fulfill({ headers: cors, json: { entities: { Q7259: { claims: {
      P31: [snak({ id: 'Q5' })],
      P569: [snak({ time: '+1815-12-10T00:00:00Z', precision: 11 })],
      P570: [snak({ time: '+1852-11-27T00:00:00Z', precision: 11 })],
      P19: [snak({ id: 'Q84' })],
      P18: [snak('Ada Lovelace portrait.jpg')],
    } } } } });
  });
  await page.route('https://commons.wikimedia.org/w/api.php**', (route) =>
    route.fulfill({ headers: cors, json: { query: { pages: { '1': { title: 'File:Ada Lovelace portrait.jpg', imageinfo: [{
      url: 'https://upload.wikimedia.org/ada.jpg', thumburl: 'https://upload.wikimedia.org/ada-640.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ada_Lovelace_portrait.jpg', mime: 'image/jpeg',
      extmetadata: { Artist: { value: 'Alfred Edward Chalon' }, LicenseShortName: { value: 'Public domain' } },
    }] } } } } }),
  );
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }),
  );
}

async function addAdaFromWikipedia(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From Wikipedia…' }).click();
  const panel = page.getByTestId('wiki-import');
  await panel.getByLabel('Search Wikipedia').fill('Ada Lovelace');
  await panel.getByRole('button', { name: 'Search' }).click();
  await panel.getByTestId('wiki-results').getByRole('button', { name: /Ada Lovelace English mathematician/ }).click();
}

test('add a person from Wikipedia with dates, place, picture, quote and source @phone', async ({ page }) => {
  await mockWikipedia(page);
  await open(page);
  await addAdaFromWikipedia(page);

  const editor = page.getByTestId('item-editor');
  await expect(editor.getByRole('button', { name: 'Person' })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByLabel('Name')).toHaveValue('Ada Lovelace');
  await expect(editor.getByLabel('Born')).toHaveValue('1815-12-10');
  await expect(editor.getByLabel('Died')).toHaveValue('1852-11-27');
  await expect(editor.getByText('Born in London (51.51°N, 0.13°W)')).toBeVisible();
  await expect(editor.getByTestId('excerpt')).toContainText('Countess of Lovelace');
  await editor.getByLabel('Category').selectOption('science');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();

  const view = page.getByTestId('item-view');
  await expect(view.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
  await expect(view.getByText('English mathematician (1815–1852)')).toBeVisible();
  await expect(view.getByTestId('excerpt')).toContainText('Countess of Lovelace');
  await expect(view.getByTestId('excerpt').getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Ada_Lovelace');
  await expect(view.getByText(/Alfred Edward Chalon, Public domain/)).toBeVisible();
  await expect(view.getByRole('button', { name: 'Wikipedia contributors, Ada Lovelace' })).toBeVisible(); // the cited source
  await expect(page.locator('.vis-item', { hasText: 'Ada Lovelace' })).toBeVisible();
});

test('adding the same Wikipedia page twice opens the existing entry instead', async ({ page }) => {
  await mockWikipedia(page);
  await open(page);
  await addAdaFromWikipedia(page);
  await page.getByTestId('item-editor').getByRole('button', { name: 'Add to timeline' }).click();
  await expect(page.getByTestId('item-view')).toBeVisible();

  await addAdaFromWikipedia(page);
  const panel = page.getByTestId('wiki-import');
  await expect(panel.getByText('“Ada Lovelace” is already on your timeline.')).toBeVisible();
  await panel.getByRole('button', { name: 'Open it' }).click();
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
});

test('clicking a person lights up their influences on the timeline @phone', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await page.locator('.vis-item', { hasText: 'Plato' }).click();
  await expect(page.locator('.vis-item.infl-by', { hasText: 'Socrates' })).toBeVisible();
  await expect(page.locator('.vis-item.infl-on', { hasText: 'Aristotle' })).toBeVisible();
  await expect(page.locator('.vis-item.dimmed', { hasText: 'Confucius' })).toBeVisible();
  await expect(page.locator('.influence-arrows path.arc')).toHaveCount(2);
  await expect(page.locator('.influence-arrows path.arc.infl-by')).toHaveAttribute('data-from', 'i_socrates');

  // A person without influences changes nothing.
  await page.locator('.vis-item', { hasText: 'Confucius' }).click();
  await expect(page.locator('.vis-item.dimmed')).toHaveCount(0);
  await expect(page.locator('.influence-arrows path.arc')).toHaveCount(0);
});

test('zoomed far out, names run past bars too narrow for them, and go back in when zoomed in @phone', async ({ page }) => {
  await open(page);
  await importFixture(page);
  const plato = page.locator('.vis-item', { hasText: 'Plato' });
  const box = (await page.getByTestId('timeline').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 150);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  await expect(plato).toHaveClass(/label-out/);
  // The whole name is drawn, not clipped to the bar.
  const name = plato.locator('.it > span');
  expect((await name.boundingBox())!.width).toBeGreaterThan((await plato.boundingBox())!.width);
  // Names near the right edge are pulled left so the edge doesn't cut them off.
  const panel = (await page.locator('.vis-panel.vis-center').boundingBox())!;
  for (const who of ['Isaac Newton', 'Albert Einstein']) {
    const label = (await page.locator('.vis-item', { hasText: who }).locator('.it > span').boundingBox())!;
    expect(label.x + label.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  // Year labels on the axis never run into each other, even on a phone.
  const yearLabels = await page.locator('.vis-time-axis .vis-text.vis-minor:not(.vis-measure)').evaluateAll((els, edge) =>
    els.filter((e) => e.textContent?.trim()).map((e) => e.getBoundingClientRect())
      .filter((r) => r.right > edge.left && r.left < edge.right).map((r) => [r.left, r.right]).sort((x, y) => x[0] - y[0]),
  { left: panel.x, right: panel.x + panel.width });
  expect(yearLabels.length).toBeGreaterThan(1);
  for (let i = 1; i < yearLabels.length; i++) expect(yearLabels[i][0]).toBeGreaterThanOrEqual(yearLabels[i - 1][1] - 1);

  // Over the year axis the wheel only zooms; over the lanes a phone may scroll them instead.
  const at = (await plato.boundingBox())!;
  const axis = (await page.locator('.vis-time-axis').first().boundingBox())!;
  await page.mouse.move(at.x + 2, axis.y + axis.height / 2);
  // Zoom in until Plato's life is wider than his name (a phone zooms less per step).
  for (let i = 0; i < 60 && /label-out/.test((await plato.getAttribute('class')) ?? ''); i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50);
  }
  await expect(plato).not.toHaveClass(/label-out/);
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
  await page.locator('.vis-item', { hasText: 'Aristotle' }).click();
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

test('adding from Wikipedia says a connection is needed when offline', async ({ page, context }) => {
  await open(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From Wikipedia…' }).click();
  const panel = page.getByTestId('wiki-import');
  await panel.getByLabel('Search Wikipedia').fill('Ada Lovelace');
  await panel.getByRole('button', { name: 'Search' }).click();
  await expect(panel.getByRole('alert')).toHaveText(/You’re offline\. Adding from Wikipedia needs a connection/);
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
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Territory on the map…' }).click();
  await page.getByTestId('own-borders').getByRole('button', { name: 'How drawing works' }).click();
  await expect(page.getByTestId('help').getByRole('heading', { name: 'Draw your own' })).toBeInViewport();
});

// ---------- Carrying data into later versions ----------

const FIXTURE_V2 = fileURLToPath(new URL('../tests/fixtures/sample-history-v2.json', import.meta.url));

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
  await seedSavedDoc(page, JSON.parse(readFileSync(FIXTURE_V2, 'utf8')));
  await page.reload();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect(page.locator('.vis-item', { hasText: 'Aristotle' })).toBeVisible();
  await expect.poll(() => savedState(page)).toMatchObject({ schemaVersion: 3, backups: 1 });
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

async function openMap(page: Page, view: 'Map' | 'Both' = 'Map') {
  await page.getByRole('button', { name: view, exact: true }).click();
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
  await openMap(page, 'Both');
  await goToYear(page, '1914');
  await expect(page.locator('.vis-custom-time-marker')).toHaveText('1914');
  await page.getByRole('button', { name: 'Play through time' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId('yearbar').getByLabel('Year', { exact: true }).inputValue())).toBeGreaterThan(1914);
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('“Show on map” jumps to an entry’s year with the map open', async ({ page }) => {
  await open(page);
  await importFixture(page);
  await page.locator('.vis-item', { hasText: 'Magna Carta sealed' }).click();
  await page.getByTestId('item-view').getByRole('button', { name: 'Show on map' }).click();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId('yearbar').getByLabel('Year', { exact: true })).toHaveValue('1215');
  await expect(page.locator('.map-label.pin', { hasText: 'Magna Carta sealed' })).toBeVisible();
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

test('draw a city-state’s borders and date them @phone', async ({ page }) => {
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
  await page.reload();
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

  test('reference borders say when they need a connection', async ({ page, context }) => {
    await open(page);
    await openMap(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Layers' }).click();
    await page.getByLabel('Show reference borders').check();
    await expect(page.getByRole('alert')).toContainText('You’re offline. Reference borders for');
  });
});

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
