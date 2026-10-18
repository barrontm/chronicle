import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));

/** The sample timeline, in the new layout (where the new renderer draws the timeline). */
async function openNewLayout(page: Page, phone: boolean) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.locator('.vis-item', { hasText: 'Aristotle' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Try the new layout' }).click();
  if (phone) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('[data-testid=timeline][data-ready]')).toBeVisible();
  await expect(page.locator('.vis-timeline')).toHaveCount(0);
}

test('the new timeline pans, zooms with the zoom bar and opens an entry @phone', async ({ page, isMobile }) => {
  await openNewLayout(page, isMobile);
  const timeline = page.getByTestId('timeline');
  const span = page.getByTestId('zoom-span');
  const year = page.locator('.thumbwheel-year');

  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await expect(span).toHaveText('100 years in view');

  // Dragging right moves back in time.
  const before = await year.textContent();
  const box = (await timeline.boundingBox())!;
  const y = box.y + box.height - 20;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 5 });
  await page.mouse.up();
  await expect(year).not.toHaveText(before!);
  const after = Number((await year.textContent())!.replace(/\D/g, ''));
  expect(after).toBeLessThan(Number(before!.replace(/\D/g, '')));
  await expect(span).toHaveText('100 years in view');

  // A millennium around 500 has the end of Rome in it; clicking it opens the entry.
  await page.getByTestId('time-bar').getByRole('button', { name: 'Millennium' }).click();
  await expect(span).toHaveText('1,000 years in view');
  await timeline.locator('.tl-mark[data-id=i_rome_falls]').click({ force: true }); // the timeline hit-tests by position
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Deposition of Romulus Augustulus' })).toBeVisible();
  await expect(timeline.locator('.tl-mark.selected')).toHaveAttribute('data-id', /.+/);
});

test('the new timeline zooms with Ctrl + wheel, and a cluster splits when clicked', async ({ page }) => {
  await openNewLayout(page, false);
  const timeline = page.getByTestId('timeline');
  const span = page.getByTestId('zoom-span');
  const box = (await timeline.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Far enough out, entries close together merge into clusters.
  const before = await span.textContent();
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await expect(span).not.toHaveText(before!);
  const cluster = timeline.locator('.tl-cluster').first();
  await expect(cluster).toBeVisible();
  const clusters = await timeline.locator('.tl-cluster').count();
  await cluster.click({ force: true }); // its count sits on top of it; the timeline hit-tests by position
  await expect.poll(() => timeline.locator('.tl-cluster').count()).toBeLessThan(clusters);
});
