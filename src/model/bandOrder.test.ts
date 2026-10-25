import { describe, expect, it } from 'vitest';
import { bandBlocks, bandOrders, dropBand, moveBand, withBobsOrder } from './bandOrder';
import { ensureRegion, hasRegionOrder, mergeDocs, parseDoc, renameRegion, setRegionOrders } from './doc';

const emptyDoc = () => parseDoc('{"schemaVersion":10}');

// Greece, Aegean and Anatolia are in the Mediterranean; Persia and India have no larger area.
const parent: Record<string, string> = { Greece: 'Mediterranean', Aegean: 'Mediterranean', Anatolia: 'Mediterranean' };
const parentOf = (r: string) => parent[r];
const auto = ['Greece', 'Aegean', 'Anatolia', 'Persia', 'India', ''];

/** Save a move and read the order back, as the app does. */
function apply(orders: Map<string, number>, final: string[], moved: string[]) {
  const next = bandOrders(final, auto, (r) => orders.get(r), moved, parentOf);
  return { orders: next, order: withBobsOrder(auto, (r) => next.get(r), parentOf) };
}

describe('bandBlocks', () => {
  it('keeps a larger area’s bands in one run', () => {
    expect(bandBlocks(auto, parentOf)).toEqual([['Greece', 'Aegean', 'Anatolia'], ['Persia'], ['India'], ['']]);
  });
});

describe('withBobsOrder', () => {
  it('is the automatic order when Bob has moved nothing', () => {
    expect(withBobsOrder(auto, () => undefined, parentOf)).toEqual(auto);
  });
  it('keeps a moved band at its place and the rest around it', () => {
    expect(withBobsOrder(auto, (r) => (r === 'India' ? 0 : undefined), parentOf)).toEqual(['India', 'Greece', 'Aegean', 'Anatolia', 'Persia', '']);
  });
  it('keeps a larger area together even when one of its bands is pinned away from it', () => {
    expect(withBobsOrder(auto, (r) => (r === 'Anatolia' ? 4 : undefined), parentOf)).toEqual(['Greece', 'Aegean', 'Anatolia', 'Persia', 'India', '']);
  });
  it('lets a new region find its own place among those Bob moved', () => {
    const more = ['Greece', 'Aegean', 'Anatolia', 'Egypt', 'Persia', 'India', ''];
    expect(withBobsOrder(more, (r) => (r === 'India' ? 0 : undefined), parentOf)).toEqual(['India', 'Greece', 'Aegean', 'Anatolia', 'Egypt', 'Persia', '']);
  });
  it('keeps Elsewhere last and ignores places past the end', () => {
    expect(withBobsOrder(auto, (r) => (r === 'Persia' ? 99 : r === '' ? 0 : undefined), parentOf)).toEqual(['Greece', 'Aegean', 'Anatolia', 'India', 'Persia', '']);
  });
});

describe('moveBand', () => {
  it('moves a band among its larger area’s bands', () => {
    expect(moveBand(auto, 'Aegean', -1, parentOf)).toEqual({ order: ['Aegean', 'Greece', 'Anatolia', 'Persia', 'India', ''], moved: ['Aegean'] });
  });
  it('at its larger area’s edge, moves the whole larger area', () => {
    expect(moveBand(auto, 'Anatolia', 1, parentOf)).toEqual({ order: ['Persia', 'Greece', 'Aegean', 'Anatolia', 'India', ''], moved: ['Greece', 'Aegean', 'Anatolia'] });
    expect(moveBand(auto, 'Persia', -1, parentOf)?.order).toEqual(['Persia', 'Greece', 'Aegean', 'Anatolia', 'India', '']);
  });
  it('goes no further than the ends, and never moves Elsewhere', () => {
    expect(moveBand(auto, 'Greece', -1, parentOf)).toBeUndefined();
    expect(moveBand(auto, 'India', 1, parentOf)).toBeUndefined();
    expect(moveBand(auto, '', -1, parentOf)).toBeUndefined();
  });
});

describe('dropBand', () => {
  it('drops a band between its larger area’s others', () => {
    expect(dropBand(auto, ['Greece'], 2, parentOf)).toEqual(['Aegean', 'Anatolia', 'Greece', 'Persia', 'India', '']);
  });
  it('drops a larger area’s run between the others', () => {
    expect(dropBand(auto, ['Greece', 'Aegean', 'Anatolia'], 2, parentOf)).toEqual(['Persia', 'India', 'Greece', 'Aegean', 'Anatolia', '']);
    expect(dropBand(auto, ['India'], 0, parentOf)).toEqual(['India', 'Greece', 'Aegean', 'Anatolia', 'Persia', '']);
  });
});

describe('bandOrders', () => {
  it('saves only the bands Bob moved, and gives his order back', () => {
    const m = moveBand(auto, 'India', -1, parentOf)!;
    const r = apply(new Map(), m.order, m.moved);
    expect(r.order).toEqual(['Greece', 'Aegean', 'Anatolia', 'India', 'Persia', '']);
    expect([...r.orders.keys()]).toEqual(['India']);
  });
  it('gives back every move in a row', () => {
    let orders = new Map<string, number>(), order = auto;
    for (const [name, dir] of [['India', -1], ['India', -1], ['Aegean', -1], ['Persia', -1], ['Anatolia', -1]] as const) {
      const m = moveBand(order, name, dir, parentOf)!;
      ({ orders, order } = apply(orders, m.order, m.moved));
      expect(order).toEqual(m.order);
    }
    expect(order).toEqual(['India', 'Persia', 'Aegean', 'Anatolia', 'Greece', '']);
  });
});

describe('setRegionOrders', () => {
  it('saves orders on the records, makes missing ones, and clears them all for the automatic order', () => {
    let doc = ensureRegion(emptyDoc(), 'Greece', 1).doc;
    doc = setRegionOrders(doc, new Map([['Greece', 1], ['India', 0]]), 2);
    expect(doc.regions?.map((r) => [r.name, r.order])).toEqual([['Greece', 1], ['India', 0]]);
    expect(hasRegionOrder(doc)).toBe(true);
    // A renamed region keeps its place.
    doc = renameRegion(doc, doc.regions![0].id, 'Hellas', 3);
    expect(doc.regions?.find((r) => r.name === 'Hellas')?.order).toBe(1);
    const back = setRegionOrders(doc, new Map(), 4);
    expect(back.regions?.every((r) => r.order === undefined)).toBe(true);
    expect(hasRegionOrder(back)).toBe(false);
  });
  it('merges per record: a band moved on one device and another moved elsewhere both keep their places', () => {
    const base = setRegionOrders(emptyDoc(), new Map([['Greece', 2], ['India', 3]]), 1);
    const a = setRegionOrders(base, new Map([['Greece', 0], ['India', 3]]), 5);
    const b = setRegionOrders(base, new Map([['Greece', 2], ['India', 1]]), 6);
    const merged = mergeDocs(a, b);
    expect(Object.fromEntries(merged.regions!.map((r) => [r.name, r.order]))).toEqual({ Greece: 0, India: 1 });
  });
});
