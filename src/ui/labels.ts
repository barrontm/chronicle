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

/** The ids whose bars are too narrow for their names. */
export function narrowIds(
  ranges: Array<{ id: string; start: number; end: number; labelPx: number }>,
  win: { start: number; end: number },
  panelPx: number,
): Set<string> {
  return new Set(ranges.filter((r) => rangeWidthPx(r.start, r.end, win, panelPx) < r.labelPx).map((r) => r.id));
}
