import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const cors = { 'Access-Control-Allow-Origin': '*' };

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
}

/** Wikidata, answered from the recordings in tests/fixtures/subjects (`scripts/record-subjects.mjs`). */
async function mockWikidata(page: Page) {
  const dir = new URL('../tests/fixtures/subjects/', import.meta.url);
  const recs = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as
    { title: string; entity: unknown; parents: Record<string, string[]>; labels: Record<string, string> });
  const parents = Object.assign({}, ...recs.map((r) => r.parents)) as Record<string, string[]>;
  const labels = Object.assign({}, ...recs.map((r) => r.labels)) as Record<string, string>;
  await page.route('https://www.wikidata.org/w/api.php**', (route) => {
    const u = new URL(route.request().url());
    const title = u.searchParams.get('titles');
    if (title) {
      const r = recs.find((x) => x.title === title);
      return route.fulfill({ headers: cors, json: r ? r.entity : { entities: { '-1': { site: 'enwiki', title, missing: '' } } } });
    }
    const ids = (u.searchParams.get('ids') ?? '').split('|');
    // An entity's claims, for "Add to map and timeline".
    const rec = u.searchParams.get('props') === 'claims' && recs.find((r) => ids[0] in ((r.entity as { entities: object }).entities));
    if (rec) return route.fulfill({ headers: cors, json: rec.entity });
    if (u.searchParams.get('action') === 'wbgetclaims') return route.fulfill({ headers: cors, json: { claims: {} } });
    return route.fulfill({ headers: cors, json: { entities: Object.fromEntries(ids.map((q) => [q, { id: q, labels: labels[q] ? { en: { value: labels[q] } } : {} }])) } });
  });
  await page.route('https://query.wikidata.org/sparql**', (route) => {
    const ids = [...(new URL(route.request().url()).searchParams.get('query') ?? '').matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
    const entity = (q: string) => ({ value: `http://www.wikidata.org/entity/${q}` });
    return route.fulfill({ headers: cors, json: { results: { bindings: ids.flatMap((c) => (parents[c] ?? []).map((p) => ({ c: entity(c), p: entity(p) }))) } } });
  });
}

async function mockArticles(page: Page) {
  await mockWikidata(page);
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (route) =>
    route.fulfill({ headers: cors, json: { pages: [
      { key: 'Peloponnesian_War', title: 'Peloponnesian War', description: 'War between Athens and Sparta (431–404 BC)', thumbnail: null },
      { key: 'Pericles', title: 'Pericles', description: 'Athenian statesman', thumbnail: null },
    ] } }),
  );
  await page.route('https://en.wikipedia.org/w/rest.php/v1/page/*/html', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    const title = key.replace(/_/g, ' ');
    const body = key === 'Pericles'
      ? '<p>Pericles led Athens in the early years of the war. He died of the plague in 429 BC.</p>' +
        '<p>He took Athens into the <a rel="mw:WikiLink" href="./Peloponnesian_War" title="Peloponnesian War">Peloponnesian War</a> ' +
        'against <a rel="mw:WikiLink" href="./Sparta" title="Sparta">Sparta</a>.</p>'
      : '<p>The war was fought between <a rel="mw:WikiLink" href="./Pericles" title="Pericles">Pericles</a>’ Athens and Sparta, ' +
        'and among the allies of the <a rel="mw:WikiLink" href="./Delian_League" title="Delian League">Delian League</a>.' +
        '<sup class="mw-ref reference"><a href="./Peloponnesian_War#cite_note-1"><span class="mw-reflink-text">[1]</span></a></sup></p>' +
        '<script>window.__x = 1</script>';
    return route.fulfill({ headers: { ...cors, 'Content-Type': 'text/html' }, body:
      `<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/42"><head><title>${title}</title>` +
      `<meta property="dc:modified" content="2026-10-01T12:00:00.000Z"/></head><body><section data-mw-section-id="0">${body}</section></body></html>` });
  });
}

const QIDS: Record<string, string> = { Pericles: 'Q80398', Peloponnesian_War: 'Q33745', Sparta: 'Q5690' };

/** An entry as saved on this device. */
async function savedItem(page: Page, title: string) {
  return page.evaluate((t) => new Promise<unknown>((resolve) => {
    const req = indexedDB.open('chronicle');
    req.onsuccess = () => {
      const tx = req.result.transaction(['docs', 'meta']);
      const id = tx.objectStore('meta').get('activeDocId');
      id.onsuccess = () => {
        const doc = tx.objectStore('docs').get(id.result);
        doc.onsuccess = () => { req.result.close(); resolve(doc.result?.items.find((i: { title: string }) => i.title === t)); };
      };
    };
  }), title);
}

