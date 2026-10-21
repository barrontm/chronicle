import { describe, expect, it } from 'vitest';
import type { Measure } from '../timeline/scene';
import { arrowPrims, attach, curve, FADED, landYear, type ArrowIn } from './influence';

const X = (y: number) => (y + 500) * 10;
const M: Measure = (_f, s) => s.length * 6;
const end = (id: string, s: number, e: number, y: number) => ({ id, s, e, box: { x: X(s), y, w: Math.max(12, X(e) - X(s)), h: 20 } });
const arrow = (key: string, from: ReturnType<typeof end>, to: ReturnType<typeof end>, o: Partial<ArrowIn> = {}): ArrowIn => ({ key, from, to, label: 'weakened', color: 'red', ...o });

describe('influence arrows', () => {
  it('lands at the cause’s start, clamped into the effect’s years and then the cause’s', () => {
    expect(landYear({ s: -412, e: -403 }, { s: -509, e: -321 })).toBe(-412);
    expect(landYear({ s: -430, e: -426 }, { s: -427, e: -427 })).toBe(-427);
    // The effect is over before the cause begins: as late in the cause as it can be, its start.
    expect(landYear({ s: -400, e: -390 }, { s: -450, e: -420 })).toBe(-400);
  });

  it('leaves from the edge facing the other end and spreads arrows sharing a span end', () => {
    const war = end('war', -431, -404, 100);
    const a = arrow('a', war, end('x', -430, -430, 200));
    const b = arrow('b', war, end('y', -429, -429, 200));
    const [pa, pb] = attach([a, b], X);
    expect(pa.a.y).toBe(120); // the war's bottom edge, towards the economy below
    expect(pa.b.y).toBe(200); // the effect's top edge
    expect(pb.a.x - pa.a.x).toBeGreaterThanOrEqual(9);
  });

  it('bows sideways when the ends are close side by side, and leaves vertically otherwise', () => {
    expect(curve({ x: 100, y: 0 }, { x: 110, y: 100 }).d).toBe('M100 0 C140 50 150 50 110 100');
    expect(curve({ x: 100, y: 0 }, { x: 300, y: 100 }).d).toBe('M100 0 C100 50 300 50 300 100');
  });

  it('hides a label that would cover a name until its arrow is in focus, and fades the rest', () => {
    const from = end('a', -450, -440, 0), to = end('b', -430, -430, 200);
    const covered = [{ x: 0, y: -1000, w: 100000, h: 3000 }];
    expect(arrowPrims([arrow('k', from, to)], X, M, [...covered]).labels).toEqual([]);
    const focused = arrowPrims([arrow('k', from, to, { focus: true }), arrow('j', from, to, { faded: true })], X, M, [...covered]);
    expect(focused.labels.some((p) => p.t === 2 && p.s === 'weakened')).toBe(true);
    expect(focused.marks.filter((p) => p.k.startsWith('infj')).every((p) => p.a === FADED)).toBe(true);
    // A hidden label leaves the curve's middle to click.
    expect(arrowPrims([arrow('k', from, to)], X, M, [...covered]).targets).toHaveLength(1);
  });
});
