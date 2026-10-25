import type { MultiPolygon, Position } from 'geojson';
import type { Area } from '../data/geo';

/**
 * A border changing from one set of borders to the next (docs/decisions.md, "Spikes"). Every ring
 * gets the same number of points along its edges, keeping its corners, so the morph starts and
 * ends on the borders exactly as drawn; the second is turned to the start that fits the first
 * best, and each point moves in a straight line in lon/lat. Polygons are paired greedily by place
 * and size, and holes inside each pair the same way; a polygon or hole left over shrinks to its
 * middle, or grows out of it. No dependency: flubber twisted and took over a second on a phone.
 */
export type Morph = (t: number) => MultiPolygon;

type Pt = [number, number];
/** A ring without its closing point. */
type Ring = Pt[];
/** Its outline first, then its holes. */
type Poly = Ring[];

const signedArea = (r: Ring) => {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
};

function centroid(r: Ring): Pt {
  const A = signedArea(r);
  if (Math.abs(A) < 1e-12) { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }
  let cx = 0, cy = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n], k = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * k;
    cy += (a[1] + b[1]) * k;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

const open = (r: Position[]): Ring => {
  const out = r.map((p) => [p[0], p[1]] as Pt);
  const a = out[0], z = out.at(-1);
  if (out.length > 1 && a[0] === z![0] && a[1] === z![1]) out.pop();
  return out;
};

/** Polygons with open rings, outlines counter-clockwise and holes clockwise; rings with no area dropped. */
function polysOf(g: Area): Poly[] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys
    .map((p) => p.map(open).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-10).map((r, i) => ((signedArea(r) > 0) === (i === 0) ? r : [...r].reverse())))
    .filter((p) => p.length > 0);
}

/** How unlike two rings are: how far apart their middles are, plus how different their sizes (degrees). */
const cost = (a: Ring, b: Ring) => {
  const ca = centroid(a), cb = centroid(b);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) + Math.abs(Math.sqrt(Math.abs(signedArea(a))) - Math.sqrt(Math.abs(signedArea(b))));
};

function pairs(A: Ring[], B: Ring[]): Array<[number, number]> {
  const all: Array<[number, number, number]> = [];
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) all.push([cost(A[i], B[j]), i, j]);
  all.sort((x, y) => x[0] - y[0]);
  const ua = new Set<number>(), ub = new Set<number>(), out: Array<[number, number]> = [];
  for (const [, i, j] of all) if (!ua.has(i) && !ub.has(j)) { ua.add(i); ub.add(j); out.push([i, j]); }
  return out;
}

/** How many points a ring gets: twice the most corners, within [least, 512], and never fewer than its corners. */
const samples = (least: number, ...rs: Ring[]) => {
  const m = Math.max(...rs.map((r) => r.length));
  return Math.max(m, Math.min(512, Math.max(least, 2 * m)));
};

/** `n` points along a ring (n at least its corners): every corner, then the rest spread along the edges by length. */
function resample(r: Ring, n: number): Float64Array {
  const m = r.length;
  const len = r.map((a, i) => { const b = r[(i + 1) % m]; return Math.hypot(b[0] - a[0], b[1] - a[1]); });
  const L = len.reduce((s, x) => s + x, 0);
  const extra = n - m;
  const want = len.map((l) => (L > 0 ? (extra * l) / L : extra / m));
  const k = want.map(Math.floor);
  const order = want.map((w, i) => [w - k[i], i]).sort((a, b) => b[0] - a[0]);
  for (let left = extra - k.reduce((s, x) => s + x, 0), j = 0; left > 0; left--, j++) k[order[j % m][1]]++;
  const out = new Float64Array(n * 2);
  let o = 0;
  for (let i = 0; i < m; i++) {
    const a = r[i], b = r[(i + 1) % m], steps = k[i] + 1;
    for (let s = 0; s < steps; s++) { const u = s / steps; out[o++] = a[0] + (b[0] - a[0]) * u; out[o++] = a[1] + (b[1] - a[1]) * u; }
  }
  return out;
}

/** B turned to the start point that puts it closest to A, point by point. */
function align(A: Float64Array, B: Float64Array, n: number): Float64Array {
  let best = 0, bestSum = Infinity;
  for (let s = 0; s < n; s++) {
    let sum = 0;
    for (let i = 0; i < n && sum < bestSum; i++) {
      const j = (i + s) % n, dx = A[2 * i] - B[2 * j], dy = A[2 * i + 1] - B[2 * j + 1];
      sum += dx * dx + dy * dy;
    }
    if (sum < bestSum) { bestSum = sum; best = s; }
  }
  if (!best) return B;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { const j = (i + best) % n; out[2 * i] = B[2 * j]; out[2 * i + 1] = B[2 * j + 1]; }
  return out;
}

/** One ring's motion: where each point starts, and how far it goes. */
interface Path { A: Float64Array; D: Float64Array; n: number }

const path = (A: Float64Array, B: Float64Array, n: number): Path => {
  const D = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) D[i] = B[i] - A[i];
  return { A, D, n };
};
const point = (c: Pt, n: number) => { const P = new Float64Array(n * 2); for (let i = 0; i < n; i++) { P[2 * i] = c[0]; P[2 * i + 1] = c[1]; } return P; };

function between(a: Ring, b: Ring, least: number): Path {
  const n = samples(least, a, b), A = resample(a, n);
  return path(A, align(A, resample(b, n), n), n);
}
function shrink(r: Ring): Path { const n = samples(48, r); return path(resample(r, n), point(centroid(r), n), n); }
function grow(r: Ring): Path { const n = samples(48, r); return path(point(centroid(r), n), resample(r, n), n); }

/** The morph from `a` (t = 0) to `b` (t = 1). */
export function morph(a: Area, b: Area): Morph {
  const pa = polysOf(a), pb = polysOf(b);
  const shapes: Path[][] = [];
  const matched = pairs(pa.map((p) => p[0]), pb.map((p) => p[0]));
  for (const [i, j] of matched) {
    const rings = [between(pa[i][0], pb[j][0], 128)];
    const ha = pa[i].slice(1), hb = pb[j].slice(1), hp = pairs(ha, hb);
    for (const [x, y] of hp) rings.push(between(ha[x], hb[y], 48));
    ha.forEach((h, x) => { if (!hp.some((q) => q[0] === x)) rings.push(shrink(h)); });
    hb.forEach((h, y) => { if (!hp.some((q) => q[1] === y)) rings.push(grow(h)); });
    shapes.push(rings);
  }
  pa.forEach((p, i) => { if (!matched.some((q) => q[0] === i)) shapes.push([shrink(p[0])]); });
  pb.forEach((p, j) => { if (!matched.some((q) => q[1] === j)) shapes.push([grow(p[0])]); });
  return (t) => ({
    type: 'MultiPolygon',
    coordinates: shapes.map((rings) => rings.map(({ A, D, n }) => {
      const out: Position[] = new Array(n + 1);
      for (let i = 0; i < n; i++) out[i] = [A[2 * i] + D[2 * i] * t, A[2 * i + 1] + D[2 * i + 1] * t];
      out[n] = out[0];
      return out;
    })),
  });
}

const cache = new WeakMap<Area, WeakMap<Area, Morph>>();

/** `morph`, worked out once per pair of borders (they're immutable in the doc). */
export function morphBetween(a: Area, b: Area): Morph {
  let to = cache.get(a);
  if (!to) cache.set(a, (to = new WeakMap()));
  let m = to.get(b);
  if (!m) to.set(b, (m = morph(a, b)));
  return m;
}
