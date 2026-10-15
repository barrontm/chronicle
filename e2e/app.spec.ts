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
