import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot regression: the main views with the test fixture, compared with
 * the baselines in visual.spec.ts-snapshots/. Baselines are rendered on macOS,
 * so these only run there (fonts render differently on Linux CI).
 * After an intended visual change: npx playwright test e2e/visual.spec.ts --update-snapshots
 */
test.skip(process.platform !== 'darwin', 'Screenshot baselines are rendered on macOS');

// The Classical Greece fixture: the timeline is the overview, so it needs polities and eras to draw.
const FIXTURE = fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url));
// SwiftShader can shift a few anti-aliased map pixels between runs.
const SHOT = { maxDiffPixelRatio: 0.01 };

/** The reader layout with the fixture in view: the whole overview on the timeline, the map at `year` (on a phone, the map sheet). */
async function openWithFixture(page: Page, year: string) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  if (page.viewportSize()!.width <= 860) await page.getByTestId('reader').getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByTestId('timeline').locator('.tl-strip').first()).toBeAttached();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Show everything' }).click();
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  const input = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.fill(year);
  await input.press('Enter');
  await expect(input).toHaveValue(year);
}

test.describe('looks the same', () => {
  test('map and timeline beside the reader', async ({ page }) => {
    test.slow();
    await openWithFixture(page, '300 BCE');
    await expect(page).toHaveScreenshot('desktop.png', SHOT);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });
    test('map and timeline beside the reader', async ({ page }) => {
      test.slow();
      await openWithFixture(page, '431 BCE');
      await expect(page).toHaveScreenshot('dark.png', SHOT);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    test('map sheet', async ({ page }) => {
      test.slow();
      await openWithFixture(page, '300 BCE');
      await expect(page).toHaveScreenshot('phone.png', SHOT);
    });
  });
});
