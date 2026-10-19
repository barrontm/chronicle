import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/sample-history.json', import.meta.url));

/** The sample timeline, in the reader layout (on a phone, the map sheet that holds the timeline). */
async function openNewLayout(page: Page, phone: boolean) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.locator('.doc-title')).toHaveValue('Test fixture');
  if (phone) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('[data-testid=timeline][data-ready]')).toBeVisible();
}

test('a fresh start opens the reader layout; the classic layout is one choice away and stays chosen @phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open an article' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Use the classic layout' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('menuitemcheckbox', { name: 'Use the classic layout' }).click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await expect(page.getByTestId('reader')).toHaveCount(0);
  // The classic layout's timeline is drawn the same new way.
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('timeline').locator('.tl-mark[data-id=i_aristotle]')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Use the classic layout' }).click();
  await expect(page.getByTestId('reader')).toBeVisible();
});

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

/** Click an entry's mark (the timeline hit-tests by position, so its label on top doesn't matter). */
const mark = (page: Page, id: string) => page.getByTestId('timeline').locator(`.tl-mark[data-id=${id}]`);

test('opening a person lights up their influences with arrows, and fades the rest @phone', async ({ page, isMobile }) => {
  await openNewLayout(page, isMobile);
  const timeline = page.getByTestId('timeline');
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await mark(page, 'i_plato').click({ force: true });
  await expect(timeline.locator('.tl-mark.infl-by[data-id=i_socrates]')).toBeAttached();
  await expect(timeline.locator('.tl-mark.infl-on[data-id=i_aristotle]')).toBeAttached();
  await expect(timeline.locator('.tl-mark.dimmed[data-id=i_confucius]')).toBeAttached();
  await expect(timeline.locator('path.arc')).toHaveCount(2);
  await expect(timeline.locator('path.arc.infl-by')).toHaveAttribute('data-from', 'i_socrates');

  // A person without connections changes nothing.
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await mark(page, 'i_confucius').click({ force: true });
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Confucius' })).toBeVisible();
  await expect(timeline.locator('.dimmed')).toHaveCount(0);
  await expect(timeline.locator('path.arc')).toHaveCount(0);
});

test('opening an entry frames it with its connections; "Back to where I was" returns', async ({ page }) => {
  await openNewLayout(page, false);
  const span = page.getByTestId('zoom-span');
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await expect(span).toHaveText(/[0-9,]{4,} years in view/);
  await mark(page, 'i_plato').click({ force: true });
  await expect(span).toHaveText('180 years in view');
  await page.getByRole('button', { name: 'Back to where I was' }).click();
  await expect(span).toHaveText(/[0-9,]{4,} years in view/);
  await expect(page.getByRole('button', { name: 'Back to where I was' })).toHaveCount(0);
});

test('hiding a category hides its lane; trends line up under the timeline; the playhead shows the map’s year', async ({ page }) => {
  await openNewLayout(page, false);
  const timeline = page.getByTestId('timeline');
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await expect(mark(page, 'i_plato')).toBeAttached();
  await page.getByRole('group', { name: 'Show or hide categories' }).getByRole('button', { name: 'Philosophy & religion' }).click();
  await expect(mark(page, 'i_plato')).toHaveCount(0);
  await expect(timeline.locator('.tl-svg text', { hasText: 'Philosophy & religion' })).toHaveCount(0);

  // The trend strips start where the timeline's plot starts, so years line up.
  await expect(page.locator('.strip')).toHaveCount(2);

  const input = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.fill('1914');
  await input.press('Enter');
  await expect(timeline.locator('.tl-year')).toHaveText('1914');
});

test('the keyboard moves through entries and opens one; screen readers hear which', async ({ page }) => {
  await openNewLayout(page, false);
  const timeline = page.getByTestId('timeline');
  await page.getByTestId('time-bar').getByRole('button', { name: 'Millennium' }).click();
  await expect(page.getByTestId('zoom-span')).toHaveText('1,000 years in view');
  await timeline.focus();
  await page.keyboard.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-activedescendant', /tl-active/);
  const option = timeline.getByRole('option');
  await expect(option).toHaveText(/, .* of \d+$/);
  await page.keyboard.press('ArrowDown');
  const said = (await option.textContent())!;
  await expect(timeline.locator('.tl-ring')).toBeAttached();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('item-view').getByRole('heading', { name: said.split(',')[0] })).toBeVisible();
});

