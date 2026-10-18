import { toDecimalYear } from './dates';
import type { SeriesPoint, Territory, TerritorySnapshot, TimelineDoc, TimelineItem } from './types';

/**
 * "What does the world look like in year X?" Pure queries the map uses as the
 * current year moves. Years are decimal astronomical years.
 */

/** The snapshot in effect: from ≤ year < to. If several overlap, the latest-starting wins. */
export function snapshotAt(t: Territory, year: number): TerritorySnapshot | undefined {
  let best: TerritorySnapshot | undefined;
  for (const s of t.snapshots) {
    const from = toDecimalYear(s.from);
    if (from > year) continue;
    if (s.to && year >= toDecimalYear(s.to)) continue;
    if (!best || from > toDecimalYear(best.from)) best = s;
  }
  return best;
}

/** Linear interpolation between known points; undefined outside the measured range (no guessing). */
export function valueAt(points: SeriesPoint[], year: number): number | undefined {
  if (!points.length) return undefined;
  const pts = points[0].x <= points[points.length - 1].x ? points : [...points].sort((a, b) => a.x - b.x);
  if (year < pts[0].x || year > pts[pts.length - 1].x) return undefined;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (year >= a.x && year <= b.x) return b.x === a.x ? b.v : a.v + ((b.v - a.v) * (year - a.x)) / (b.x - a.x);
  }
  return pts[pts.length - 1].v;
}

/**
 * How strongly to show an entry on the map in `year`, from 0 (hidden) to 1.
 *  - periods and lifespans: fully shown while they last
 *  - events: shown when they happen, fading out over `fadeYears`
 *  - keepPast: things that are over stay on the map, dimmed, so you can watch
 *    something spread (printing presses, railways…)
 *  - places: fade in over `fadeYears` from their founding and out over
 *    `fadeYears` after they were abandoned; one with no founding date is
 *    there from the start
 */
export function presenceAt(item: TimelineItem, year: number, fadeYears: number, keepPast = false, now = new Date().getUTCFullYear()): number {
  if (item.subject === 'place') return placePresence(item, year, fadeYears, keepPast);
  if (!item.start) return 0;
  const start = toDecimalYear(item.start);
  // A whole year counts: on 1 Jan 1215 the map still shows what happened in June 1215.
  if (year < Math.floor(start)) return 0;
  if (item.kind === 'event') {
    const since = Math.max(0, year - start);
    if (since <= fadeYears) return 1 - 0.6 * (since / Math.max(fadeYears, 1e-9));
    return keepPast ? 0.4 : 0;
  }
  const end = item.end ? toDecimalYear(item.end) + 1 : now + 1;
  if (year < end) return 1;
  return keepPast ? 0.4 : 0;
}

/** A place's pin: faint in its founding year, full after `fadeYears`; after it was abandoned, gone (or dimmed) after `fadeYears`. */
function placePresence(item: TimelineItem, year: number, fadeYears: number, keepPast: boolean): number {
  const fade = Math.max(fadeYears, 1e-9);
  const from = item.start ? Math.floor(toDecimalYear(item.start)) : -Infinity;
  if (year < from) return 0;
  const rise = Math.min(1, FOUNDED + (1 - FOUNDED) * ((year - from) / fade));
  if (!item.end) return rise;
  const gone = Math.max(0, year - (Math.floor(toDecimalYear(item.end)) + 1));
  const floor = keepPast ? 0.4 : 0;
  return Math.min(rise, Math.max(floor, 1 - gone / fade));
}
/** How strongly a place shows in the year it was founded. */
const FOUNDED = 0.3;

/** Earliest and latest years mentioned anywhere in the doc, for the year slider. */
export function docYearRange(doc: TimelineDoc): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const see = (y: number) => {
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  };
  for (const i of doc.items) {
    if (i.start) see(i.start.y);
    if (i.end) see(i.end.y);
  }
  for (const t of doc.territories) for (const s of t.snapshots) {
    see(s.from.y);
    if (s.to) see(s.to.y);
  }
  for (const s of doc.series) {
    for (const p of s.points) see(p.x);
    for (const pts of Object.values(s.regions ?? {})) for (const p of pts) see(p.x);
  }
  for (const f of doc.flows ?? []) for (const r of f.routes) for (const p of r.points) see(p.x);
  return lo <= hi ? [Math.floor(lo), Math.ceil(hi)] : null;
}

/** Min and max over all regional values of a series (the color scale stays fixed as the year moves). */
export function regionExtent(regions: Record<string, SeriesPoint[]>, keys?: (k: string) => boolean): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [k, pts] of Object.entries(regions)) {
    if (keys && !keys(k)) continue;
    for (const p of pts) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
