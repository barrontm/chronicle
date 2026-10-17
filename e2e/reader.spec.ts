import { expect, test, type Page } from '@playwright/test';

const cors = { 'Access-Control-Allow-Origin': '*' };

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
}

async function mockArticles(page: Page) {
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
      ? '<p>Pericles led Athens in the early years of the war. He died of the plague in 429 BC.</p>'
      : '<p>The war was fought between <a rel="mw:WikiLink" href="./Pericles" title="Pericles">Pericles</a>’ Athens and Sparta, ' +
        'and among the allies of the <a rel="mw:WikiLink" href="./Delian_League" title="Delian League">Delian League</a>.' +
        '<sup class="mw-ref reference"><a href="./Peloponnesian_War#cite_note-1"><span class="mw-reflink-text">[1]</span></a></sup></p>' +
        '<script>window.__x = 1</script>';
    return route.fulfill({ headers: { ...cors, 'Content-Type': 'text/html' }, body:
      `<!DOCTYPE html><html about="https://en.wikipedia.org/wiki/Special:Redirect/revision/42"><head><title>${title}</title>` +
      `<meta property="dc:modified" content="2026-10-01T12:00:00.000Z"/></head><body><section data-mw-section-id="0">${body}</section></body></html>` });
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
  await expect(page.getByRole('button', { name: 'Remove highlight' })).toBeVisible();

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
  await page.getByRole('button', { name: 'Remove highlight' }).click();
  await expect.poll(() => marks(page)).toEqual([]);

  // The page stays in the Library as a source.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByRole('tab', { name: 'Sources (1)' })).toBeVisible();
});
