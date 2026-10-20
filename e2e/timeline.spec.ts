import { expect, test, type Locator, type Page } from '@playwright/test';
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

test('the app opens in the reader layout, even for someone who had chosen the classic layout @phone', async ({ page }) => {
  // What an older version saved for "Use the classic layout" and its Timeline, Map and Both views.
  await page.addInitScript(() => { localStorage.setItem('chronicle.classicLayout', 'true'); localStorage.setItem('chronicle.view', '"timeline"'); });
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open an article' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Draft with AI…' })).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Use the classic layout' })).toHaveCount(0);
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

/**
 * Scroll the timeline's rows (Shift and the wheel) until a mark is well inside it. The wheel is sent to the
 * timeline itself (a phone's emulated mouse wheel doesn't reach it), then two frames so it's drawn.
 */
async function scrollToMark(timeline: Locator, target: Locator) {
  const host = (await timeline.boundingBox())!;
  const lo = host.y + 60, hi = host.y + host.height - 20;
  for (let i = 0; i < 150; i++) {
    // Any one of its marks in view will do (a world event has one in each band it touched).
    const mids = (await target.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.y + Math.min(r.height, 30) / 2; })));
    if (mids.some((m) => m > lo && m < hi)) break;
    const mid = mids.sort((a, b) => Math.min(Math.abs(a - lo), Math.abs(a - hi)) - Math.min(Math.abs(b - lo), Math.abs(b - hi)))[0];
    await timeline.evaluate(async (el, at) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: at.dy, shiftKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, { x: host.x + host.width / 2, y: host.y + host.height / 2, dy: mid !== undefined && mid <= lo ? -40 : 40 });
  }
  await expect(target.first()).toBeVisible();
}

test('the Overview stop shows polities as strips over their eras, world events in gold, and a group unfolds @phone', async ({ page, isMobile }) => {
  // The map shares the page: under a full parallel run its software rendering slows every frame.
  test.slow();
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();

  const stop = page.getByTestId('time-bar').getByRole('button', { name: 'Overview' });
  await stop.click();
  await expect(stop).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(timeline).toHaveAttribute('data-level', '0', { timeout: 15_000 });
  // At the top, what Bob shows in the overview.
  await expect(timeline.locator('text.tl-top-name', { hasText: 'Peloponnesian War' })).toBeVisible();
  // Alexander's conquest of Persia, a world event: gold in Macedon and in Persia, named in Macedon.
  await scrollToMark(timeline, timeline.locator('.tl-world[data-id=i_alexander_persia]'));
  await expect(timeline.locator('text.tl-world-name', { hasText: 'Alexander’s conquest of Persia' })).toBeVisible();
  // Greece: Classical Greece is the backdrop, its city-states folded into one strip.
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await expect(timeline.locator('.tl-era[data-id=i_classical]')).toBeVisible();
  // Its name, where there's room (a phone's narrower years leave none).
  if (!isMobile) await expect(timeline.locator('text.tl-era-name', { hasText: 'Classical Greece' })).toBeVisible();
  await expect(timeline.locator('text.tl-pol-name', { hasText: 'Classical Greece' })).toBeVisible();
  await expect(timeline.locator('.tl-strip[data-id="pol:t_athens"]')).toHaveCount(0);

  // Clicking the group unfolds it into Athens, Sparta, Corinth and Thebes; clicking Athens picks it, and Esc lets go.
  await group.click({ position: { x: 30, y: 6 }, force: true }); // the timeline hit-tests by position
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await expect(timeline.locator('text.tl-pol-name', { hasText: /^Athens$/ })).toBeVisible();
  await expect(timeline).toHaveAttribute('data-level', '0');
  const a = (await athens.boundingBox())!;
  await page.mouse.click(a.x + a.width * 0.45, a.y + a.height / 2);
  await expect(athens).toHaveClass(/picked/);
  await timeline.press('Escape');
  await expect(athens).not.toHaveClass(/picked/);

  // The Century stop goes back to the entries.
  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await expect(stop).toHaveAttribute('aria-pressed', 'false');
  await expect(timeline.locator('.tl-strip')).toHaveCount(0);
  await expect(timeline.locator('.tl-mark').first()).toBeVisible();
});