test('drag an open entry to change its dates, undo it, drag again, and it stays after a reload', async ({ page }) => {
  await openNewLayout(page, false);
  const view = page.getByTestId('item-view');
  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await mark(page, 'i_pelop').click({ force: true });
  await expect(view.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  await expect(view).toContainText('431–404 BCE');

  const drag = async () => {
    // Wait for the zoom to settle, then drag the bar's middle to the right.
    await page.waitForTimeout(500);
    const bar = (await mark(page, 'i_pelop').boundingBox())!;
    const y = bar.y + bar.height / 2;
    await page.mouse.move(bar.x + bar.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2 + 60, y, { steps: 6 });
    await page.mouse.move(bar.x + bar.width / 2 + 120, y, { steps: 6 });
    await page.mouse.up();
  };
  await drag();
  const note = page.getByTestId('moved-note');
  await expect(note).toContainText(/Moved Peloponnesian War to \d+–\d+ BCE\./);
  // The war is as long as it was: only its years moved.
  const [a, b] = (await note.textContent())!.match(/(\d+)–(\d+) BCE/)!.slice(1).map(Number);
  expect(a - b).toBe(27);
  expect(a).toBeLessThan(431);
  await expect(view).toContainText(`${a}–${b} BCE`);
  await note.getByRole('button', { name: 'Undo' }).click();
  await expect(view).toContainText('431–404 BCE');

  await drag();
  await expect(note).toBeVisible();
  const moved = (await note.textContent())!.match(/\d+–\d+ BCE/)![0];
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('[data-testid=timeline][data-ready]')).toBeVisible();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All' }).click();
  await mark(page, 'i_pelop').click({ force: true });
  await expect(view).toContainText(moved);
});

test('the Eras stop shows each era in its region’s row, with its lane strip, and opens one @phone', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();

  const eras = page.getByTestId('time-bar').getByRole('button', { name: 'Eras' });
  await eras.click();
  await expect(eras).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline).toHaveAttribute('data-level', '0');
  const region = timeline.locator('text.tl-region', { hasText: 'Greece' });
  const band = timeline.locator('.tl-era[data-id=i_classical]');
  await expect(region).toBeVisible();
  await expect(band).toBeVisible();
  await expect(timeline.locator('text', { hasText: /^47 highlights$/ })).toBeVisible();
  // In the Greece row: just under its name on a phone, beside it otherwise.
  const r = (await region.boundingBox())!, b = (await band.boundingBox())!;
  expect(b.y - r.y).toBeLessThan(60);
  expect(b.y + b.height).toBeGreaterThan(r.y);
  // The strip along its bottom: the lanes of its highlights, Politics and law first.
  const strip = timeline.locator('.tl-era-mix[data-id=i_classical]');
  expect(await strip.count()).toBeGreaterThanOrEqual(4);
  await expect(strip.first()).toHaveClass(/politics/);

  // Clicking it opens it into its lanes, where its name opens the era; the Century stop goes back to the entries.
  await band.click({ position: { x: 20, y: 10 }, force: true }); // the timeline hit-tests by position
  await expect(eras).toHaveAttribute('aria-pressed', 'false');
  await expect(timeline).toHaveAttribute('data-level', '1');
  await timeline.locator('text.tl-era-head', { hasText: 'Classical Greece' }).click({ force: true });
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Classical Greece' })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await expect(eras).toHaveAttribute('aria-pressed', 'false');
  await expect(timeline.locator('.tl-era')).toHaveCount(0);
  await expect(timeline.locator('.tl-mark').first()).toBeVisible();
});

test('an era opens into its six lanes, says when one is empty, and Esc goes back @phone', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  // Without Technology and Science, nothing is left in the Classical period's Technology lane.
  const cats = page.getByRole('group', { name: 'Show or hide categories' });
  await cats.getByRole('button', { name: 'Technology' }).click();
  await cats.getByRole('button', { name: 'Science' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();

  await page.getByTestId('time-bar').getByRole('button', { name: 'Eras' }).click();
  // The Eras stop frames every era over a moment; the band is clicked once it's still.
  await expect(timeline).toHaveAttribute('data-level', '0');
  await timeline.locator('.tl-era[data-id=i_classical]').click({ position: { x: 20, y: 10 }, force: true });
  await expect(timeline).toHaveAttribute('data-level', '1');
  await expect(timeline.locator('text.tl-era-head', { hasText: 'Classical Greece' })).toBeVisible();
  await expect(timeline.locator('.tl-era')).toHaveCount(0);
  await expect(timeline.locator('text.tl-lane-name', { hasText: 'POLITICS' })).toBeVisible();

  // Down the lanes (Shift and the wheel scroll them): the Economy lane's silver owls, and the empty Technology lane.
  const box = (await timeline.boundingBox())!;
  const scrollTo = async (target: ReturnType<typeof timeline.locator>) => {
    for (let i = 0; i < 150 && !(await target.count()); i++) {
      // Sent to the timeline itself (a phone's emulated mouse wheel doesn't reach it), then two frames so it's drawn.
      await timeline.evaluate(async (el, at) => {
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, shiftKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    }
    await expect(target.first()).toBeVisible();
  };
  await scrollTo(timeline.locator(isMobile ? '.tl-list-item[data-id=i_owls]' : '.tl-phase[data-id=i_owls]'));
  await scrollTo(timeline.locator('text.tl-lane-empty', { hasText: 'No technology here yet.' }));

  // Esc folds the lanes back into the eras.
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-level', '0');
  await expect(timeline.locator('.tl-era[data-id=i_classical]')).toBeVisible();
  await expect(timeline.locator('text.tl-era-head')).toHaveCount(0);
  await expect(page.getByTestId('time-bar').getByRole('button', { name: 'Eras' })).toHaveAttribute('aria-pressed', 'true');
});
