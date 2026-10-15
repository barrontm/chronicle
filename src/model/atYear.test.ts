import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { docYearRange, presenceAt, regionExtent, snapshotAt, valueAt } from './atYear';
import { parseDoc } from './doc';
import type { Territory, TimelineItem } from './types';

const fixture = () => parseDoc(readFileSync(new URL('../../tests/fixtures/sample-history.json', import.meta.url), 'utf8'));

describe('snapshotAt', () => {
  const t: Territory = {
    id: 't', title: 'T', categoryId: 'politics', updatedAt: 0,
    snapshots: [
      { from: { y: -499 }, to: { y: -199 } },
      { from: { y: -199 }, to: { y: 100 } },
      { from: { y: 1500 } },
    ],
  };
  it('picks the snapshot in effect, treating "to" as exclusive', () => {
    expect(snapshotAt(t, -600)).toBeUndefined();
    expect(snapshotAt(t, -499)).toBe(t.snapshots[0]);
    expect(snapshotAt(t, -200)).toBe(t.snapshots[0]);
    expect(snapshotAt(t, -199)).toBe(t.snapshots[1]);
    expect(snapshotAt(t, 100)).toBeUndefined();
    expect(snapshotAt(t, 2020)).toBe(t.snapshots[2]);
  });
});

describe('valueAt', () => {
  const pts = [{ x: 1800, v: 1 }, { x: 1900, v: 2 }, { x: 2000, v: 6 }];
  it('interpolates between known points and refuses to extrapolate', () => {
    expect(valueAt(pts, 1800)).toBe(1);
    expect(valueAt(pts, 1850)).toBe(1.5);
    expect(valueAt(pts, 1950)).toBe(4);
    expect(valueAt(pts, 2000)).toBe(6);
    expect(valueAt(pts, 1799)).toBeUndefined();
    expect(valueAt(pts, 2001)).toBeUndefined();
    expect(valueAt([], 1900)).toBeUndefined();
  });
  it('copes with unsorted points and BCE years', () => {
    expect(valueAt([{ x: 0, v: 5 }, { x: -400, v: 1 }], -200)).toBe(3);
  });
});

describe('presenceAt', () => {
  const battle: TimelineItem = { id: 'b', kind: 'event', title: 'Marathon', start: { y: -489 }, categoryId: 'war', updatedAt: 0 };
  const life: TimelineItem = { id: 'p', kind: 'person', title: 'Plato', start: { y: -427 }, end: { y: -347 }, categoryId: 'ideas', updatedAt: 0 };
  const living: TimelineItem = { id: 'l', kind: 'person', title: 'Someone', start: { y: 1950 }, categoryId: 'ideas', updatedAt: 0 };

  it('shows events when they happen and fades them out', () => {
    expect(presenceAt(battle, -490, 20)).toBe(0);
    expect(presenceAt(battle, -489, 20)).toBe(1);
    expect(presenceAt(battle, -479, 20)).toBeCloseTo(0.7);
    expect(presenceAt(battle, -400, 20)).toBe(0);
    expect(presenceAt(battle, -400, 20, true)).toBe(0.4);
  });

  it('counts the whole year, so an event in June shows when the year is typed', () => {
    const magna = { ...battle, start: { y: 1215, m: 6, d: 15 } };
    expect(presenceAt(magna, 1215, 20)).toBe(1);
    expect(presenceAt(magna, 1214.9, 20)).toBe(0);
  });

  it('shows lifespans for their whole length, including the final year', () => {
    expect(presenceAt(life, -428, 20)).toBe(0);
    expect(presenceAt(life, -347, 20)).toBe(1);
    expect(presenceAt(life, -345, 20)).toBe(0);
    expect(presenceAt(life, -345, 20, true)).toBe(0.4);
    expect(presenceAt(living, 2026, 20, false, 2026)).toBe(1);
  });
});

describe('ranges', () => {
  it('spans everything in the doc', () => {
    const [lo, hi] = docYearRange(fixture())!;
    expect(lo).toBe(-550);
    expect(hi).toBeGreaterThanOrEqual(2022);
  });
  it('finds the extent of regional values, optionally filtered', () => {
    const regions = fixture().series.find((s) => s.id === 'sr_regional')!.regions!;
    expect(regionExtent(regions)).toEqual([1, 95]);
    expect(regionExtent(regions, (k) => /^[A-Z]{3}$/.test(k))).toEqual([5, 95]);
    expect(regionExtent({})).toBeNull();
  });
});
