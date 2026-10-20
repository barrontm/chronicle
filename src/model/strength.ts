import { toDecimalYear } from './dates';
import type { Territory } from './types';

/**
 * How strong a polity was in a year, for the thickness of its strip on the overview
 * (docs/design.md, Overview). Bob's strength points win; otherwise the area of its borders in
 * that year; otherwise nothing is known.
 */
export type Strength =
  /** Bob's level, 1 to 5, in straight lines between his points. */
  | { by: 'points'; level: number }
  /** Its borders' area in km² that year, easing toward the next snapshot's. */
  | { by: 'area'; km2: number }
  | { by: 'none' };

/** A strip is never thinner than this share of its row, so a sliver can still be seen. */
export const MIN_SHARE = 0.08;
/** The even width of a polity whose strength isn't known. */
export const UNKNOWN_SHARE = 0.35;
/** Areas are compressed by this power, so a mid-sized kingdom isn't a hairline beside an empire. */
export const AREA_POWER = 0.4;
/** A change of borders eases in over at most this many years before the next snapshot. */
const RAMP_YEARS = 20;

export function strengthAt(t: Territory, year: number): Strength {
  const pts = t.strength ?? [];
  if (pts.length) {
    const at = pts.map((p) => toDecimalYear(p.at));
    if (year <= at[0]) return { by: 'points', level: pts[0].level };
    for (let i = 0; i < pts.length - 1; i++) {
      if (year > at[i + 1]) continue;
      const k = at[i + 1] > at[i] ? (year - at[i]) / (at[i + 1] - at[i]) : 1;
      return { by: 'points', level: pts[i].level + (pts[i + 1].level - pts[i].level) * k };
    }
    return { by: 'points', level: pts[pts.length - 1].level };
  }
  const snaps = t.snapshots.filter((s) => s.areaKm2 !== undefined);
  if (!snaps.length) return { by: 'none' };
  const from = snaps.map((s) => toDecimalYear(s.from));
  // The snapshot in force: the last one begun by this year (or the first, before any).
  let i = 0;
  while (i < snaps.length - 1 && from[i + 1] <= year) i++;
  const a = snaps[i].areaKm2!, next = snaps[i + 1];
  if (!next) return { by: 'area', km2: a };
  // Borders change smoothly into the next snapshot, so a strip doesn't jump.
  const ramp = Math.min(RAMP_YEARS, (from[i + 1] - from[i]) * 0.4);
  if (year < from[i + 1] - ramp) return { by: 'area', km2: a };
  const k = (year - (from[i + 1] - ramp)) / ramp;
  return { by: 'area', km2: a + (next.areaKm2! - a) * k };
}

/** What an area counts for before scaling: compressed, so the widest on screen can fill its row. */
export const areaWeight = (km2: number) => Math.pow(Math.max(0, km2), AREA_POWER);

/**
 * A strip's thickness as a share of its row: Bob's level ÷ 5; or its compressed area over the
 * widest in view (`widest`, an `areaWeight`); or the even width when nothing is known.
 */
export function stripShare(s: Strength, widest: number): number {
  if (s.by === 'points') return Math.max(MIN_SHARE, s.level / 5);
  if (s.by === 'area') return Math.max(MIN_SHARE, Math.min(1, areaWeight(s.km2) / Math.max(widest, 1e-9)));
  return UNKNOWN_SHARE;
}

/** Whether anything is known of its strength: points, or an area on any snapshot. */
export const strengthKnown = (t: Territory) => !!t.strength?.length || t.snapshots.some((s) => s.areaKm2 !== undefined);
