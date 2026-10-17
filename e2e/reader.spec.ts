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
      ? '<p>Pericles led Athens in the early years of the war.</p>'
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
