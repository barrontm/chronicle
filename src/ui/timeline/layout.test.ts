import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../model/types';
import { AXIS_H, hitTest, laneAt, layout, MIN_HIT, prepare, ROW_H, type Env, type View } from './layout';
import type { Measure, Prim, Scene } from './scene';

const measure: Measure = (_font, s) => s.length * 7;
const LANES = [
  { id: 'politics', label: 'Politics & government', color: 'var(--pig-lapis)' },
  { id: 'war', label: 'War & conflict', color: 'var(--pig-cinnabar)' },
];
const env = (w = 1200, h = 600): Env => ({ w, h, gutter: 188, measure });
const view = (start: number, end: number, extra: Partial<View> = {}): View => ({ win: { start, end }, scrollY: 0, now: 2026, ...extra });

const ev = (id: string, y: number, categoryId = 'politics'): TimelineItem => ({ id, kind: 'event', title: id, start: { y }, categoryId, updatedAt: 0 } as TimelineItem);
const sp = (id: string, a: number, b: number, kind: 'span' | 'person' = 'span', categoryId = 'politics'): TimelineItem =>
  ({ id, kind, title: id, start: { y: a }, end: { y: b }, categoryId, updatedAt: 0 } as TimelineItem);

const drawnIds = (S: Scene) => new Set([...S.z[1], ...S.z[2]].flatMap((p: Prim) => (p.id ? [p.id] : [])));
const prep = (items: TimelineItem[], prominence?: (id: string) => number) => prepare(items, LANES, { now: 2026, prominence });

describe('prepare', () => {
  it('packs overlapping spans into rows, periods above lives, and lets ones that follow share a row', () => {
    const D = prep([sp('archaic', -800, -480), sp('classical', -480, -323), sp('pericles', -494, -428, 'person'), sp('fifty', -479, -431), sp('cimon', -510, -450, 'person'), sp('hellenistic', -323, -31)]);
    const row = (id: string) => D.byId.get(id)!.row;
    expect(row('archaic')).toBe(0);
    expect(row('classical')).toBe(0);
    expect(row('hellenistic')).toBe(0);
    expect(row('fifty')).toBe(1);
    expect(row('cimon')).toBe(2);
    expect(row('pericles')).toBe(3);
    expect(D.lanes[0].spanRows).toBe(4);
    expect(D.byId.get('archaic')!.nextS).toBe(-480);
  });
  it('stacks lanes one under the other, every lane tall enough to tap', () => {
    const D = prep([ev('a', -500), ev('b', -490), sp('s', -500, -400)]);
    expect(D.lanes[0].momentRows).toBe(2);
    expect(D.lanes[1].top).toBe(D.lanes[0].height);
    expect(D.lanes[1].height).toBeGreaterThanOrEqual(ROW_H);
  });
  it('leaves out entries in hidden categories and draws a living person to today', () => {
    const D = prepare([sp('alive', 1950, 1950, 'person'), ev('hidden', 1, 'science')], LANES, { now: 2026 });
    const alive = { ...sp('alive', 1950, 1950, 'person'), end: undefined };
    const D2 = prepare([alive], LANES, { now: 2026.5 });
    expect(D.byId.has('hidden')).toBe(false);
    expect(D2.byId.get('alive')!.e).toBe(2026.5);
  });
});

