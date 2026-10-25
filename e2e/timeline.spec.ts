import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

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

const GREECE = fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url));

/** The Classical Greece fixture, in the reader layout (on a phone, the map sheet that holds the timeline). */
async function openGreece(page: Page, isMobile: boolean) {
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(GREECE);
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();
  return timeline;
}

test('the timeline is the overview: it pans, zooms with the zoom bar and Ctrl + wheel, with no other view to switch to @phone', async ({ page, isMobile }) => {
  const timeline = await openGreece(page, isMobile);
  const span = page.getByTestId('zoom-span');
  const year = page.locator('.thumbwheel-year');
  await expect(page.getByTestId('time-bar').getByRole('button', { name: 'Overview' })).toHaveCount(0);

  await page.getByTestId('time-bar').getByRole('button', { name: 'Century' }).click();
  await expect(span).toHaveText('100 years in view');
  // Polities are still strips, however close in.
  await expect(timeline.locator('.tl-strip').first()).toBeAttached();

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
  await expect(span).toHaveText('100 years in view');

  // Ctrl and the wheel zoom out around the pointer.
  if (!isMobile) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 200);
    await page.keyboard.up('Control');
    await expect(span).not.toHaveText('100 years in view');
  }
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(span).toHaveText(/[0-9,]{3,} years in view/);
});

test('opening an entry from Search opens its polity in place; showing its time frames it, and "Back to where I was" returns', async ({ page }) => {
  const timeline = await openGreece(page, false);
  const span = page.getByTestId('zoom-span');
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(span).toHaveText(/[0-9,]{3,} years in view/);
  const wide = await span.textContent();
  // What Plato is in opens in place, and his time is framed with Socrates and Aristotle.
  await expect(timeline).toHaveAttribute('data-open', '');
  await openFromSearch(page, 'Plato');
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Plato' })).toBeVisible();
  await expect(timeline).toHaveAttribute('data-open', /\S/);
  await expect(timeline.locator('[data-id=i_plato]').first()).toBeAttached();
  await expect(span).not.toHaveText(wide!);
  await page.getByRole('button', { name: 'Back to where I was' }).click();
  await expect(span).toHaveText(wide!);
  await expect(page.getByRole('button', { name: 'Back to where I was' })).toHaveCount(0);
});

test('hiding a category hides its polities; trends line up under the timeline; the playhead shows the map’s year', async ({ page }) => {
  const timeline = await openGreece(page, false);
  const macedon = timeline.locator('.tl-strip[data-id="pol:t_macedon"]');
  await scrollToMark(timeline, macedon);
  const cat = page.getByRole('group', { name: 'Show or hide categories' }).getByRole('button', { name: 'Politics & government' });
  await cat.click();
  await expect(macedon).toHaveCount(0);
  await cat.click();
  await scrollToMark(timeline, macedon);

  const input = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await input.fill('431 BCE');
  await input.press('Enter');
  await expect(timeline.locator('.tl-year')).toHaveText('431 BCE');
});

test('the keyboard moves through the entries in open lanes and opens one; screen readers hear which', async ({ page }) => {
  const { timeline } = await openAthens(page, false);
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

test('drag an open entry in its lane to change its dates, undo it, drag again, and it stays after a reload', async ({ page }) => {
  test.slow();
  // Wide enough that, with the entry's panel open, the lanes aren't the phone's list (which has no bars to drag).
  await page.setViewportSize({ width: 1900, height: 1000 });
  const { timeline } = await openAthens(page, false);
  const view = page.getByTestId('item-view');
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:pol:t_athens|war"]');
  await scrollToMark(timeline, toggle);
  await toggle.click({ force: true });
  const bar = timeline.locator('.tl-phase[data-id=i_pelop]');
  await scrollToMark(timeline, bar);
  // Opened from Search, its time is framed, so its bar is wide enough to take hold of.
  await openFromSearch(page, 'Peloponnesian War');
  await expect(view.getByRole('heading', { name: 'Peloponnesian War' })).toBeVisible();
  await expect(view).toContainText('431–404 BCE');
  await scrollToMark(timeline, bar);
  // Arrows between lanes can cross the bar: find a point where it's the open war, to drag, by its tooltip.
  const onBar = async () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) for (const f of [0.15, 0.3, 0.5, 0.7, 0.85, 0.05, 0.95]) {
      const b = (await bar.boundingBox())!;
      const p = { x: b.x + b.width * f, y: b.y + b.height / 2 };
      await page.mouse.move(p.x + 1, p.y);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(50);
      const tip = (await page.locator('.tl-tip').textContent()) ?? '';
      if (tip.startsWith('Peloponnesian War') && tip.includes('Drag to change its dates')) return p;
      seen.push(tip);
    }
    throw new Error(`No point on the war’s bar takes hold of it: ${JSON.stringify(seen)}`);
  };

  const drag = async () => {
    await expect(timeline).toHaveAttribute('data-settled', '');
    const p = await onBar();
    await page.mouse.down();
    await page.mouse.move(p.x + 30, p.y, { steps: 6 });
    await page.mouse.move(p.x + 60, p.y, { steps: 6 });
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
  // Athens is still open, as Bob left it.
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-open', /pol:t_athens/);
  await openFromSearch(page, 'Peloponnesian War');
  await expect(view).toContainText(moved);
});

/**
 * Scroll the timeline's rows (Shift and the wheel) until a mark is well inside it. The wheel is sent to the
 * timeline itself (a phone's emulated mouse wheel doesn't reach it), then two frames so it's drawn.
 */
async function scrollToMark(timeline: Locator, target: Locator) {
  const host = (await timeline.boundingBox())!;
  // Below the axis and level 1's header row, which a click there would hit instead.
  const lo = host.y + 90, hi = host.y + host.height - 20;
  for (let i = 0; i < 150; i++) {
    // Any one of its marks in view will do (a world event has one in each band it touched). Not drawn at all: look up first, then down.
    const mids = (await target.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.y + Math.min(r.height, 30) / 2; })));
    if (mids.some((m) => m > lo && m < hi)) break;
    const mid = mids.sort((a, b) => Math.min(Math.abs(a - lo), Math.abs(a - hi)) - Math.min(Math.abs(b - lo), Math.abs(b - hi)))[0];
    await timeline.evaluate(async (el, at) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: at.dy, shiftKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, { x: host.x + host.width / 2, y: host.y + host.height / 2, dy: mid !== undefined ? (mid <= lo ? -40 : 40) : i < 40 ? -40 : 40 });
  }
  await expect(target.first()).toBeVisible();
}

