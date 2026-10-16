import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot regression: the main views with the test fixture, compared with
 * the baselines in visual.spec.ts-snapshots/. Baselines are rendered on macOS,
 * so these only run there (fonts render differently on Linux CI).
 * After an intended visual change: npx playwright test e2e/visual.spec.ts --update-snapshots
 */
test.skip(process.platform !== 'darwin', 'Screenshot baselines are rendered on macOS');

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));
// SwiftShader can shift a few anti-aliased map pixels between runs.
const SHOT = { maxDiffPixelRatio: 0.01 };

async function openWithFixture(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.locator('.vis-item', { hasText: 'Aristotle' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Show everything' }).click();
}

async function showMap(page: Page, view: 'Map' | 'Both', year: string) {
  await page.getByRole('button', { name: view, exact: true }).click();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  const input = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.fill(year);
  await input.press('Enter');
  await expect(input).toHaveValue(year);
}

test.describe('looks the same', () => {
  test('timeline', async ({ page }) => {
    await openWithFixture(page);
    await expect(page).toHaveScreenshot('timeline.png', SHOT);
  });

  test('map', async ({ page }) => {
    test.slow();
    await openWithFixture(page);
    await showMap(page, 'Map', '300 BCE');
    await expect(page).toHaveScreenshot('map.png', SHOT);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });
    test('timeline and map side by side', async ({ page }) => {
      test.slow();
      await openWithFixture(page);
      await showMap(page, 'Both', '1215');
      await expect(page).toHaveScreenshot('split-dark.png', SHOT);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    test('timeline', async ({ page }) => {
      await openWithFixture(page);
      await expect(page).toHaveScreenshot('phone-timeline.png', SHOT);
    });
  });
});
