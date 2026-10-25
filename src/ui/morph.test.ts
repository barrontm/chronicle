import type { Polygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { areaKm2 } from '../data/geo';
import { morph, morphBetween } from './morph';

const poly = (pts: number[][], ...holes: number[][][]): Polygon => ({ type: 'Polygon', coordinates: [[...pts, pts[0]], ...holes.map((h) => [...h, h[0]])] });
const square = (x: number, y: number, s: number) => poly([[x, y], [x + s, y], [x + s, y + s], [x, y + s]]);
/** A rough circle with `n` corners. */
const round = (cx: number, cy: number, r: number, n: number) => poly(Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]));

const has = (ring: Position[], p: number[]) => ring.some((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9);

/** Edges of one closed ring that cross another edge of it. */
function crossings(ring: Position[]): number {
  const side = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let n = 0;
  for (let i = 0; i < ring.length - 1; i++) for (let j = i + 2; j < ring.length - 1; j++) {
    if (i === 0 && j === ring.length - 2) continue;
    const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if (side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0) n++;
  }
  return n;
}

describe('morph', () => {
  it('goes halfway between two borders with different numbers of corners', () => {
    const a = square(10, 40, 2), b = round(11, 41, 1.6, 9);
    const m = morph(a, b);
    const [start, mid, end] = [m(0), m(0.5), m(1)].map((g) => g.coordinates[0][0]);
    // The same points throughout, keeping every corner at both ends.
    expect(start.length).toBe(end.length);
    for (const p of a.coordinates[0]) expect(has(start, p)).toBe(true);
    for (const p of b.coordinates[0]) expect(has(end, p)).toBe(true);
    // Halfway, each point is halfway along its path.
    mid.forEach((p, i) => {
      expect(p[0]).toBeCloseTo((start[i][0] + end[i][0]) / 2, 9);
      expect(p[1]).toBeCloseTo((start[i][1] + end[i][1]) / 2, 9);
    });
    const [sa, sm, sb] = [m(0), m(0.5), m(1)].map(areaKm2);
    expect(sa).toBeCloseTo(areaKm2(a), -1);
    expect(sb).toBeCloseTo(areaKm2(b), -1);
    expect(sm).toBeGreaterThan(Math.min(sa, sb));
    expect(sm).toBeLessThan(Math.max(sa, sb));
  });

  it('never twists the outline on the way', () => {
    const a = square(20, 35, 3), b = poly([[20, 35], [24, 35], [24, 36], [21, 36], [21, 39], [20, 39]]);
    const m = morph(a, b);
    for (let s = 0; s <= 20; s++) expect(crossings(m(s / 20).coordinates[0][0])).toBe(0);
  });

  it('starts from the nearest point, whichever way round the rings were drawn', () => {
    const a = square(0, 0, 2);
    const b: Polygon = { type: 'Polygon', coordinates: [[...a.coordinates[0]].reverse().map(([x, y]) => [x + 0.1, y])] };
    const m = morph(a, b);
    const s = m(0).coordinates[0][0], e = m(1).coordinates[0][0];
    // Each point moves only the 0.1° shift, not across the shape.
    s.forEach((p, i) => expect(Math.hypot(e[i][0] - p[0], e[i][1] - p[1])).toBeLessThan(0.11));
  });

  it('shrinks a piece with no partner to its middle, and grows a new one out of its own', () => {
    const island = square(26, 37, 0.5), mainland = square(22, 37, 2);
    const m = morph({ type: 'MultiPolygon', coordinates: [mainland.coordinates, island.coordinates] }, mainland);
    const end = m(1).coordinates;
    expect(end).toHaveLength(2);
    const gone = end.find((p) => areaKm2({ type: 'Polygon', coordinates: p }) < 1)!;
    // It vanishes where it was, not into the mainland.
    for (const [x, y] of gone[0]) { expect(x).toBeCloseTo(26.25, 6); expect(y).toBeCloseTo(37.25, 6); }

    const back = morph(mainland, { type: 'MultiPolygon', coordinates: [mainland.coordinates, island.coordinates] });
    const born = back(0).coordinates.find((p) => areaKm2({ type: 'Polygon', coordinates: p }) < 1)!;
    for (const [x] of born[0]) expect(x).toBeCloseTo(26.25, 6);
    expect(areaKm2(back(1))).toBeCloseTo(areaKm2(mainland) + areaKm2(island), -1);
  });

  it('pairs holes, and closes one the new borders don’t have', () => {
    const lake = [[11, 41], [11, 41.5], [11.5, 41.5], [11.5, 41]];
    const withLake = poly([[10, 40], [13, 40], [13, 43], [10, 43]], lake);
    const m = morph(withLake, square(10, 40, 3));
    expect(m(0).coordinates[0]).toHaveLength(2);
    expect(areaKm2(m(0))).toBeCloseTo(areaKm2(withLake), -1);
    expect(areaKm2(m(1))).toBeCloseTo(areaKm2(square(10, 40, 3)), -1);
  });

  it('works each pair out once', () => {
    const a = square(0, 0, 1), b = square(0, 0, 2);
    expect(morphBetween(a, b)).toBe(morphBetween(a, b));
    expect(morphBetween(b, a)).not.toBe(morphBetween(a, b));
  });
});