/** The page summaries "Add to map and timeline" starts from. */
async function mockSummaries(page: Page) {
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
    return route.fulfill({ headers: cors, json: {
      title: key.replace(/_/g, ' '), wikibase_item: QIDS[key],
      extract: `${key.replace(/_/g, ' ')} is in the Greek past.`, content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${key}` } },
    } });
  });
}

async function search(page: Page, q: string, pick: string) {
  const form = page.getByTestId('article-search');
  await form.getByLabel('Search Wikipedia').fill(q);
  await form.getByRole('button', { name: 'Search' }).click();
  await page.getByTestId('article-results').getByRole('button', { name: new RegExp(pick) }).click();
}

test('the new layout reads articles, follows links, keeps a trail and rereads offline @phone', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  await mockArticles(page);
  await open(page);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);

  const reader = page.getByTestId('reader');
  await expect(reader.getByRole('heading', { name: 'Open an article' })).toBeVisible();
  await search(page, 'peloponnesian', 'Peloponnesian War');
  await expect(reader.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  await expect(reader.getByText('The war was fought between')).toBeVisible();
  await expect(reader.getByTestId('article')).toHaveAttribute('data-revision', '42');
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();

  // A link in the text opens in the reader; Back returns.
  await reader.getByRole('link', { name: 'Pericles' }).click();
  await expect(reader.getByRole('heading', { name: 'Pericles' })).toBeVisible();
  await reader.getByRole('button', { name: 'Back' }).click();
  await expect(reader.getByText('The war was fought between')).toBeVisible();

  await page.getByRole('button', { name: 'Open an article' }).click();
  await search(page, 'pericles', 'Pericles');
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();

  const trail = page.getByRole('navigation', { name: 'Reading trail' });
  await trail.getByRole('button', { name: 'Peloponnesian War' }).click();
  await expect(reader.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();

  if (phone) {
    await reader.getByRole('button', { name: 'Map' }).click();
    await expect(page.getByTestId('map')).toBeVisible();
    await page.getByRole('button', { name: 'Back to reading' }).click();
    await expect(reader.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  } else {
    await expect(page.getByTestId('map')).toBeVisible();
    await expect(reader).toBeVisible();
  }

  // Offline: articles read before still open; new ones say they need a connection.
  await page.context().setOffline(true);
  await trail.getByRole('button', { name: 'Pericles' }).click();
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();
  await trail.getByRole('button', { name: 'Peloponnesian War' }).click();
  await reader.getByRole('link', { name: 'Delian League' }).click();
  await expect(reader.getByRole('alert')).toContainText('isn’t saved on this device yet');
  await page.context().setOffline(false);

  // The choice and the open article survive a reload; turning it off restores the old layout.
  await trail.getByRole('button', { name: 'Peloponnesian War' }).click();
  await page.reload();
  await expect(reader.getByText('The war was fought between')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await expect(page.getByTestId('reader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
});

/** Where `text` is on screen, and (with `select`) select it. */
const findText = (page: Page, text: string, select = false) => page.evaluate(([t, sel]) => {
  const w = document.createTreeWalker(document.querySelector('.reader-text')!, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const i = n.data.indexOf(t);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + t.length);
    if (sel) { getSelection()!.removeAllRanges(); getSelection()!.addRange(r); }
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  throw new Error(`no "${t}" in the article`);
}, [text, select] as const);

/** The marked text, by mark name, from the CSS Custom Highlight API. */
const marks = (page: Page) => page.evaluate(() =>
  [...(CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights].flatMap(([name, h]) => [...h].map((r) => `${name}: ${r.toString()}`)));

test('highlights a passage, keeps it after a reload, and removes it @phone', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  await mockArticles(page);
  await open(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'pericles', 'Pericles');
  const reader = page.getByTestId('reader');
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();

  if (phone) {
    // A tap highlights the whole sentence.
    const at = await findText(page, 'plague');
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => marks(page)).toEqual(['chronicle-mark-umber-open: He died of the plague in 429 BC.']);
  } else {
    await findText(page, 'led Athens', true);
    await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
    await page.keyboard.press('h');
    await expect.poll(() => marks(page)).toEqual(['chronicle-mark-umber-open: led Athens']);
  }
  const quote = phone ? 'He died of the plague in 429 BC.' : 'led Athens';
  await expect(page.getByRole('status').filter({ hasText: 'Highlighted' })).toHaveText(`Highlighted: ${quote}`);
  await expect(page.getByTestId('capture-tray').getByRole('button', { name: 'Remove' })).toBeVisible();

  // Saved the moment it was made: after a reload it's still marked, as a kept highlight.
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.reload();
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();
  await expect.poll(() => marks(page)).toEqual([`chronicle-mark-umber-kept: ${quote}`]);
  await expect(page.getByRole('region', { name: 'Your highlights in this article' })).toContainText(quote);

  // Clicking the mark opens it again; Remove takes it away.
  const at = await findText(page, phone ? 'plague' : 'Athens');
  if (phone) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await page.getByTestId('capture-tray').getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => marks(page)).toEqual([]);

  // The page stays in the Library as a source.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByRole('tab', { name: 'Sources (1)' })).toBeVisible();
});

test.describe('the infobox', () => {
  // The service worker serves Commons pictures itself, out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('starts folded, so the text starts near the top, and opens to its rows @phone', async ({ page }, info) => {
    const phone = info.project.name.includes('phone');
    await mockArticles(page);
    const rows = ['Born', 'Died', 'Office', 'Partner', 'Children', 'Parents', 'Allegiance', 'Rank', 'Battles', 'Known for', 'Era', 'Tribe']
      .map((k, i) => `<tr><th scope="row" class="infobox-label">${k}</th><td class="infobox-data">${k} detail ${i + 1}, set out at some length</td></tr>`).join('');
    await page.route('https://en.wikipedia.org/w/rest.php/v1/page/Pericles/html', (route) => route.fulfill({
      headers: { ...cors, 'Content-Type': 'text/html' },
      body: '<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/42"><head><title>Pericles</title></head><body>' +
        '<section data-mw-section-id="0"><table class="infobox vcard"><tbody><tr><th colspan="2" class="infobox-above">Pericles</th></tr>' +
        '<tr><td colspan="2" class="infobox-image"><span typeof="mw:File"><a href="./File:Pericles.jpg" class="mw-file-description">' +
        '<img src="//upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Pericles.jpg/250px-Pericles.jpg" width="250" height="379"/></a></span>' +
        '<div class="infobox-caption">Bust of Pericles, a Roman copy</div></td></tr>' + rows + '</tbody></table>' +
        '<p>Pericles led Athens in the early years of the war. He died of the plague in 429 BC.</p></section></body></html>',
    }));
    await page.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ headers: cors, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));
    await open(page);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
    await search(page, 'pericles', 'Pericles');

    // Folded: one line, and the first paragraph is in view.
    const reader = page.getByTestId('reader');
    const head = reader.getByRole('button', { name: /Infobox/ });
    await expect(head).toHaveText(/Infobox · picture and 12 rows\s*Show/);
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(reader.getByText('Born detail 1')).toBeHidden();
    await expect(reader.getByText('Pericles led Athens')).toBeInViewport();

    // Open, its rows show, and the choice is remembered on this device.
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(head).toContainText('Hide');
    await expect(reader.getByText('Tribe detail 12, set out at some length')).toBeVisible();
    await expect(reader.getByText('Bust of Pericles, a Roman copy')).toBeVisible();
    await page.reload();
    await expect(reader.getByRole('button', { name: /Infobox/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(reader.getByText('Born detail 1')).toBeVisible();

    // A row can be highlighted, and the header isn't part of the article's text.
    await findText(page, 'Office detail 3', true);
    if (phone) await page.getByRole('button', { name: 'Highlight' }).click();
    else {
      await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
      await page.keyboard.press('h');
    }
    await expect.poll(() => marks(page)).toEqual(['chronicle-mark-umber-open: Office detail 3']);
    await expect(page.getByTestId('capture-tray')).toContainText('Office detail 3');
  });
});

test('the reader says what an article is about, and when it is already in Chronicle @phone', async ({ page }) => {
  await mockArticles(page);
  await open(page);
  // A timeline that already has Pericles, matched by his Wikidata id.
  const doc = JSON.parse(readFileSync(new URL('../tests/fixtures/sample-history.json', import.meta.url), 'utf8'));
  const socrates = doc.items.find((i: { title: string }) => i.title === 'Socrates');
  doc.items.push({ ...socrates, id: 'pericles', title: 'Pericles', wikidataId: 'Q80398', start: { y: -493 }, end: { y: -428 } });
  await page.getByTestId('import-input').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('.vis-item', { hasText: 'Pericles' })).toBeVisible();

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  const reader = page.getByTestId('reader');
  await search(page, 'peloponnesian', 'Peloponnesian War');
  const subject = reader.getByTestId('article-subject');
  await expect(subject).toHaveText('War · 431 BCE – 25 Apr 404 BCE · part of Peloponnesian Wars');
  await expect(subject).toHaveAttribute('data-kind', 'war');

  await reader.getByRole('link', { name: 'Pericles' }).click();
  await expect(subject).toHaveText('Person · 494–429 BCE · Already in Chronicle');

  // Known on this device, so it still shows offline.
  await page.context().setOffline(true);
  await reader.getByRole('button', { name: 'Back' }).click();
  await expect(subject).toHaveText('War · 431 BCE – 25 Apr 404 BCE · part of Peloponnesian Wars');
  await page.context().setOffline(false);
  await page.getByRole('navigation', { name: 'Reading trail' }).getByRole('button', { name: 'Pericles' }).click();

  await subject.getByRole('button', { name: 'Already in Chronicle' }).click();
  await expect(page.getByTestId('item-view')).toContainText('Pericles');
});

test('what an older version read from Wikidata is looked up again', async ({ page }) => {
  await mockArticles(page);
  await open(page);
  // Cached by an older version (no `v`), and read wrongly: Pericles as an event.
  await page.evaluate(() => new Promise<void>((done, fail) => {
    const req = indexedDB.open('chronicle-articles', 2);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('articles', { keyPath: 'key' });
      req.result.createObjectStore('subjects', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('subjects', 'readwrite');
      tx.objectStore('subjects').put({ key: 'Pericles', fetchedAt: 1, subject: { qid: 'Q80398', kind: 'event', facts: { start: { y: -999 }, partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] }, labels: {} } });
      tx.oncomplete = () => { req.result.close(); done(); };
      tx.onerror = () => fail(tx.error);
    };
    req.onerror = () => fail(req.error);
  }));
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'pericles', 'Pericles');
  await expect(page.getByTestId('reader').getByTestId('article-subject')).toHaveText('Person · 494–429 BCE');
});

test('the capture tray keeps a highlight, gives it a dimension, and adds the article to the timeline @phone', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  await mockArticles(page);
  await mockSummaries(page);
  await open(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'pericles', 'Pericles');
  const reader = page.getByTestId('reader');
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();

  const highlight = async () => {
    if (phone) {
      const at = await findText(page, 'plague');
      await page.touchscreen.tap(at.x, at.y);
    } else {
      await findText(page, 'died of the plague', true);
      await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
      await page.keyboard.press('h');
    }
  };
  const quote = phone ? 'He died of the plague in 429 BC.' : 'died of the plague';
  await highlight();

  // The tray says what the article is, with its facts.
  const tray = page.getByTestId('capture-tray');
  await expect(tray.getByRole('blockquote')).toHaveText(`“${quote}”`);
  await expect(tray).toContainText('Becomes · the article’s subject');
  await expect(tray.getByRole('radio', { name: /Pericles/ })).toContainText('This article · Person');
  await expect(tray).toContainText('494–429 BCE');

  // A dimension recolors the mark; keeping it closes the card and leaves a kept mark.
  await tray.getByRole('button', { name: 'Political' }).click();
  await expect(tray.getByRole('button', { name: 'Political' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => marks(page)).toEqual([`chronicle-mark-lapis-open: ${quote}`]);
  await tray.getByRole('button', { name: 'Just keep the highlight' }).click();
  await expect(tray.getByRole('status')).toHaveText('Kept as a highlight.');
  await expect.poll(() => marks(page)).toEqual([`chronicle-mark-lapis-kept: ${quote}`]);

  // Opening it again offers to add the article's subject, citing the highlight.
  const at = await findText(page, 'plague');
  if (phone) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await tray.getByRole('button', { name: 'Add to map and timeline' }).click();
  const editor = page.getByTestId('item-editor');
  await expect(editor.getByLabel('Name')).toHaveValue('Pericles');
  await expect(editor.getByLabel('Kind of thing')).toHaveValue('person');
  await expect(editor.getByTestId('excerpt')).toContainText(quote);
  await editor.getByRole('button', { name: 'Add to timeline' }).click();

  const entry = page.getByTestId('item-view');
  await expect(entry.getByRole('heading', { name: 'Pericles' })).toBeVisible();
  // Saved as what it is, so the new timeline can draw it as a person.
  await expect.poll(() => savedItem(page, 'Pericles')).toMatchObject({ subject: 'person' });
  await expect(entry.getByTestId('excerpt')).toContainText(quote);
  await expect(entry.getByTestId('excerpt')).toContainText('Political');
  // The card now says it's on the entry; closing it leaves an added mark.
  if (phone) await page.getByRole('button', { name: 'Close panel' }).click(); // the entry's sheet covers the reader
  await expect(tray.getByRole('radio', { name: /Pericles/ })).toContainText('Linked');
  await tray.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => marks(page)).toEqual([`chronicle-mark-lapis-added: ${quote}`]);
  await expect(tray.getByRole('status')).toHaveText('1 highlight in this article · 1 on your map and timeline');

  // One source for the page, cited by the entry; the Library lists the highlight under it.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByRole('tab', { name: 'Sources (1)' })).toBeVisible();
  await page.getByRole('tab', { name: /Highlights/ }).click();
  const group = page.getByTestId('highlight-group');
  await expect(group.getByRole('heading')).toHaveText('Pericles');
  await expect(group).toContainText('Political · on Pericles');
});

test('a highlight becomes a page its passage links: pick the war, add it, and see the highlight on it @phone', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  await mockArticles(page);
  await mockSummaries(page);
  await open(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'pericles', 'Pericles');
  const reader = page.getByTestId('reader');
  await expect(reader.getByRole('link', { name: 'Peloponnesian War' })).toBeVisible();

  const quote = 'He took Athens into the Peloponnesian War against Sparta.';
  const highlight = async () => {
    const at = await findText(page, 'took Athens');
    if (phone) { await page.touchscreen.tap(at.x, at.y); return; }
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.reader-text p')].find((x) => x.textContent!.includes('took Athens'))!;
      const r = document.createRange();
      r.selectNodeContents(p);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
    await page.keyboard.press('h');
  };
  await highlight();

  // The article's subject first, then the pages the passage links; the war is chosen first.
  const tray = page.getByTestId('capture-tray');
  await expect(tray.getByRole('blockquote')).toHaveText(`“${quote}”`);
  await expect(tray).toContainText('Becomes · 3 in this passage, pick one');
  const radios = tray.getByRole('radio');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toContainText('PericlesThis article · Person');
  await expect(radios.nth(1)).toContainText('Peloponnesian WarWar');
  await expect(radios.nth(2)).toContainText('SpartaPolity');
  const war = tray.getByRole('radio', { name: /Peloponnesian War/ });
  await expect(war).toHaveAttribute('aria-checked', 'true');
  await expect(tray).toContainText('431 BCE – 25 Apr 404 BCE');

  // Sparta is a polity: it can't be added from here, and the card says why.
  await tray.getByRole('radio', { name: /Sparta/ }).click();
  await expect(tray).toContainText('Polities come from the territory tools');
  await expect(tray.getByRole('button', { name: 'Add to map and timeline' })).toHaveCount(0);

  // Back to the war: it's added, quoting the highlight and citing the article Bob read.
  await war.click();
  await tray.getByRole('button', { name: 'Add to map and timeline' }).click();
  const editor = page.getByTestId('item-editor');
  await expect(editor.getByLabel('Title')).toHaveValue('Peloponnesian War');
  await expect(editor.getByTestId('excerpt')).toContainText(quote);
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  const entry = page.getByTestId('item-view');
  await expect(entry.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  await expect(entry.getByTestId('excerpt')).toContainText(quote);
  if (phone) await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(war).toContainText('Linked');
  await tray.getByRole('button', { name: 'Done' }).click();

  // Offline after a reload, the candidates still say what they are, and the war keeps the highlight.
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.reload();
  await expect(reader.getByText('Pericles led Athens')).toBeVisible();
  await page.context().setOffline(true);
  const at = await findText(page, 'took Athens');
  if (phone) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect(tray.getByRole('radio', { name: /Sparta/ })).toContainText('Polity');
  await expect(war).toHaveAttribute('aria-checked', 'true');
  await expect(war).toContainText('Linked');
  await page.context().setOffline(false);

  // The Library lists it on the war.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: /Highlights/ }).click();
  await expect(page.getByTestId('highlight-group')).toContainText('on Peloponnesian War');
});

test('Claude drafts from the tribute passage: a suggested dimension, an event on the map and a "funded" connection, accepted from the tray', async ({ page }) => {
  test.slow();
  const tribute = 'It was from the alliance\'s treasury that Pericles drew the funds necessary to enable his ambitious building plan, centred on the "Periclean Acropolis", which included the Propylaea, the Parthenon and the golden statue of Athena, sculpted by Pericles\'s friend, Phidias. In 449 BC Pericles proposed a decree allowing the use of 9,000 talents to finance the major rebuilding programme of Athenian temples.';
  await mockArticles(page);
  await page.route('https://en.wikipedia.org/w/rest.php/v1/page/Pericles/html', (route) => route.fulfill({
    headers: { ...cors, 'Content-Type': 'text/html' },
    body: '<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/42"><head><title>Pericles</title></head><body>' +
      '<section data-mw-section-id="0"><p>Pericles led Athens in its golden age.</p></section>' +
      `<section data-mw-section-id="1"><h2 id="rule">Athens's rule over its alliance</h2><p>In 454 BC the treasury of the Delian League was moved from Delos to Athens.</p><p>${tribute}</p></section></body></html>`,
  }));
  // Claude's answer and the place lookup, replayed from a recording (tests/ai-evals/highlight/recordings).
  const { replayer } = await import('../tests/ai-evals/replay');
  const next = replayer(JSON.parse(readFileSync(new URL('../tests/ai-evals/highlight/recordings/handmade-tribute.json', import.meta.url), 'utf8')));
  const ai = { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const asked: string[] = [];
  for (const pattern of ['https://api.anthropic.com/**', 'https://en.wikipedia.org/w/api.php**']) {
    await page.route(pattern, (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: ai });
      if (req.url().startsWith('https://api.anthropic.com/')) asked.push(req.headers()['x-api-key']);
      const e = next(req.url());
      return e ? route.fulfill({ status: e.status ?? 200, headers: ai, json: e.body }) : route.fulfill({ status: 404, headers: ai, body: 'not recorded' });
    });
  }
  await open(page);
  // Bob's timeline already has Pericles and the Delian League.
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/ai-evals/highlight/doc.json', import.meta.url)));
  await expect(page.locator('.vis-item', { hasText: 'Delian League' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'pericles', 'Pericles');
  await expect(page.getByTestId('reader').getByText('In 449 BC Pericles')).toBeVisible();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeVisible();

  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.reader-text p')].find((x) => x.textContent!.includes('449 BC'))!;
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
  await page.keyboard.press('h');
  const tray = page.getByTestId('capture-tray');
  await expect(tray.getByRole('blockquote')).toContainText('from the alliance');

  // No key yet: the tray says where to add one.
  const askButton = tray.getByRole('button', { name: 'Ask Claude' });
  await expect(askButton).toBeDisabled();
  await tray.getByRole('button', { name: 'Drafting with AI' }).click();
  const panel = page.getByTestId('draft-review');
  await panel.getByLabel('Your Anthropic API key').fill('sk-ant-test-key-1234');
  await panel.getByRole('button', { name: 'Save key' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await askButton.click();

  // Claude suggests a dimension; it's marked, not taken.
  await expect(tray).toContainText('Claude suggests Economic · pick it to use it');
  await expect(tray.getByRole('button', { name: 'Economic, suggested by Claude' })).toHaveAttribute('aria-pressed', 'false');
  expect(asked).toEqual(['sk-ant-test-key-1234']);

  // The drafted event waits, dashed on the map; its connection waits for it.
  const entry = tray.getByTestId('draft-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('Decree funding the rebuilding of Athenian temples');
  await expect(entry).toContainText('Event · 449 BCE · Acropolis of Athens');
  await expect(entry).toContainText('In 449 BC Pericles proposed a decree');
  await expect(page.locator('.map-label.draft-pin', { hasText: 'Decree funding' })).toBeVisible();
  const funded = tray.getByTestId('draft-connection');
  await expect(funded).toHaveCount(1);
  await expect(funded).toContainText('Delian League funded Decree funding the rebuilding of Athenian temples');
  await expect(funded).toContainText('Accept the entry first.');
  await expect(funded.getByRole('button', { name: 'Accept' })).toBeDisabled();
  // On the timeline too: the event as a dashed ghost, and the connection as a dashed arrow with its effect.
  const timeline = page.getByTestId('timeline');
  await expect(timeline.locator('.tl-draft')).toHaveCount(1);
  await expect(timeline.locator('path.arc.draft')).toHaveCount(1);
  await expect(timeline.locator('.tl-arc-label')).toHaveText('funded ?');

  // Library says the highlight has drafts waiting.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: /Highlights/ }).click();
  await expect(page.getByTestId('highlight-group')).toContainText('kept as a highlight · 2 drafts from Claude waiting');
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Picking the suggestion, then accepting both: the event is on the map in its year, solid.
  await tray.getByRole('button', { name: 'Economic, suggested by Claude' }).click();
  await expect(tray).toContainText('Economic · Claude’s suggestion');
  await entry.getByRole('button', { name: 'Accept' }).click();
  await expect(entry).toContainText('Added · on the map and timeline');
  await expect(page.locator('.map-label.draft-pin')).toHaveCount(0);
  await expect(page.locator('.map-label.pin', { hasText: 'Decree funding' })).toBeVisible();
  await funded.getByRole('button', { name: 'Accept' }).click();
  await expect(funded).toContainText('Added');
  await expect(tray.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(timeline.locator('.tl-draft, path.arc.draft')).toHaveCount(0);

  // Both records are under the highlight in Library, and nothing is waiting.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: /Highlights/ }).click();
  const group = page.getByTestId('highlight-group');
  await expect(group).toContainText('Economic · on Decree funding the rebuilding of Athenian temples, Delian League funded Decree funding the rebuilding of Athenian temples');
  await expect(group).not.toContainText('waiting');
});

test('adding a battle connects it to the war already in Chronicle, with the highlight as evidence @phone', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  await mockArticles(page);
  QIDS.Battle_of_Salamis = 'Q178850';
  await mockSummaries(page);
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (route) =>
    route.fulfill({ headers: cors, json: { pages: [{ key: 'Battle_of_Salamis', title: 'Battle of Salamis', description: 'Naval battle in 480 BC', thumbnail: null }] } }));
  await page.route('https://en.wikipedia.org/w/rest.php/v1/page/Battle_of_Salamis/html', (route) => route.fulfill({
    headers: { ...cors, 'Content-Type': 'text/html' },
    body: '<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/7"><head><title>Battle of Salamis</title></head><body>' +
      '<section data-mw-section-id="0"><p>The Greek fleet met the Persians in the straits. The battle turned the war in 480 BC.</p></section></body></html>',
  }));
  await open(page);
  // A timeline that already has the Persian invasion, matched by its Wikidata id.
  const doc = JSON.parse(readFileSync(new URL('../tests/fixtures/sample-history.json', import.meta.url), 'utf8'));
  const any = doc.items[0];
  doc.items.push({ ...any, id: 'invasion', kind: 'span', title: 'Second Persian invasion of Greece', wikidataId: 'Q1122337', start: { y: -479 }, end: { y: -478 }, places: undefined });
  await page.getByTestId('import-input').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('.vis-item', { hasText: 'Second Persian invasion' })).toBeVisible();

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await search(page, 'salamis', 'Battle of Salamis');
  await expect(page.getByTestId('reader').getByText('The battle turned the war')).toBeVisible();
  const quote = phone ? 'The battle turned the war in 480 BC.' : 'turned the war';
  if (phone) {
    const at = await findText(page, 'turned the war');
    await page.touchscreen.tap(at.x, at.y);
  } else {
    await findText(page, 'turned the war', true);
    await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
    await page.keyboard.press('h');
  }
  const tray = page.getByTestId('capture-tray');
  await expect(tray.getByRole('blockquote')).toHaveText(`“${quote}”`);
  await expect(tray.getByRole('radio', { name: /Battle of Salamis/ })).toContainText('This article · Battle');
  // Not in Chronicle yet: a dashed ghost on the map where it was fought.
  if (!phone) await expect(page.locator('.map-label.draft-pin', { hasText: 'Battle of Salamis' })).toBeVisible();
  await tray.getByRole('button', { name: 'Add to map and timeline' }).click();

  // The editor suggests "part of" the invasion, ticked, citing the highlight.
  const editor = page.getByTestId('item-editor');
  await expect(editor.getByLabel('Title')).toHaveValue('Battle of Salamis');
  const suggested = editor.getByTestId('suggested-connections');
  await expect(suggested.getByRole('checkbox', { name: 'Part of Second Persian invasion of Greece' })).toBeChecked();
  await expect(suggested).toContainText('your highlight as evidence');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();

  // Saved with the entry: the connection shows on both panels, with the highlight as its evidence.
  const entry = page.getByTestId('item-view');
  await expect(entry.getByRole('heading', { name: 'Battle of Salamis' })).toBeVisible();
  const link = entry.getByRole('button', { name: /Part of\s*Second Persian invasion of Greece/ });
  await expect(link.getByTestId('evidence')).toHaveText(`Evidence: “${quote}”`);
  await link.click();
  await expect(entry.getByRole('heading', { name: 'Second Persian invasion of Greece' })).toBeVisible();
  await expect(entry.getByTestId('evidence')).toHaveText(`Evidence: “${quote}”`);
});

test('a place and a battle draw as what they are: Athens on its ground line with a pin, Salamis a tick on the war’s bar', async ({ page }) => {
  test.slow();
  await mockArticles(page);
  Object.assign(QIDS, { Battle_of_Salamis: 'Q178850', Athens: 'Q1524' });
  await mockSummaries(page);
  const PAGES: Record<string, { description: string; text: string }> = {
    Athens: { description: 'Capital of Greece', text: 'Athens was the leading city of the Delian League. Its harbour at Piraeus held the fleet.' },
    Battle_of_Salamis: { description: 'Naval battle in 480 BC', text: 'The Greek fleet met the Persians in the straits. The battle turned the war in 480 BC.' },
  };
  await page.route('https://en.wikipedia.org/w/rest.php/v1/search/page**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const key = /salamis/i.test(q) ? 'Battle_of_Salamis' : 'Athens';
    return route.fulfill({ headers: cors, json: { pages: [{ key, title: key.replace(/_/g, ' '), description: PAGES[key].description, thumbnail: null }] } });
  });
  for (const [key, p] of Object.entries(PAGES)) {
    await page.route(`https://en.wikipedia.org/w/rest.php/v1/page/${key}/html`, (route) => route.fulfill({
      headers: { ...cors, 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/7"><head><title>${key.replace(/_/g, ' ')}</title></head><body>` +
        `<section data-mw-section-id="0"><p>${p.text}</p></section></body></html>`,
    }));
  }
  await open(page);
  // A timeline that already has the Persian invasion, as a war.
  const doc = JSON.parse(readFileSync(new URL('../tests/fixtures/sample-history.json', import.meta.url), 'utf8'));
  doc.items.push({ ...doc.items[0], id: 'invasion', kind: 'span', subject: 'war', title: 'Second Persian invasion of Greece', wikidataId: 'Q1122337', start: { y: -479 }, end: { y: -478 }, places: undefined });
  await page.getByTestId('import-input').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();

  const tray = page.getByTestId('capture-tray');
  const editor = page.getByTestId('item-editor');
  const entry = page.getByTestId('item-view');
  const highlightAndAdd = async (q: string, title: string, words: string, kind: string) => {
    await search(page, q, title);
    await expect(page.getByTestId('reader').getByText(words)).toBeVisible();
    await findText(page, words, true);
    await expect(page.getByRole('button', { name: 'Highlight' })).toBeVisible();
    await page.keyboard.press('h');
    await expect(tray.getByRole('radio', { name: new RegExp(title) })).toContainText(`This article · ${kind}`);
    await tray.getByRole('button', { name: 'Add to map and timeline' }).click();
    await expect(editor.getByLabel('Title')).toHaveValue(title);
  };

  // A place can be added now: Wikidata's founding date is kept, and it has no end, as it's still there.
  await highlightAndAdd('athens', 'Athens', 'leading city', 'Place');
  await expect(editor.getByLabel('Kind of thing')).toHaveValue('place');
  await expect(editor.getByLabel('Founded')).not.toHaveValue('');
  await expect(editor.getByLabel('Abandoned')).toHaveValue('');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(entry.getByRole('heading', { name: 'Athens' })).toBeVisible();
  await expect(entry).toContainText('Founded');
  await expect.poll(() => savedItem(page, 'Athens')).toMatchObject({ subject: 'place', places: [expect.objectContaining({ role: 'site' })] });
  const athens = (await savedItem(page, 'Athens')) as { id: string };
  await entry.getByRole('button', { name: 'Show its time' }).click();
  const svg = page.locator('.tl-svg');
  await expect(svg.locator(`use[data-id="${athens.id}"]`)).toHaveAttribute('href', /-g-place$/);
  await expect(page.locator('.map-label.pin', { hasText: 'Athens' })).toBeVisible();

  // The battle is part of the war already in Chronicle, so it's a tick on the war's bar.
  await page.getByRole('button', { name: 'Open an article' }).click();
  await highlightAndAdd('salamis', 'Battle of Salamis', 'turned the war', 'Battle');
  await expect(editor.getByTestId('suggested-connections').getByRole('checkbox', { name: 'Part of Second Persian invasion of Greece' })).toBeChecked();
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(entry.getByRole('heading', { name: 'Battle of Salamis' })).toBeVisible();
  await expect.poll(() => savedItem(page, 'Battle of Salamis')).toBeDefined();
  const salamis = (await savedItem(page, 'Battle of Salamis')) as { id: string };
  await entry.getByRole('button', { name: 'Show its time' }).click();
  // A line has no width, so Playwright calls it hidden: it is drawn when it is in the scene.
  await expect(svg.locator(`line.tl-tick-mark[data-id="${salamis.id}"]`)).toBeAttached();
  await expect(svg.locator(`circle[data-id="${salamis.id}"]`)).toHaveCount(0);
  await expect(svg.locator('rect[data-id="invasion"]')).toBeVisible();
});