test('the overview shows polities as strips over their eras, world events in gold, and a group unfolds @phone', async ({ page, isMobile }) => {
  // The map shares the page: under a full parallel run its software rendering slows every frame.
  test.slow();
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  if (isMobile) await page.getByTestId('reader').getByRole('button', { name: 'Map' }).click();
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();

  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline).toHaveAttribute('data-settled', '', { timeout: 15_000 });
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

  // Clicking the group unfolds it into Athens, Sparta, Corinth and Thebes; clicking Athens picks it and opens its lanes;
  // Esc folds them, then lets go.
  await group.click({ position: { x: 30, y: 6 }, force: true }); // the timeline hit-tests by position
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await scrollToMark(timeline, athens);
  await expect(timeline.locator('text.tl-pol-name', { hasText: /^Athens$/ })).toBeVisible();
  await expect(timeline).toHaveAttribute('data-settled', '');
  const a = await stripPoint(athens);
  await page.mouse.click(a.x, a.y);
  await expect(athens).toHaveClass(/picked/);
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-open', '');
  await expect(athens).toHaveClass(/picked/);
  await timeline.press('Escape');
  await expect(athens).not.toHaveClass(/picked/);
});

test('an era’s lanes unfurl under its band, say when one is empty, and Esc folds them @phone', async ({ page, isMobile }) => {
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

  // The era's wash is clicked once the timeline is still, above the strips.
  await expect(timeline).toHaveAttribute('data-settled', '');
  const wash = timeline.locator('.tl-era[data-id=i_classical]');
  await scrollToMark(timeline, wash);
  const span = await page.getByTestId('zoom-span').textContent();
  await wash.click({ position: { x: 20, y: 6 }, force: true });
  await expect(timeline).toHaveAttribute('data-open', 'i_classical');
  await expect(timeline.locator('text.tl-era-head', { hasText: 'Classical Greece' })).toBeVisible();
  // The rest of the overview stays, and so do the years in view.
  await expect(timeline.locator('.tl-era[data-id=i_classical]')).toBeAttached();
  await expect(page.getByTestId('zoom-span')).toHaveText(span!);
  await scrollToMark(timeline, timeline.locator('text.tl-lane-name', { hasText: 'POLITICS' }));

  // Down the lanes (Shift and the wheel scroll them): the Economy lane's silver owls, and the empty Technology lane.
  await scrollToMark(timeline, timeline.locator(isMobile ? '.tl-list-item[data-id=i_owls]' : '.tl-phase[data-id=i_owls]'));
  await scrollToMark(timeline, timeline.locator('text.tl-lane-empty', { hasText: 'No technology here yet.' }));

  // Esc folds the lanes back under the band.
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-open', '');
  await expect(timeline.locator('text.tl-era-head')).toHaveCount(0);
  await scrollToMark(timeline, wash);
});

/** The Classical Greece fixture with Athens' six lanes unfurled under its strip; returns the timeline and Athens' strip. */
async function openAthens(page: Page, isMobile: boolean) {
  const timeline = await openGreece(page, isMobile);
  await expect(timeline).toHaveAttribute('data-settled', '');

  // Unfold Classical Greece, and click Athens to open it.
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await scrollToMark(timeline, athens);
  await expect(timeline).toHaveAttribute('data-settled', '');
  // Not so soon after the group's click that the two make a double-click.
  await page.waitForTimeout(400);
  const a = await stripPoint(athens);
  await page.mouse.click(a.x, a.y);
  await expect(athens).toHaveClass(/picked/);
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
  await expect(timeline).toHaveAttribute('data-settled', '');
  await scrollToMark(timeline, timeline.locator('text.tl-era-head', { hasText: 'Athens (Attica)' }));
  await expect(timeline.locator('text.tl-fold')).toHaveCount(1);
  return { timeline, athens };
}

