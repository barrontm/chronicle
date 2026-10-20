import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { MIN_SHARE, strengthAt, stripShare, UNKNOWN_SHARE, areaWeight } from './strength';
import type { Territory } from './types';

const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const terr = (id: string) => doc.territories.find((t) => t.id === id)!;
const share = (t: Territory, y: number, widest = 1) => stripShare(strengthAt(t, y), widest);
const bce = (n: number) => 1 - n;

describe('strengthAt', () => {
  it('follows Bob’s points: Athens grows from 500 to 431 BCE and shrinks after 338 BCE', () => {
    const athens = terr('t_athens');
    expect(strengthAt(athens, bce(500)).by).toBe('points');
    expect(share(athens, bce(500))).toBeLessThan(share(athens, bce(470)));
    expect(share(athens, bce(470))).toBeLessThan(share(athens, bce(431)));
    expect(share(athens, bce(431))).toBe(1);
    expect(share(athens, bce(338))).toBeCloseTo(0.2);
    expect(share(athens, bce(300))).toBeLessThanOrEqual(share(athens, bce(338)));
    // Straight lines between points: halfway between level 1 (600 BCE) and 2 (490 BCE).
    expect((strengthAt(athens, bce(545)) as { level: number }).level).toBeCloseTo(1.5);
  });

  it('otherwise takes the area of its borders, easing into the next snapshot', () => {
    const syr = terr('t_syracuse');
    expect(strengthAt(syr, bce(500))).toEqual({ by: 'area', km2: 1925 });
    expect(strengthAt(syr, bce(380))).toEqual({ by: 'area', km2: 15354 });
    const easing = strengthAt(syr, bce(410)) as { km2: number };
    expect(easing.km2).toBeGreaterThan(1925);
    expect(easing.km2).toBeLessThan(15354);
  });

  it('knows nothing without points or areas, and draws that at one even width', () => {
    const bare: Territory = { ...terr('t_corinth'), snapshots: terr('t_corinth').snapshots.map(({ areaKm2: _, ...s }) => s) };
    expect(strengthAt(bare, -400)).toEqual({ by: 'none' });
    expect(share(bare, -400)).toBe(UNKNOWN_SHARE);
  });

  it('scales an area by the widest in view, never thinner than a sliver', () => {
    const persia = terr('t_persia'), macedon = { ...terr('t_macedon'), strength: undefined }, corinth = terr('t_corinth');
    const widest = areaWeight(5256090);
    expect(share(persia, -400, widest)).toBe(1);
    // Compressed by the power 0.4: Macedon under Philip is about a quarter of Persia's width, not a twenty-eighth.
    const m = share(macedon, bce(330), widest);
    expect(m).toBeCloseTo(Math.pow(187697 / 5256090, 0.4), 3);
    expect(m).toBeGreaterThan(0.25);
    expect(share(corinth, -400, widest)).toBe(MIN_SHARE);
  });
});
