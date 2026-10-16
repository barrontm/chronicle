/**
 * Keeping names readable when zoomed out. A period or a life drawn narrower
 * than its name lets the name run on past the bar (vis-timeline then reserves
 * room for it, so names don't overlap). Wide bars keep their name inside, so
 * zooming in doesn't spread the layout out. Pure, so it can be tested.
 */

/** Padding plus the round thumbnail, in pixels, around a label's text. */
const PAD = 16;
const THUMB = 28;

/** How wide an item's label is drawn, given a way to measure its text. */
export function labelWidthPx(title: string, hasThumb: boolean, measure: (text: string) => number): number {
  return Math.ceil(measure(title)) + PAD + (hasThumb ? THUMB : 0);
}

/** How wide a range from `start` to `end` is drawn in the visible window, in pixels. */
export function rangeWidthPx(start: number, end: number, win: { start: number; end: number }, panelPx: number): number {
  const span = win.end - win.start;
  return span > 0 ? ((end - start) / span) * panelPx : 0;
}

/** Room left between a pulled-in name and the right edge, which also absorbs small measuring errors. */
const EDGE = 8;

/**
 * The bars too narrow for their names, each with how far (in pixels) to pull
 * its name left so it isn't cut off by the right edge of the timeline. Zero
 * when the name fits. A name never moves past the left edge either.
 */
export function narrowLabels(
  ranges: Array<{ id: string; start: number; end: number; labelPx: number }>,
  win: { start: number; end: number },
  panelPx: number,
): Map<string, number> {
  const span = win.end - win.start;
  const out = new Map<string, number>();
  if (span <= 0) return out;
  for (const r of ranges) {
    if (rangeWidthPx(r.start, r.end, win, panelPx) >= r.labelPx) continue;
    // vis-timeline keeps a name on screen when its bar starts off the left edge.
    const startPx = Math.max(0, ((r.start - win.start) / span) * panelPx);
    const over = startPx + r.labelPx - (panelPx - EDGE);
    out.set(r.id, Math.round(Math.min(startPx, over > 0 ? over : 0)));
  }
  return out;
}

/** Year labels need at least this much room on the axis. */
export const AXIS_LABEL_PX = 72;

/**
 * Label only every n-th tick when ticks are too close for their labels, as on
 * a phone zoomed all the way out. n is 1, 2, 5 or 10 (times more as needed),
 * so labels stay on round years.
 */
export function axisLabelEvery(stepYears: number, pxPerYear: number, minPx = AXIS_LABEL_PX): number {
  const gap = stepYears * pxPerYear;
  if (!(gap > 0) || gap >= minPx) return 1;
  for (let scale = 1; ; scale *= 10) {
    for (const n of [2, 5, 10]) if (gap * n * scale >= minPx) return n * scale;
  }
}

/**
 * vis-timeline's biggest automatic axis step is 1000 years; past that it falls
 * back to days and piles thousands of labels in one spot (a phone zoomed all
 * the way out). Returns a bigger round step in years when 1000 is too tight,
 * or undefined to let vis-timeline choose.
 */
export function axisStepYears(pxPerYear: number, minPx = AXIS_LABEL_PX): number | undefined {
  if (!(pxPerYear > 0)) return undefined;
  const need = minPx / pxPerYear;
  if (need <= 1000) return undefined;
  for (let scale = 1000; ; scale *= 10) {
    for (const n of [2, 5, 10]) if (n * scale >= need) return n * scale;
  }
}