test('Athens’ six lanes unfurl under it: Laurion in Economy, the war in War; a lane opens to all of it, and Esc steps back @phone', async ({ page, isMobile }) => {
  test.slow();
  const { timeline, athens } = await openAthens(page, isMobile);

  // Closed lanes name their most prominent: the Peloponnesian War in War, the silver strike at Laurion in Economy (further down).
  const named = (id: string) => timeline.locator(isMobile ? `text.tl-list-item[data-id=${id}]` : `.tl-named[data-id=${id}]`);
  await scrollToMark(timeline, named('i_pelop'));
  await scrollToMark(timeline, named('i_laurion'));

  // Opening War shows all of it; Esc closes it again, then folds Athens' lanes, then lets go of it.
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:pol:t_athens|war"]');
  await scrollToMark(timeline, toggle);
  await expect(toggle).toHaveText(/^Show all \d+ ▾$/);
  await toggle.click({ force: true });
  await expect(toggle).toHaveText('Show fewer ▴');
  if (!isMobile) await scrollToMark(timeline, timeline.locator('.tl-phase[data-id=i_pelop]'));
  await scrollToMark(timeline, timeline.locator(isMobile ? 'text.tl-list-item[data-id=i_sybota]' : '.tl-moment[data-id=i_sybota]'));
  await timeline.press('Escape');
  await expect(toggle).toHaveText(/^Show all \d+ ▾$/);
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
  await timeline.press('Escape');
  await expect(timeline).toHaveAttribute('data-open', '');
  await scrollToMark(timeline, athens);
  await expect(athens).toHaveClass(/picked/);
  await timeline.press('Escape');
  await expect(athens).not.toHaveClass(/picked/);
});

test('Sparta opens too, under its own strip, without moving the years in view; its Fold folds only Sparta', async ({ page }) => {
  test.slow();
  const { timeline } = await openAthens(page, false);
  const span = await page.getByTestId('zoom-span').textContent();
  const sparta = timeline.locator('.tl-strip[data-id="pol:t_sparta"]');
  await scrollToMark(timeline, sparta);
  await expect(timeline).toHaveAttribute('data-settled', '');
  const s = await stripPoint(sparta);
  await page.mouse.click(s.x, s.y);
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens pol:t_sparta');
  await expect(page.getByTestId('zoom-span')).toHaveText(span!);
  await expect(sparta).toHaveClass(/picked/);
  // Two sets of lanes, each with its own War lane.
  await scrollToMark(timeline, timeline.locator('text.tl-era-head', { hasText: /^Sparta/ }));
  const fold = timeline.locator('text.tl-fold[data-id="__fold:pol:t_sparta"]');
  await scrollToMark(timeline, fold);
  await expect(timeline).toHaveAttribute('data-settled', '');
  await fold.click({ force: true });
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
});

test('Add under a lane in Athens opens a new entry in that lane, part of Athens, and it lands there @phone', async ({ page, isMobile }) => {
  test.slow();
  const { timeline } = await openAthens(page, isMobile);
  // "+ Add" under Economy: a real button, so it's reached with Tab and pressed with Enter.
  const add = timeline.getByRole('button', { name: 'Add to Economy' });
  await scrollToMark(timeline, add);
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:pol:t_athens|economy"]');
  const before = Number((await toggle.first().textContent())?.match(/\d+/)?.[0]);
  await add.focus();
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('item-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Economy' })).toHaveAttribute('aria-pressed', 'true');
  const partOf = editor.getByTestId('suggested-connections').getByRole('checkbox');
  await expect(partOf).toHaveAccessibleName('Part of Athens (Attica)');
  await expect(partOf).toBeChecked();
  await editor.getByLabel('Title').fill('Laurion silver strike');
  await editor.getByRole('button', { name: 'Add to timeline' }).click();
  await expect(page.getByRole('heading', { name: 'Laurion silver strike' })).toBeVisible();

  // It lands in Athens' Economy lane, which opens to show it (on the phone, under its panel).
  if (isMobile) await page.getByRole('button', { name: 'Close' }).click();
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
  await scrollToMark(timeline, toggle.first());
  await expect(toggle.first()).toHaveText('Show fewer ▴');
  await expect(timeline.locator('text.tl-lane-name', { hasText: 'ECONOMY' })).toBeVisible();
  expect(before).toBeGreaterThan(0);
  const mark = isMobile ? timeline.locator('text.tl-list-item', { hasText: 'Laurion silver strike' }) : timeline.locator('text.tl-label, text.tl-list-item', { hasText: 'Laurion silver strike' });
  await scrollToMark(timeline, mark);
});