describe('layout', () => {
  it('culls what is outside the window', () => {
    const D = prep([ev('marathon', -489), ev('waterloo', 1815), sp('roman', -27, 476)]);
    const S = layout(D, view(-600, -300), env());
    const ids = drawnIds(S);
    expect(ids.has('marathon')).toBe(true);
    expect(ids.has('waterloo')).toBe(false);
    expect(ids.has('roman')).toBe(false);
  });
  it('culls lanes scrolled out of view', () => {
    const many = Array.from({ length: 60 }, (_, i) => sp(`p${i}`, -500, -400 + i));
    const D = prep([...many, ev('late', -450, 'war')]);
    expect(drawnIds(layout(D, view(-600, -300), env(1200, 300))).has('late')).toBe(false);
    expect(drawnIds(layout(D, view(-600, -300, { scrollY: D.lanes[1].top }), env(1200, 300))).has('late')).toBe(true);
  });
  it('gives every span and point a hit area of at least 24 px', () => {
    const D = prep([ev('a', -500), sp('short', -500, -499), sp('life', -470, -399, 'person')]);
    const S = layout(D, view(-3000, 2000), env());
    for (const t of S.targets.filter((x) => x.id !== 'playhead')) {
      expect(t.w).toBeGreaterThanOrEqual(MIN_HIT);
      expect(t.h).toBeGreaterThanOrEqual(MIN_HIT);
    }
  });
  it('finds an entry by its mark and by its label', () => {
    const D = prep([ev('Battle of Marathon', -489)]);
    const S = layout(D, view(-600, -400), env());
    const dot = S.z[1].find((p) => p.id === 'Battle of Marathon')! as Prim & { x: number; y: number };
    expect(hitTest(S, dot.x, dot.y)?.id).toBe('Battle of Marathon');
    expect(hitTest(S, dot.x + 40, dot.y)?.id).toBe('Battle of Marathon');
    expect(hitTest(S, dot.x + 400, dot.y)).toBeUndefined();
    expect(hitTest(S, 100, dot.y)).toBeUndefined(); // the lane names
  });
  it('puts a span label inside, after it when there is room, or hides it under 48 px', () => {
    const D = prep([sp('A long period name', -500, -490), sp('next', -400, -300), sp('Squeezed in', -300, -299)]);
    const S = layout(D, view(-520, -200), env());
    const label = (id: string) => S.z[2].find((p) => p.id === id && p.t === 2) as (Prim & { t: 2 }) | undefined;
    expect(label('A long period name')?.f).toBe('spanI'); // after the bar
    expect(label('next')?.f).toBe('span'); // inside
    expect(label('Squeezed in')?.f).toBe('spanI'); // nothing after it in its row
  });
  it('keeps labels inside the right edge, flipping a moment label to the left of its dot', () => {
    const D = prep([ev('Magna Carta sealed', 1215), sp('French Revolution', 1789, 1799)]);
    const label = (S: Scene, id: string) => S.z[2].find((p) => p.id === id) as (Prim & { t: 2 }) | undefined;
    const wide = layout(D, view(1000, 1800), env());
    expect(label(wide, 'Magna Carta sealed')?.anchor).toBeUndefined();
    expect(label(wide, 'French Revolution')).toBeUndefined(); // no room after it, too narrow inside
    const edge = label(layout(D, view(1000, 1225), env()), 'Magna Carta sealed');
    expect(edge).toMatchObject({ anchor: 'end', s: 'Magna Carta sealed' });
  });
  it('marks approximate ends with dashes', () => {
    const D = prep([{ ...sp('c', -500, -400), start: { y: -500, approx: true }, end: { y: -400, approx: true } }]);
    const S = layout(D, view(-600, -300), env());
    expect(S.z[1].find((p) => p.k === 'bac')).toMatchObject({ dash: true });
    expect(S.z[1].find((p) => p.k === 'bzc')).toMatchObject({ dash: true });
  });
  it('draws the playhead with its year, and makes it the top target', () => {
    const D = prep([ev('a', -431)]);
    const S = layout(D, view(-600, -300, { playYear: -430 }), env());
    expect(S.axis.find((p) => p.k === 'playt')).toMatchObject({ s: '431 BCE' });
    const x = 188 + ((-430 + 600) / 300) * (1200 - 188);
    expect(hitTest(S, x, AXIS_H + 10)?.id).toBe('playhead');
    expect(hitTest(S, x, AXIS_H - 10)?.id).toBe('playhead');
  });
  it('finds the lane under a point for adding there', () => {
    const D = prep([ev('a', -431), ev('b', -400, 'war')]);
    expect(laneAt(D, 0, AXIS_H + 5)?.id).toBe('politics');
    expect(laneAt(D, 0, AXIS_H + D.lanes[1].top + 5)?.id).toBe('war');
  });
});

describe('clusters', () => {
  // 2,000 entries across three millennia: a moment and a span every year and a half, in two lanes.
  const big: TimelineItem[] = [];
  for (let i = 0; i < 1000; i++) {
    const y = -2000 + Math.round(i * 3);
    big.push(ev(`e${i}`, y, i % 2 ? 'war' : 'politics'));
    big.push(sp(`s${i}`, y, y + 1 + (i % 3), i % 4 ? 'span' : 'person', i % 2 ? 'politics' : 'war'));
  }
  const prominence = (id: string) => (id === 'e500' ? 10 : 0);
  const D = prep(big, prominence);
  const at = (span: number) => layout(D, view(-500 - span / 2, -500 + span / 2), env(1400, 4000));
  const clustered = (S: Scene) => S.clusters.reduce((n, c) => n + c.count, 0);

  it('merges marks that would overlap into one badge per kind and row', () => {
    const S = at(3000);
    expect(new Set(S.clusters.map((c) => c.kind))).toEqual(new Set(['event', 'span', 'person']));
    for (const c of S.clusters) {
      expect(c.count).toBe(c.members.length);
      expect(c.members).toContain(c.lead);
      const kinds = new Set(c.members.map((id) => D.byId.get(id)!.kind));
      expect([...kinds]).toEqual([c.kind]);
    }
    // No entry is in two clusters.
    const all = S.clusters.flatMap((c) => c.members);
    expect(new Set(all).size).toBe(all.length);
  });
  it('lets the most prominent member lead', () => {
    const S = at(3000);
    const withStar = S.clusters.find((c) => c.members.includes('e500'))!;
    expect(withStar.lead).toBe('e500');
  });
  it('splits as you zoom in, until each entry stands alone', () => {
    const wide = clustered(at(3000)), mid = clustered(at(300)), close = clustered(at(30));
    expect(wide).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(close);
    expect(close).toBe(0);
  });
  it('lays out a frame of 2,000 entries quickly', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) at(3000 - i * 100);
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});
