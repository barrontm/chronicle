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

/* ---------- changing a border's points ---------- */

/** A point of a shape: its part (0 for a Polygon), its ring (0 the outline, then holes), and its place in the ring. */
export interface Vertex { part: number; ring: number; i: number }

const partsOf = (g: Area): Position[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/** A ring's points without the closing repeat. */
const openRing = (r: Position[]) => (r.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r);

function editRing(g: Area, v: Vertex, f: (pts: Position[]) => Position[]): Area {
  const ps = partsOf(g).map((poly, pi) => (pi !== v.part ? poly : poly.map((r, ri) => (ri !== v.ring ? r : ring(f(openRing(r)))))));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: ps[0] } : { type: 'MultiPolygon', coordinates: ps };
}

export const moveVertex = (g: Area, v: Vertex, p: Position): Area => editRing(g, v, (pts) => pts.map((q, i) => (i === v.i ? [round(p[0]), round(p[1])] : q)));

/** Add a point on the edge after `v`; it becomes `{ ...v, i: v.i + 1 }`. */
export const insertVertex = (g: Area, v: Vertex, p: Position): Area => editRing(g, v, (pts) => [...pts.slice(0, v.i + 1), [round(p[0]), round(p[1])], ...pts.slice(v.i + 1)]);

/** A ring keeps at least three points. */
export const canDelete = (g: Area, v: Vertex) => openRing(partsOf(g)[v.part]?.[v.ring] ?? []).length > 3;

export const deleteVertex = (g: Area, v: Vertex): Area => (canDelete(g, v) ? editRing(g, v, (pts) => pts.filter((_, i) => i !== v.i)) : g);

/**
 * What the map shows while a border is being changed: the shape, its points (the picked one
 * marked), and a dot halfway along each edge to drag a new point out of. Edges shorter than
 * `minEdge` degrees get no dot, so a detailed border isn't buried in them when zoomed out.
 */
export function shapeFeatures(g: Area, picked?: Vertex, minEdge = 0): FeatureCollection {
  const features: FeatureCollection['features'] = [{ type: 'Feature', properties: {}, geometry: g }];
  partsOf(g).forEach((poly, part) => poly.forEach((r, ri) => {
    const pts = openRing(r);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const at = { part, ring: ri, i };
      features.push({ type: 'Feature', properties: { ...at, handle: 'point', picked: !!picked && picked.part === part && picked.ring === ri && picked.i === i }, geometry: { type: 'Point', coordinates: p } });
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= minEdge) features.push({ type: 'Feature', properties: { ...at, handle: 'mid' }, geometry: { type: 'Point', coordinates: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] } });
    });
  }));
  return { type: 'FeatureCollection', features };
}