test('linking the war to the economy as “weakened” with a highlight draws an arrow across Athens’ lanes and a line in both panels @phone', async ({ page, isMobile }) => {
  test.slow();
  const { timeline } = await openAthens(page, isMobile);
  const named = (id: string) => timeline.locator(isMobile ? `text.tl-list-item[data-id=${id}]` : `.tl-named[data-id=${id}]`);
  // On the phone, a list row is tapped near its start, clear of the playhead.
  const open = (id: string) => named(id).first().click({ force: true, ...(isMobile ? { position: { x: 4, y: 8 } } : {}) });
  const close = () => page.getByRole('button', { name: 'Close' }).first().click();

  // The Archidamian War led to… the Athenian owls, added in its editor.
  await scrollToMark(timeline, named('i_archidamian'));
  await open('i_archidamian');
  const view = page.getByTestId('item-view');
  await expect(view.getByRole('heading', { name: 'Archidamian War' })).toBeVisible();
  await view.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('item-editor');
  await editor.getByLabel('Kind of connection').selectOption({ label: 'Led to' });
  await editor.getByPlaceholder('…which entry?').fill('owls');
  await editor.getByRole('option', { name: /Athenian silver/ }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();

  // Its effects on other lanes list it; opening the line opens the connection, where Bob says what it did and why.
  await view.getByTestId('effects').getByRole('button', { name: /^Led to: Athenian silver “owls”/ }).click();
  const rel = page.getByTestId('relation-view');
  await expect(rel.getByText('No highlights yet. Pick the passages that show this.')).toBeVisible();
  await rel.getByRole('button', { name: 'Edit' }).click();
  const relEdit = page.getByTestId('relation-editor');
  await relEdit.getByRole('button', { name: 'weakened', exact: true }).click();
  await relEdit.getByLabel('Find a highlight').fill('silver mines');
  await relEdit.getByRole('checkbox', { name: /lost its revenue from the silver mines/ }).check();
  await relEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(rel.getByRole('heading', { level: 2 })).toHaveText('Archidamian War weakened Athenian silver “owls”');
  await expect(rel.getByTestId('evidence')).toHaveCount(1);
  await expect(rel.getByText('War', { exact: true })).toBeVisible();
  await close();

  if (isMobile) {
    // On the phone: a line under the war, the effect in bold, and the owls.
    await scrollToMark(timeline, timeline.locator('text.tl-effect-line', { hasText: /^weakened$/ }));
    await expect(timeline.locator('path.tl-margin-arc').first()).toBeAttached();
  } else {
    // On the laptop: an arrow in War's cinnabar from the war, across to the owls in Economy, its pill opening the connection.
    await scrollToMark(timeline, named('i_archidamian'));
    const arc = timeline.locator('path.tl-influence[data-from=i_archidamian][data-to=i_owls]');
    await expect(arc).toBeAttached();
    const rid = (await arc.getAttribute('data-id'))!;
    await named('i_archidamian').first().hover({ force: true });
    await expect(arc).toHaveClass(/focus/);
    const pill = timeline.locator(`text.tl-effect-label[data-id="${rid}"]`);
    await expect(pill).toHaveText('weakened');
    await pill.click({ force: true });
    await expect(rel.getByRole('heading', { level: 2 })).toHaveText('Archidamian War weakened Athenian silver “owls”');
    await close();
  }

  // The owls' panel reads it the other way.
  await scrollToMark(timeline, named('i_owls'));
  await open('i_owls');
  await expect(view.getByTestId('effects').getByRole('button', { name: /^Weakened by: Archidamian War/ })).toBeVisible();
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
  await expect(timeline).toHaveAttribute('data-settled', '');
  // Persia's strip as it is before the map focuses it.
  const persia = timeline.locator('.tl-strip[data-id="pol:t_persia"]');
  await scrollToMark(timeline, persia);
  const before = (await persia.boundingBox())!.height;

  // Click Athens: on the map it's in ink, and the polities it was at war with that year are named so.
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await scrollToMark(timeline, athens);
  await expect(timeline).toHaveAttribute('data-settled', '');
  // Near its name, clear of the playhead.
  const a = await stripPoint(athens);
  await page.mouse.click(a.x, a.y);
  await expect(athens).toHaveClass(/picked/);
  const label = (name: string) => page.locator('.map-label.territory', { hasText: name });
  await expect(label('Athens')).toHaveAttribute('data-contact', 'picked');
  for (const name of ['Sparta', 'Corinth']) {
    await expect(label(name)).toHaveAttribute('data-contact', 'war');
    await expect(label(name)).toContainText('· at war');
  }
  await expect(page.getByTestId('map-follow')).toContainText('Athens (Attica) in 431 BCE: at war with Corinth, Sparta (Laconia and Messenia) and Thebes (Boeotia)');

  // Its lanes are open too; its War lane: everyone it fought in the years in view, Persia too.
  await expect(timeline).toHaveAttribute('data-open', 'pol:t_athens');
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:pol:t_athens|war"]');
  await scrollToMark(timeline, toggle);
  await toggle.click({ force: true });
  await expect(toggle).toHaveText('Show fewer ▴');
  await expect(label('Achaemenid Persia')).toHaveAttribute('data-contact', 'war');
  await expect(label('Achaemenid Persia')).toContainText('· fought');
  await expect(page.getByTestId('map-follow')).toContainText(/^Athens \(Attica\) fought .*Achaemenid Persia/);

  // Click Persia on the map: Persia's rows grow and come into view, the rest faded.
  // Once the map's fit to the War lane has settled.
  await page.waitForTimeout(100);
  await expect(page.locator('[data-testid=map]:not([data-moving])')).toBeAttached();
  const q = (await label('Achaemenid Persia').boundingBox())!;
  await page.mouse.click(q.x + q.width / 2, q.y - 6);
  await expect(page.getByTestId('map-region')).toContainText('Showing Persia on the timeline');
  await expect(timeline).toHaveAttribute('data-region', 'Persia');
  await expect(persia).toBeVisible();
  await expect.poll(async () => (await persia.boundingBox())!.height).toBeGreaterThan(before * 1.15);
  // Esc lets go of the region first; Athens stays picked, as the map shows.
  await timeline.press('Escape');
  await expect(page.getByTestId('map-region')).toHaveCount(0);
  await expect(timeline).not.toHaveAttribute('data-region', 'Persia');
  await expect(label('Athens')).toHaveAttribute('data-contact', 'picked');
});

/** Open an entry by name from Search (`/`), which also brings it into view on the timeline. */
/** A point on a strip at its name, which thread labels keep clear of (a tap brings its ribbons up under the finger). */
async function stripPoint(strip: Locator): Promise<{ x: number; y: number }> {
  const a = (await strip.boundingBox())!;
  return { x: a.x + Math.min(24, a.width * 0.1), y: a.y + a.height / 2 };
}

async function openFromSearch(page: Page, name: string) {
  await page.locator('.brand').click();
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search Chronicle' }).fill(name);
  await page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first().click();
}

test('⌘-drag boxes entries in open lanes; Edit sets a lane on all of them, Delete removes them, and each has one Undo', async ({ page }) => {
  test.slow();
  // Without motion the timeline jumps straight to each window, so the marks are measured where they stay.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { timeline } = await openAthens(page, false);
  page.on('dialog', (d) => d.accept());
  // Athens' War lane, open: three of its wars side by side.
  const toggle = timeline.locator('text.tl-lane-toggle[data-id="__lane:pol:t_athens|war"]');
  await scrollToMark(timeline, toggle);
  await toggle.click({ force: true });
  const ids = ['i_pelop', 'i_archidamian', 'i_decelean'];
  await scrollToMark(timeline, timeline.locator('.tl-phase[data-id=i_archidamian]'));
  for (const id of ids) await expect(timeline.locator(`.tl-phase[data-id=${id}]`)).toBeVisible();
  // A box from just outside the three, with ⌘ held, measured and drawn in one go so the timeline can't move in between.
  const box = async (which: string[]) => timeline.evaluate((el, ids) => {
    const host = el.getBoundingClientRect();
    const rs = ids.map((id) => el.querySelector(`.tl-phase[data-id=${id}]`)!.getBoundingClientRect());
    const x0 = Math.max(Math.min(...rs.map((r) => r.left)) - 4, host.left + 200), y0 = Math.min(...rs.map((r) => r.top)) - 4;
    const x1 = Math.min(Math.max(...rs.map((r) => r.right)) + 4, host.right - 2), y1 = Math.min(Math.max(...rs.map((r) => r.bottom)) + 4, host.bottom - 2);
    const send = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, metaKey: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
    send('pointerdown', x0, y0);
    for (let i = 1; i <= 4; i++) send('pointermove', x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4);
    send('pointerup', x1, y1);
  }, which);
  await box(ids);
  const bar = page.getByTestId('pick-bar');
  await expect(bar).toContainText(/\d+ selected/);
  const n = Number((await bar.textContent())!.match(/(\d+) selected/)![1]);
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(timeline.locator('.tl-picked')).toHaveCount(n);

  // Edit: Economy on all of them.
  await bar.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByTestId('bulk-edit');
  await expect(form.getByRole('heading', { name: `Edit ${n} entries` })).toBeVisible();
  await form.getByRole('group', { name: 'Lanes' }).getByRole('button', { name: 'Economy' }).click();
  await form.getByRole('button', { name: `Change ${n} entries` }).click();
  await expect(page.getByTestId('bulk-note')).toContainText(`Changed ${n} entries.`);
  await openFromSearch(page, 'Archidamian War');
  await expect(page.getByTestId('item-lanes')).toContainText('Economy');
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('item-lanes')).not.toContainText('Economy');
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Delete asks once and takes them all; Undo brings them back.
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('bulk-note')).toContainText(`Deleted ${n} entries.`);
  await expect(bar.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  for (const id of ids) await expect(timeline.locator(`.tl-phase[data-id=${id}]`)).toHaveCount(0);
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  await scrollToMark(timeline, timeline.locator('.tl-phase[data-id=i_archidamian]'));
  for (const id of ids) await expect(timeline.locator(`.tl-phase[data-id=${id}]`)).toBeAttached();

  // ⌘-click picks one; Esc lets go.
  await scrollToMark(timeline, timeline.locator('.tl-phase[data-id=i_archidamian]'));
  await timeline.evaluate((el) => {
    const r = el.querySelector('.tl-phase[data-id=i_archidamian]')!.getBoundingClientRect();
    const x = r.left + Math.min(8, r.width / 2), y = r.top + r.height / 2;
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, metaKey: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
  });
  await expect(bar).toContainText('1 selected');
  await expect(page.getByTestId('item-view')).toHaveCount(0);
  await timeline.press('Escape');
  await expect(bar).toHaveCount(0);
});

