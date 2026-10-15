import type { MultiPolygon, Polygon, Position } from 'geojson';

/**
 * Small, dependency-free geometry helpers for territories: simplification
 * (so imported borders stay small in backups), area and a label point.
 * Coordinates are [lon, lat] degrees, as in GeoJSON.
 */

export type Area = Polygon | MultiPolygon;

function perpDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy));
}

/** Douglas–Peucker. Keeps the first and last points. Iterative, so long coastlines don't overflow the stack. */
export function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Simplify a closed ring; returns null if it collapses below a triangle. */
function simplifyRing(ring: Position[], tolerance: number, decimals: number): Position[] | null {
  const out = simplifyLine(ring, tolerance).map((p) => [round(p[0], decimals), round(p[1], decimals)]);
  // Drop consecutive duplicates created by rounding.
  const dedup = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
  if (dedup.length < 4) return null;
  const [f, l] = [dedup[0], dedup[dedup.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) dedup.push([f[0], f[1]]);
  return dedup;
}

/**
 * Simplify a Polygon or MultiPolygon. Islands and holes that collapse are
 * dropped; returns null if nothing is left.
 */
export function simplifyArea(g: Area, tolerance = 0.05, decimals = 3): Area | null {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out: Position[][][] = [];
  for (const poly of polys) {
    const outer = poly[0] && simplifyRing(poly[0], tolerance, decimals);
    if (!outer) continue;
    const holes = poly.slice(1).map((h) => simplifyRing(h, tolerance, decimals)).filter((h): h is Position[] => !!h);
    out.push([outer, ...holes]);
  }
  if (!out.length) return null;
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Spherical area of a ring in km² (absolute value; orientation-agnostic). */
export function ringAreaKm2(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    sum += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

export function areaKm2(g: Area): number {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.reduce((total, poly) => total + ringAreaKm2(poly[0] ?? []) - poly.slice(1).reduce((h, r) => h + ringAreaKm2(r), 0), 0);
}

/** Planar centroid of a ring (degrees). Good enough for placing a label. */
function ringCentroid(ring: Position[]): Position {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (a === 0) return ring[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** A label point: the centroid of the largest piece (so an empire's label isn't placed on a far-off island). */
export function labelPoint(g: Area): { lon: number; lat: number } {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = polys[0];
  let bestArea = -1;
  for (const p of polys) {
    const a = ringAreaKm2(p[0] ?? []);
    if (a > bestArea) { bestArea = a; best = p; }
  }
  const [lon, lat] = ringCentroid(best[0]);
  return { lon, lat };
}

/** [west, south, east, north] */
export function bbox(g: Area): [number, number, number, number] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0] ?? []) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function isArea(g: unknown): g is Area {
  const t = (g as { type?: string })?.type;
  return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray((g as { coordinates?: unknown }).coordinates);
}

/** Simplification for borders Bob brings in himself: fine enough (about 100 m) to keep small city-states and islands. */
export const FINE = { tolerance: 0.001, decimals: 4 };

/**
 * The areas in a GeoJSON file (FeatureCollection, Feature or bare geometry),
 * named from a `name`, `NAME` or `title` property when there is one.
 * Throws a readable error if the file isn't GeoJSON or has no areas.
 */
export function parseGeoJsonAreas(text: string): Array<{ name?: string; geometry: Area }> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t valid GeoJSON.');
  }
  const t = (json as { type?: string })?.type;
  const features: Array<{ properties?: Record<string, unknown> | null; geometry?: unknown }> =
    t === 'FeatureCollection' ? ((json as { features?: [] }).features ?? [])
      : t === 'Feature' ? [json as { geometry?: unknown }]
        : [{ geometry: json }];
  const out: Array<{ name?: string; geometry: Area }> = [];
  for (const f of features) {
    if (!isArea(f?.geometry)) continue;
    const p = f.properties ?? {};
    const name = [p.name, p.NAME, p.title].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    out.push({ name: name?.trim(), geometry: f.geometry });
  }
  if (!out.length) throw new Error('No areas in this file. It needs polygons, not just points or lines.');
  return out;
}