test('an era opens into its six lanes, says when one is empty, and Esc goes back @phone', async ({ page, isMobile }) => {
  // The map shares the page: under a full parallel run its software rendering slows every frame.
  test.slow();
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

  await page.getByTestId('time-bar').getByRole('button', { name: 'Overview' }).click();
  // The Overview stop frames everything over a moment; the era's wash is clicked once it's still, above the strips.
  await expect(timeline).toHaveAttribute('data-level', '0');
  const wash = timeline.locator('.tl-era[data-id=i_classical]');
  await scrollToMark(timeline, wash);
  await wash.click({ position: { x: 20, y: 6 }, force: true });
  await expect(timeline).toHaveAttribute('data-level', '1');
  await expect(timeline.locator('text.tl-era-head', { hasText: 'Classical Greece' })).toBeVisible();
  await expect(timeline.locator('.tl-era')).toHaveCount(0);
  await expect(timeline.locator('text.tl-lane-name', { hasText: 'POLITICS' })).toBeVisible();

  // Down the lanes (Shift and the wheel scroll them): the Economy lane's silver owls, and the empty Technology lane.
  await scrollToMark(timeline, timeline.locator(isMobile ? '.tl-list-item[data-id=i_owls]' : '.tl-phase[data-id=i_owls]'));
  await scrollToMark(timeline, timeline.locator('text.tl-lane-empty', { hasText: 'No technology here yet.' }));

  // Esc folds the lanes back into the overview.
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-level', '0');
  await expect(timeline.locator('.tl-era[data-id=i_classical]')).toBeVisible();
  await expect(timeline.locator('text.tl-era-head')).toHaveCount(0);
  await expect(page.getByTestId('time-bar').getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
});

test('Athens opens into its six lanes: Laurion in Economy, the war in War; a lane opens to all of it, and Esc steps back @phone', async ({ page, isMobile }) => {
  test.slow();
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();
  await page.getByTestId('time-bar').getByRole('button', { name: 'Overview' }).click();
  await expect(timeline).toHaveAttribute('data-level', '0');

  // Unfold Classical Greece, pick Athens, and click it again to open it.
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await expect(timeline).toHaveAttribute('data-level', '0');
  const a = (await athens.boundingBox())!;
  await page.mouse.click(a.x + a.width * 0.45, a.y + a.height / 2);
  await expect(athens).toHaveClass(/picked/);
  await expect(timeline.locator('text.tl-open-pill')).toBeVisible();
  await page.mouse.click(a.x + a.width * 0.45, a.y + a.height / 2);
  await expect(timeline).toHaveAttribute('data-level', '1');
  await expect(timeline.locator('text.tl-era-head', { hasText: 'Athens (Attica)' })).toBeVisible();
  await expect(timeline.locator('text.tl-back', { hasText: '‹ Overview' })).toBeVisible();

  // Closed lanes name their most prominent: the Peloponnesian War in War, the silver strike at Laurion in Economy (further down).
  const named = (id: string) => timeline.locator(isMobile ? `text.tl-list-item[data-id=${id}]` : `.tl-named[data-id=${id}]`);
  await scrollToMark(timeline, named('i_pelop'));
  await scrollToMark(timeline, named('i_laurion'));

  // Opening War shows all of it; Esc closes it again, then folds Athens back into the overview, then lets go of it.
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:war"]');
  await expect(toggle).toHaveText(/^Show all \d+ ▾$/);
  await toggle.click({ force: true });
  await expect(toggle).toHaveText('Show fewer ▴');
  if (!isMobile) await scrollToMark(timeline, timeline.locator('.tl-phase[data-id=i_pelop]'));
  await scrollToMark(timeline, timeline.locator(isMobile ? 'text.tl-list-item[data-id=i_sybota]' : '.tl-moment[data-id=i_sybota]'));
  await timeline.press('Escape');
  await expect(toggle).toHaveText(/^Show all \d+ ▾$/);
  await expect(timeline).toHaveAttribute('data-level', '1');
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-level', '0');
  await expect(athens).toHaveClass(/picked/);
  await timeline.press('Escape');
  await expect(athens).not.toHaveClass(/picked/);
});

test('the map follows the overview: Athens in 431 BCE at war with Sparta and Corinth, the War lane, and Persia clicked on the map', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  await expect(page.locator('[data-testid=map][data-ready]')).toBeAttached({ timeout: 20_000 });
  const year = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await year.click();
  await year.fill('431 BCE');
  await year.press('Enter');
  await expect(year).toHaveValue('431 BCE');

  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await page.getByTestId('time-bar').getByRole('button', { name: 'Overview' }).click();
  await expect(timeline).toHaveAttribute('data-level', '0');
  // Persia's strip as it is before the map focuses it.
  const persia = timeline.locator('.tl-strip[data-id="pol:t_persia"]');
  await scrollToMark(timeline, persia);
  const before = (await persia.boundingBox())!.height;

  // Pick Athens: on the map it's in ink, and the polities it was at war with that year are named so.
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await expect(timeline).toHaveAttribute('data-level', '0');
  const a = (await athens.boundingBox())!;
  await page.mouse.click(a.x + a.width * 0.45, a.y + a.height / 2);
  await expect(athens).toHaveClass(/picked/);
  const label = (name: string) => page.locator('.map-label.territory', { hasText: name });
  await expect(label('Athens')).toHaveAttribute('data-contact', 'picked');
  for (const name of ['Sparta', 'Corinth']) {
    await expect(label(name)).toHaveAttribute('data-contact', 'war');
    await expect(label(name)).toContainText('· at war');
  }
  await expect(page.getByTestId('map-follow')).toContainText('Athens (Attica) in 431 BCE: at war with Corinth, Sparta (Laconia and Messenia) and Thebes (Boeotia)');

  // Open Athens and its War lane: everyone it fought in the years in view, Persia too.
  await page.mouse.click(a.x + a.width * 0.45, a.y + a.height / 2);
  await expect(timeline).toHaveAttribute('data-level', '1');
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:war"]');
  await scrollToMark(timeline, toggle);
  await toggle.click({ force: true });
  await expect(toggle).toHaveText('Show fewer ▴');
  await expect(label('Achaemenid Persia')).toHaveAttribute('data-contact', 'war');
  await expect(label('Achaemenid Persia')).toContainText('· fought');
  await expect(page.getByTestId('map-follow')).toContainText(/^Athens \(Attica\) fought .*Achaemenid Persia/);

  // Click Persia on the map: back to the overview with Persia's rows grown, the rest faded.
  // Once the map's fit to the War lane has settled.
  await page.waitForTimeout(100);
  await expect(page.locator('[data-testid=map]:not([data-moving])')).toBeAttached();
  const q = (await label('Achaemenid Persia').boundingBox())!;
  await page.mouse.click(q.x + q.width / 2, q.y - 6);
  await expect(page.getByTestId('map-region')).toContainText('Showing Persia on the timeline');
  await expect(timeline).toHaveAttribute('data-region', 'Persia');
  await expect(timeline).toHaveAttribute('data-level', '0');
  await expect(persia).toBeVisible();
  await expect.poll(async () => (await persia.boundingBox())!.height).toBeGreaterThan(before * 1.15);
  // Esc lets go of the region first; Athens stays picked, as the map shows.
  await timeline.press('Escape');
  await expect(page.getByTestId('map-region')).toHaveCount(0);
  await expect(timeline).not.toHaveAttribute('data-region', 'Persia');
  await expect(label('Athens')).toHaveAttribute('data-contact', 'picked');
});

