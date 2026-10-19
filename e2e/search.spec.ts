import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('searching "salamis" finds the battle first, and picking it opens it on the timeline, the year and the map @phone', async ({ page, isMobile }) => {
  test.slow();
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);

  const box = page.getByRole('combobox', { name: 'Search Chronicle' });
  if (isMobile) await page.getByRole('button', { name: 'Search Chronicle' }).click();
  else {
    // `/` works whenever Bob isn't typing somewhere else (the reader's own Wikipedia box starts focused).
    await page.locator('.brand').click();
    await page.keyboard.press('/');
  }
  await expect(box).toBeFocused();

  await box.fill('zzzz');
  await expect(page.getByTestId('search-results')).toContainText('Nothing in Chronicle matches “zzzz”.');

  await box.fill('SALAMIS');
  const results = page.getByRole('listbox', { name: 'Search results' }).getByRole('option');
  await expect(results.first()).toContainText('Battle of Salamis');
  await expect(results.first()).toContainText('480 BCE');
  // Then the text that mentions it: a note and highlights.
  await expect(results.filter({ hasText: 'Where the fleet’s money came from' })).toHaveCount(1);
  expect(await results.count()).toBeLessThanOrEqual(20);

  await results.first().click();
  await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name: 'Battle of Salamis' })).toBeVisible();
  await expect(page.getByLabel('Year', { exact: true })).toHaveValue(/480 BCE/);
  // The timeline moves to it and selects it (on a phone its mark can sit in a cluster).
  await expect(page.getByTestId('timeline').getByRole('option', { name: /^Battle of Salamis, 480 BCE/ })).toHaveAttribute('aria-selected', 'true');

  // The map comes to Salamis.
  if (!isMobile) {
    await expect(page.locator('[data-testid=map][data-ready]')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('chronicle.mapView') ?? '{}') as { center?: [number, number]; zoom?: number }), { timeout: 15_000 })
      .toMatchObject({ center: [expect.closeTo(23.5, 0), expect.closeTo(37.9, 0)] });
  }
});
