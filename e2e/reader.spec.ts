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
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const title = key.replace(/_/g, ' ');
    return route.fulfill({ headers: cors, json: {
      title, description: key === 'Pericles' ? 'Athenian statesman' : 'War between Athens and Sparta (431–404 BC)',
      extract: `${title} is the subject of this article.`,
      content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${key}` } },
    } });
  });
}

async function search(page: Page, q: string, pick: string) {
  const form = page.getByTestId('article-search');
  await form.getByLabel('Search Wikipedia').fill(q);
  await form.getByRole('button', { name: 'Search' }).click();
  await page.getByTestId('article-results').getByRole('button', { name: new RegExp(pick) }).click();
}

test('the new layout opens articles in the reader and keeps a reading trail @phone', async ({ page }, info) => {
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
  await expect(reader.getByText('Peloponnesian War is the subject of this article.')).toBeVisible();

  await page.getByRole('button', { name: 'Open an article' }).click();
  await search(page, 'pericles', 'Pericles');
  await expect(reader.getByRole('heading', { name: 'Pericles' })).toBeVisible();

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

  // The choice and the open article survive a reload; turning it off restores the old layout.
  await page.reload();
  await expect(reader.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  await expect(page.getByTestId('reader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
});