/** Open an entry by name from Search (`/`), which also brings it into view on the timeline. */
async function openFromSearch(page: Page, name: string) {
  await page.locator('.brand').click();
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search Chronicle' }).fill(name);
  await page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first().click();
}

test('⌘-drag boxes entries; Edit sets a lane on all of them, Delete removes them, and each has one Undo', async ({ page }) => {
  test.slow();
  // Without motion the timeline jumps straight to each window, so the marks are measured where they stay.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openNewLayout(page, false);
  const timeline = page.getByTestId('timeline');
  page.on('dialog', (d) => d.accept());
  // Opening Socrates frames him with Plato and Aristotle.
  await openFromSearch(page, 'Socrates');
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Socrates' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByTestId('item-view')).toHaveCount(0);
  const ids = ['i_socrates', 'i_plato', 'i_aristotle'];
  for (const id of ids) await expect(mark(page, id)).toBeVisible();
  // A box from just outside the three, with ⌘ held, measured and drawn in one go so the timeline can't move in between.
  await timeline.evaluate((el, ids) => {
    const host = el.getBoundingClientRect();
    const rs = ids.map((id) => el.querySelector(`.tl-mark[data-id=${id}]`)!.getBoundingClientRect());
    const x0 = Math.min(...rs.map((r) => r.left)) - 4, y0 = Math.min(...rs.map((r) => r.top)) - 4;
    const x1 = Math.min(Math.max(...rs.map((r) => r.right)) + 4, host.right - 2), y1 = Math.min(Math.max(...rs.map((r) => r.bottom)) + 4, host.bottom - 2);
    const send = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, metaKey: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
    send('pointerdown', x0, y0);
    for (let i = 1; i <= 4; i++) send('pointermove', x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4);
    send('pointerup', x1, y1);
  }, ids);
  const bar = page.getByTestId('pick-bar');
  await expect(bar).toContainText('3 selected');
  await expect(timeline.locator('.tl-picked')).toHaveCount(3);

  // Edit: Economy on all three.
  await bar.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByTestId('bulk-edit');
  await expect(form.getByRole('heading', { name: 'Edit 3 entries' })).toBeVisible();
  await form.getByRole('group', { name: 'Lanes' }).getByRole('button', { name: 'Economy' }).click();
  await form.getByRole('button', { name: 'Change 3 entries' }).click();
  await expect(page.getByTestId('bulk-note')).toContainText('Changed 3 entries.');
  // Opened from Search, since the bar may sit over its mark.
  await openFromSearch(page, 'Plato');
  await expect(page.getByTestId('item-lanes')).toHaveText(/^Economy$/);
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('item-lanes')).toHaveCount(0); // back to no lanes of its own
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Delete asks once and takes all three; Undo brings them back.
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('bulk-note')).toContainText('Deleted 3 entries.');
  await expect(bar.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  for (const id of ids) await expect(mark(page, id)).toHaveCount(0);
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  for (const id of ids) await expect(mark(page, id)).toBeVisible();

  // ⌘-click picks one; Esc lets go.
  await timeline.evaluate((el) => {
    const r = el.querySelector('.tl-mark[data-id=i_plato]')!.getBoundingClientRect();
    const x = r.left + Math.min(8, r.width / 2), y = r.top + r.height / 2;
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, metaKey: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
  });
  await expect(bar).toContainText('1 selected');
  await expect(page.getByTestId('item-view')).toHaveCount(0);
  await timeline.press('Escape');
  await expect(bar).toHaveCount(0);
});