test('a theme added to Classical Greece shows as a chip on its era, and the map’s Greek tint plays from Archaic to Hellenistic', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => { try { localStorage.setItem('chronicle.speed', '50'); } catch { /* fine */ } });
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toBeVisible();

  // On the period's panel: a new theme over one of its highlights, and where it is on the map.
  await openFromSearch(page, 'Classical Greece');
  const view = page.getByTestId('item-view');
  await expect(view.getByRole('heading', { name: 'Classical Greece' })).toBeVisible();
  const themes = view.getByTestId('themes');
  await expect(themes.getByRole('button', { name: 'Edit the theme Peloponnesian War' })).toBeVisible();
  await themes.getByRole('button', { name: 'Add a theme' }).click();
  const form = themes.getByTestId('theme-form');
  await form.getByLabel('Theme').fill('Building program');
  await form.getByRole('checkbox').first().check();
  await form.getByRole('button', { name: 'Add theme' }).click();
  await expect(themes.getByRole('button', { name: 'Edit the theme Building program' })).toContainText('1 highlight');
  await expect(themes.getByLabel('Where on the map')).toHaveValue('');
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Its chip sits on the era's wash in the overview; clicking it opens the era's lanes with the theme picked.
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline).toHaveAttribute('data-settled', '');
  const chip = timeline.locator('text.tl-chip-label', { hasText: 'Building program' }).first();
  await scrollToMark(timeline, chip);
  await chip.click({ force: true }); // the timeline hit-tests by position
  await expect(timeline).toHaveAttribute('data-open', 'i_classical');
  await scrollToMark(timeline, timeline.locator('text.tl-era-head', { hasText: 'Classical Greece' }));
  await expect(timeline.locator('rect.tl-chip.picked')).toHaveAttribute('data-id', /^theme:i_classical:/);
  await expect(timeline.locator('.dimmed').first()).toBeAttached();

  // The map tints Greece in the year's era as it plays.
  const map = page.locator('[data-testid=map][data-ready]');
  await expect(map).toBeAttached({ timeout: 20_000 });
  const year = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await year.fill('500 BCE');
  await year.press('Enter');
  await expect(map).toHaveAttribute('data-eras', /^Archaic Greece/);
  await page.getByRole('button', { name: 'Play through time' }).click();
  await expect(map).toHaveAttribute('data-eras', /^Classical Greece/, { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-eras', /^Hellenistic period/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('Athens’ threads: a ribbon to Macedon with its count, all threads faintly, a ribbon’s list; then Aristotle’s thread plays on the map', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => { try { localStorage.setItem('chronicle.speed', '100'); } catch { /* fine */ } });
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles(fileURLToPath(new URL('../tests/fixtures/greece/classical-greece.json', import.meta.url)));
  await expect(page.locator('.doc-title')).toHaveValue(/Classical Greece/);
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await expect(timeline).toHaveAttribute('data-settled', '');
  const group = timeline.locator('.tl-strip[data-id="grp:g_classical_greece"]');
  await scrollToMark(timeline, group);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  await expect(athens).toBeVisible();
  await scrollToMark(timeline, athens);

  // Hovering Athens lights up its threads: one ribbon to Macedon, labelled with its count and main effect.
  const hoverAthens = async () => { const a = (await athens.boundingBox())!; await page.mouse.move(a.x + a.width * 0.45, a.y + a.height / 2); };
  await hoverAthens();
  const ribbon = timeline.locator('path.tl-ribbon[data-id="__thread:pol:t_athens|pol:t_macedon"]');
  await expect(ribbon).toHaveClass(/focus/);
  const label = timeline.locator('text.tl-thread-label', { hasText: '3 · influenced' });
  await expect(label).toBeVisible();

  // "Show all threads": every ribbon, faintly, with nothing in focus.
  const toggle = page.getByTestId('time-bar').getByRole('button', { name: 'Show all threads' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline.locator('path.tl-ribbon').first()).toBeAttached();
  await expect(timeline.locator('path.tl-ribbon.focus')).toHaveCount(0);

  // Hover Athens again and click its ribbon's label: its connections, with their effects.
  await hoverAthens();
  await expect(label).toBeVisible();
  const l = (await label.boundingBox())!;
  await page.mouse.move(l.x + l.width / 2, l.y + l.height / 2);
  await page.mouse.click(l.x + l.width / 2, l.y + l.height / 2);
  const list = page.getByTestId('thread-view');
  await expect(list.getByRole('heading')).toContainText('Macedon');
  await expect(list.getByTestId('thread-link')).toHaveCount(3);
  await expect(list.getByTestId('thread-link').filter({ hasText: 'Isocrates' })).toContainText('Isocrates legitimised Philip II of Macedon');
  await list.getByRole('button', { name: /Aristotle influenced Alexander/ }).click();
  await expect(page.getByTestId('relation-view')).toContainText('tutored him at Mieza');

  // Focus Aristotle and play the map: Athens → Alexandria draws in, long before Baghdad → Toledo.
  await openFromSearch(page, 'Aristotle');
  await expect(page.getByTestId('item-view').getByRole('heading', { name: 'Aristotle' })).toBeVisible();
  const map = page.locator('[data-testid=map][data-ready]');
  await expect(map).toBeAttached({ timeout: 20_000 });
  const year = page.getByTestId('yearbar').getByLabel('Year', { exact: true });
  await year.fill('300 BCE');
  await year.press('Enter');
  await expect(map).not.toHaveAttribute('data-arcs', /Alexandria/);
  await page.getByRole('button', { name: 'Play through time' }).click();
  await expect(map).toHaveAttribute('data-arcs', /Athens → Alexandria/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(map).not.toHaveAttribute('data-arcs', /Baghdad → Toledo/);
  await year.fill('1100');
  await year.press('Enter');
  await expect(map).toHaveAttribute('data-arcs', /Alexandria → Baghdad/);
  await expect(map).not.toHaveAttribute('data-arcs', /Baghdad → Toledo/);
  await page.getByRole('button', { name: 'Play through time' }).click();
  await expect(map).toHaveAttribute('data-arcs', /Athens → Alexandria \| .*Baghdad → Toledo/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
});

/** A small doc for lenses, regions, strength and groups: Athens and Sparta in Greece, Megara drawn by hand with no region yet. */
function lensDoc() {
  const square = (lon: number, lat: number, d: number) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
  const t = (id: string, title: string, region: string | undefined, lon: number, lat: number, d: number, areaKm2: number) =>
    ({ id, title, categoryId: 'c_pol', ...(region ? { region } : {}), snapshots: [{ from: { y: -500 }, to: { y: -300 }, geometry: square(lon, lat, d), areaKm2 }], updatedAt: 1 });
  return {
    schemaVersion: 9, id: 'd_lens', title: 'Lens test', updatedAt: 1, deleted: {},
    categories: [{ id: 'c_pol', label: 'Politics', color: '#3b5b92' }],
    items: [
      { id: 'i_classical', kind: 'span', subject: 'period', title: 'Classical Greece', region: 'Greece', start: { y: -479 }, end: { y: -322 }, categoryId: 'c_pol', updatedAt: 1 },
      { id: 'i_war', kind: 'span', subject: 'war', title: 'Peloponnesian War', lanes: ['war'], start: { y: -430 }, end: { y: -403 }, categoryId: 'c_pol', updatedAt: 1 },
    ],
    territories: [
      t('t_athens', 'Athens', 'Greece', 23.7, 38.0, 0.4, 2500),
      t('t_sparta', 'Sparta', 'Greece', 22.4, 37.1, 0.9, 8500),
      t('t_megara', 'Megara', undefined, 23.35, 38.0, 0.1, 470),
    ],
    relations: [{ id: 'r_war', fromId: 'i_war', toId: 't_athens', type: 'part-of', updatedAt: 1 }],
    series: [], flows: [], notes: [], sources: [], highlights: [], groups: [],
  };
}

test('lenses, regions, strength and groups: the War lens ticks, Megara moves into Greece, Athens grows, a group folds and stays open', async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.getByTestId('import-input').setInputFiles({ name: 'lens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lensDoc())) });
  await expect(page.locator('.doc-title')).toHaveValue('Lens test');
  const timeline = page.locator('[data-testid=timeline][data-ready]');
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline).toHaveAttribute('data-settled', '');

  // The War lens: a strip under each band with a tick for the war, in Greece.
  const lenses = page.getByRole('group', { name: 'Lenses' });
  await expect(timeline.locator('.tl-lens-tick')).toHaveCount(0);
  await lenses.getByRole('button', { name: 'War' }).click();
  await expect(lenses.getByRole('button', { name: 'War' })).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline.locator('.tl-lens-tick[data-id="i_war"]')).toHaveCount(1);
  await expect(timeline.locator('rect.tl-lens')).toHaveCount(2);

  // Megara, drawn by hand, is in Elsewhere until it's given a region.
  await expect(timeline.locator('text.tl-region', { hasText: 'Elsewhere' })).toHaveCount(1);
  await openFromSearch(page, 'Megara');
  const view = page.getByTestId('territory-view');
  await expect(view.getByTestId('territory-region')).toContainText('Elsewhere');
  await view.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('territory-editor');
  await editor.getByLabel('Region').fill('Greece');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(view.getByTestId('territory-region')).toContainText('Greece');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline.locator('text.tl-region', { hasText: 'Elsewhere' })).toHaveCount(0);
  await expect(timeline.locator('rect.tl-lens')).toHaveCount(1);

  // Athens, a sliver beside Sparta, at strength 5 fills its row.
  const athens = timeline.locator('.tl-strip[data-id="pol:t_athens"]');
  const before = (await athens.boundingBox())!.height;
  await openFromSearch(page, 'Athens');
  await view.getByRole('button', { name: 'Edit' }).click();
  await editor.getByRole('button', { name: 'Add a strength' }).click();
  const point = editor.getByRole('group', { name: 'Strength 1' });
  await point.getByLabel('At').fill('450 BCE');
  await point.getByLabel('Strength').selectOption('5');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(view).toContainText('450 BCE: 5 · dominant');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect.poll(async () => (await athens.boundingBox())!.height).toBeGreaterThan(before * 1.5);

  // A group of Athens and Megara folds into one strip; unfolded, it stays open after a reload.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByTestId('library').getByRole('tab', { name: 'Regions and groups' }).click();
  const tab = page.getByTestId('regions-tab');
  await tab.getByLabel('Greece is part of').fill('Mediterranean');
  await tab.getByLabel('Greece is part of').press('Enter');
  await tab.getByRole('button', { name: 'New group' }).click();
  const form = page.getByTestId('group-form');
  await form.getByLabel('Group name').fill('Saronic Gulf');
  await form.getByRole('checkbox', { name: /Athens/ }).check();
  await form.getByRole('checkbox', { name: /Megara/ }).check();
  await form.getByRole('button', { name: 'Add group' }).click();
  await expect(tab.getByRole('button', { name: 'Edit the group Saronic Gulf' })).toContainText('Athens, Megara');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline.locator('text.tl-parent', { hasText: /Mediterranean/i })).toHaveCount(1);
  const group = timeline.locator('.tl-strip[data-id^="grp:"]');
  await expect(group).toHaveCount(1);
  await expect(athens).toHaveCount(0);
  await group.click({ position: { x: 30, y: 6 }, force: true });
  await expect(athens).toHaveCount(1);
  await page.reload();
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline).toHaveAttribute('data-settled', '');
  await expect(athens).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Lenses' }).getByRole('button', { name: 'War' })).toHaveAttribute('aria-pressed', 'true');
});

