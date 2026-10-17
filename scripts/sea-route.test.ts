import { describe, expect, it } from 'vitest';
import { landRings, seaRoute } from './sea-route.mjs';

type Ring = [number, number][];
const square = (w: number, s: number, e: number, n: number): Ring => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const fc = (...polys: Ring[][]) => ({
  type: 'FeatureCollection',
  features: polys.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })),
});
const inside = ([x, y]: number[], r: Ring) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// every point along the route, sampled finely, is at sea
const staysAtSea = (route: number[][], land: Ring[]) => {
  for (let i = 0; i + 1 < route.length; i++) {
    for (let s = 0; s <= 20; s++) {
      const p = [route[i][0] + ((route[i + 1][0] - route[i][0]) * s) / 20, route[i][1] + ((route[i + 1][1] - route[i][1]) * s) / 20];
      if (land.some((r) => inside(p, r))) return false;
    }
  }
  return true;
};

describe('sea-route', () => {
  it('sails around an island instead of across it', () => {
    const island = square(24.5, 37.5, 25.5, 38.5);
    const route = seaRoute([island], [[24, 38], [26, 38]], { cell: 0.02 });
    expect(route[0]).toEqual([24, 38]);
    expect(route[route.length - 1]).toEqual([26, 38]);
    expect(route.length).toBeGreaterThan(2);
    expect(staysAtSea(route, [island])).toBe(true);
  });

  it('goes straight when nothing is in the way', () => {
    const route = seaRoute([], [[24, 38], [26, 38]]);
    expect(route[0]).toEqual([24, 38]);
    expect(route[route.length - 1]).toEqual([26, 38]);
    expect(route.length).toBeLessThanOrEqual(4);
  });

  it('reports a closed strait, and sails through once it is carved open', () => {
    // a wall of land across the whole search box, like a strait too narrow for the raster
    const wall = square(24.9, 30, 25.1, 45);
    expect(() => seaRoute([wall], [[24, 38], [26, 38]], { pad: 0.6 })).toThrow(/carve/);
    const route = seaRoute([wall], [[24, 38], [26, 38]], { pad: 0.6, carve: [[[24.85, 38], [25.15, 38]]] });
    expect(route[route.length - 1]).toEqual([26, 38]);
    expect(route.every(([, lat]) => Math.abs(lat - 38) < 0.1)).toBe(true);
  });

  it('keeps only the rings near the route', () => {
    const near = square(24, 37, 25, 38), far = square(40, 10, 41, 11);
    expect(landRings(fc([near], [far]), [23, 36, 26, 39])).toEqual([near]);
  });
});
