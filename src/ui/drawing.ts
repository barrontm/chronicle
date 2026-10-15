import type { FeatureCollection, Position } from 'geojson';
import type { Area } from '../data/geo';

/**
 * Drawing a border by hand: click points to outline a part, close it, and
 * optionally add more parts (islands). Pure, so MapView only forwards clicks.
 * Coordinates are [lon, lat], rounded to 4 decimals (about 10 m).
 */
export interface Draft {
  /** Closed parts, each an open ring (first point not repeated). */
  done: Position[][];
  /** The part being drawn. */
  current: Position[];
}

export const EMPTY_DRAFT: Draft = { done: [], current: [] };

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function addPoint(d: Draft, p: Position): Draft {
  return { ...d, current: [...d.current, [round(p[0]), round(p[1])]] };
}

/** Remove the last point; with none left, reopen the last closed part. */
export function undo(d: Draft): Draft {
  if (d.current.length) return { ...d, current: d.current.slice(0, -1) };
  if (d.done.length) return { done: d.done.slice(0, -1), current: d.done.at(-1)! };
  return d;
}

/** Close the current part (needs at least 3 points) so another can be started. */
export function closePart(d: Draft): Draft {
  return d.current.length >= 3 ? { done: [...d.done, d.current], current: [] } : d;
}

const parts = (d: Draft) => (d.current.length >= 3 ? [...d.done, d.current] : d.done);

export const canFinish = (d: Draft) => parts(d).length > 0;

const ring = (pts: Position[]) => [...pts, pts[0]];

/** The finished shape: a Polygon for one part, a MultiPolygon for several; null if nothing is closed. */
export function toGeometry(d: Draft): Area | null {
  const ps = parts(d);
  if (!ps.length) return null;
  return ps.length === 1
    ? { type: 'Polygon', coordinates: [ring(ps[0])] }
    : { type: 'MultiPolygon', coordinates: ps.map((p) => [ring(p)]) };
}

/** What the map shows while drawing: filled parts, the open outline, and the current part's points. */
export function draftFeatures(d: Draft): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...parts(d).map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring(p)] } })),
      ...(d.current.length >= 2 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: d.current } }] : []),
      ...d.current.map((c, i) => ({ type: 'Feature' as const, properties: { first: i === 0 }, geometry: { type: 'Point' as const, coordinates: c } })),
    ],
  };
}