test('Bob renames a region in the Library and its band takes the new name, then Undo puts it back', async ({ page }) => {
  const timeline = await openGreece(page, false);
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  await expect(timeline.locator('text.tl-region', { hasText: /^Macedon$/i })).toHaveCount(1);

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByTestId('library').getByRole('tab', { name: 'Regions and groups' }).click();
  const row = page.getByTestId('regions-tab').getByRole('listitem', { name: 'Macedon' });
  await expect(row).toContainText('1 territory');
  await row.getByRole('button', { name: 'Rename Macedon' }).click();
  await row.getByLabel('New name for Macedon').fill('Macedonia');
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByTestId('regions-tab').getByRole('listitem', { name: 'Macedonia' })).toBeVisible();
  await expect(page.getByTestId('bulk-note')).toHaveText(/Renamed Macedon to Macedonia\./);

  await expect(timeline.locator('text.tl-region', { hasText: /^Macedonia$/i })).toHaveCount(1);
  await expect(timeline.locator('text.tl-region', { hasText: /^Macedon$/i })).toHaveCount(0);
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  await expect(timeline.locator('text.tl-region', { hasText: /^Macedon$/i })).toHaveCount(1);
  await expect(page.getByTestId('regions-tab').getByRole('listitem', { name: 'Macedon' })).toBeVisible();
  await expect(page.getByTestId('regions-tab').getByRole('listitem', { name: 'Macedonia' })).toHaveCount(0);
});

