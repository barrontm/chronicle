import { toDecimalYear } from '../model/dates';
import type { TimelineItem } from '../model/types';

/**
 * Moving through time: the zoom bar's scale, zooming around a point, and the
 * window that frames an entry with its connections. Pure, in decimal years.
 */

export interface YearWindow { start: number; end: number }

/** The closest and widest the timeline zooms: a week, and 12,000 years. */
export const ZOOM_MIN_YEARS = 7 / 365.25;
export const ZOOM_MAX_YEARS = 12_000;
/** The timeline's outer limits. */
export const TIME_MIN = -12_000;
export const TIME_MAX = 2200;

/** How far the window may go: the classic timeline's limits, or deep time for the new renderer. */
export interface TimeLimits { min: number; max: number; minSpan: number; maxSpan: number }
export const CLASSIC_LIMITS: TimeLimits = { min: TIME_MIN, max: TIME_MAX, minSpan: ZOOM_MIN_YEARS, maxSpan: ZOOM_MAX_YEARS };
export const DEEP_LIMITS: TimeLimits = { min: -3_200_000, max: TIME_MAX, minSpan: ZOOM_MIN_YEARS, maxSpan: TIME_MAX + 3_200_000 };

export const ZOOM_STOPS = [
  { label: 'Year', years: 1 },
  { label: 'Decade', years: 10 },
  { label: 'Century', years: 100 },
  { label: 'Millennium', years: 1000 },
] as const;

/** The zoom slider runs 0 (widest) to SLIDER_MAX (closest) on a log scale. */
export const SLIDER_MAX = 1000;
const LOG_MIN = Math.log(ZOOM_MIN_YEARS);
const LOG_MAX = Math.log(ZOOM_MAX_YEARS);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function spanToSlider(years: number): number {
  const t = (LOG_MAX - Math.log(clamp(years, ZOOM_MIN_YEARS, ZOOM_MAX_YEARS))) / (LOG_MAX - LOG_MIN);
  return Math.round(t * SLIDER_MAX);
}

export function sliderToSpan(value: number): number {
  const t = clamp(value, 0, SLIDER_MAX) / SLIDER_MAX;
  return Math.exp(LOG_MAX - t * (LOG_MAX - LOG_MIN));
}

/** A window of `span` years around `center`, kept within the timeline's limits. */
export function windowAround(center: number, span: number, l = CLASSIC_LIMITS): YearWindow {
  const s = clamp(span, l.minSpan, l.maxSpan);
  const start = clamp(center - s / 2, l.min, l.max - s);
  return { start, end: start + s };
}

/**
 * Zoom by `factor` (2 = twice as many years in view) around `at`, which keeps
 * its place on screen: the middle by default, or the point under the pointer.
 */
export function zoomAround(w: YearWindow, factor: number, at = (w.start + w.end) / 2, l = CLASSIC_LIMITS): YearWindow {
  const span = w.end - w.start;
  const next = clamp(span * factor, l.minSpan, l.maxSpan);
  const frac = span > 0 ? (at - w.start) / span : 0.5;
  const start = clamp(at - frac * next, l.min, l.max - next);
  return { start, end: start + next };
}

/** Move the window by `years` without changing the zoom. */
export function panBy(w: YearWindow, years: number, l = CLASSIC_LIMITS): YearWindow {
  const span = w.end - w.start;
  const start = clamp(w.start + years, l.min, l.max - span);
  return { start, end: start + span };
}

/** An entry's dates in decimal years; a living person, or an event, ends where it is. */
function extent(item: TimelineItem, now: number): YearWindow {
  const start = toDecimalYear(item.start);
  if (item.kind === 'event') return { start, end: start };
  return { start, end: item.end ? toDecimalYear(item.end) : now };
}

/** The narrowest window that still shows an event with some context around it. */
const MIN_FOCUS_YEARS = 20;
/** Connected entries are left out of the frame when they'd shrink the entry itself to a sliver. */
const MAX_CONTEXT_FACTOR = 6;

/**
 * The window that frames an entry: its own dates and those of its connected
 * entries, with a margin either side. When the connections reach so far that
 * the entry would be a sliver, it frames the entry alone.
 */
export function focusWindow(item: TimelineItem, connected: TimelineItem[], now = new Date().getUTCFullYear()): YearWindow {
  const own = extent(item, now);
  const ownSpan = Math.max(own.end - own.start, MIN_FOCUS_YEARS);
  let { start, end } = own;
  for (const c of connected) {
    const e = extent(c, now);
    start = Math.min(start, e.start);
    end = Math.max(end, e.end);
  }
  if (end - start > ownSpan * MAX_CONTEXT_FACTOR) ({ start, end } = own);
  const span = end - start;
  const padded = Math.max(span * 1.2, MIN_FOCUS_YEARS);
  return windowAround((start + end) / 2, padded);
}

/** How much time is in view, in words: "3 months", "120 years". */
export function spanLabel(years: number): string {
  if (years < 1 / 12 * 1.5) {
    const weeks = Math.max(1, Math.round(years * 52.18));
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  }
  if (years < 1.5) {
    const months = Math.round(years * 12);
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const rounded = years < 20 ? Math.round(years) : Number(years.toPrecision(2));
  return `${rounded.toLocaleString('en-US')} years`;
}

/** The zoom stop the window is closest to, if it's within a quarter of it. */
export function currentStop(years: number): string | undefined {
  return ZOOM_STOPS.find((s) => years >= s.years * 0.75 && years <= s.years * 1.25)?.label;
}