test('Bob moves the bands himself: from a band’s menu, by dragging its name and with the arrow keys, kept after a reload, then back to automatic order', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1400, height: 1800 });
  const timeline = await openGreece(page, false);
  await page.getByTestId('time-bar').getByRole('button', { name: 'All', exact: true }).click();
  const names = timeline.locator('.tl-band-name');
  const order = () => names.evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.region));
  const head = (r: string) => timeline.locator(`.tl-band-name[data-region="${r}"]`);
  const menu = page.getByTestId('region-menu');
  await expect.poll(order).toEqual(['Italy', 'Macedon', 'Greece']);

  // The menu, right on the band's name.
  await head('Macedon').click();
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Back to automatic order' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(order).toEqual(['Macedon', 'Italy', 'Greece']);
  await expect(page.getByTestId('bulk-note')).toHaveText(/Moved Macedon\./);

  // The arrow keys on its name.
  await head('Macedon').focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(order).toEqual(['Italy', 'Macedon', 'Greece']);
  await expect(head('Macedon')).toBeFocused();

  // Dragging a name up past the others; they make room, and it snaps into place.
  await expect(timeline).toHaveAttribute('data-settled', '');
  const from = (await head('Greece').boundingBox())!, to = (await head('Italy').boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y - 10, { steps: 4 });
  await page.mouse.move(from.x + 20, to.y - 30, { steps: 12 });
  await expect(timeline).toHaveAttribute('data-dragging', 'Greece');
  await page.mouse.up();
  await expect.poll(order).toEqual(['Greece', 'Italy', 'Macedon']);
  await expect(menu).toHaveCount(0);

  // Esc mid-drag puts the band back, and letting go opens no menu.
  await expect(timeline).toHaveAttribute('data-settled', '');
  const it = (await head('Italy').boundingBox())!;
  await page.mouse.move(it.x + 20, it.y + it.height / 2);
  await page.mouse.down();
  await page.mouse.move(it.x + 20, it.y - 80, { steps: 10 });
  await expect(timeline).toHaveAttribute('data-dragging', 'Italy');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(menu).toHaveCount(0);
  await expect.poll(order).toEqual(['Greece', 'Italy', 'Macedon']);

  // Kept after a reload.
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('[data-testid=timeline][data-ready]')).toBeVisible();
  await expect.poll(order).toEqual(['Greece', 'Italy', 'Macedon']);

  // Rename from the menu, with Undo.
  await head('Italy').click();
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  await menu.getByLabel('New name for Italy').fill('Magna Graecia');
  await menu.getByRole('button', { name: 'Rename' }).click();
  await expect.poll(order).toEqual(['Greece', 'Magna Graecia', 'Macedon']);
  await page.getByTestId('bulk-note').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(order).toEqual(['Greece', 'Italy', 'Macedon']);

  // Esc closes the menu; Back to automatic order puts every band back.
  await head('Greece').click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(head('Greece')).toBeFocused();
  await head('Greece').click();
  await menu.getByRole('menuitem', { name: 'Back to automatic order' }).click();
  await expect.poll(order).toEqual(['Italy', 'Macedon', 'Greece']);
});
