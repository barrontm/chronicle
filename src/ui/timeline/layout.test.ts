import { describe, expect, it } from 'vitest';
import type { DatedItem, Relation } from '../../model/types';
import { AXIS_H, describeEntry, hitTest, laneAt, layout, MIN_HIT, prepare, ROW_H, stepActive, type Env, type View } from './layout';
import type { Measure, Prim, Scene } from './scene';

const measure: Measure = (_font, s) => s.length * 7;
const LANES = [
  { id: 'politics', label: 'Politics & government', color: 'var(--pig-lapis)' },
  { id: 'war', label: 'War & conflict', color: 'var(--pig-cinnabar)' },
];
const env = (w = 1200, h = 600): Env => ({ w, h, gutter: 188, measure });
const view = (start: number, end: number, extra: Partial<View> = {}): View => ({ win: { start, end }, scrollY: 0, now: 2026, ...extra });

const ev = (id: string, y: number, categoryId = 'politics'): DatedItem => ({ id, kind: 'event', title: id, start: { y }, categoryId, updatedAt: 0 } as DatedItem);
const sp = (id: string, a: number, b: number, kind: 'span' | 'person' = 'span', categoryId = 'politics'): DatedItem =>
  ({ id, kind, title: id, start: { y: a }, end: { y: b }, categoryId, updatedAt: 0 } as DatedItem);

const drawnIds = (S: Scene) => new Set([...S.z[1], ...S.z[2]].flatMap((p: Prim) => (p.id ? [p.id] : [])));
const prep = (items: DatedItem[], prominence?: (id: string) => number) => prepare(items, LANES, { now: 2026, prominence });

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
  const big: DatedItem[] = [];
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

describe('connections', () => {
  const people = [sp('socrates', -469, -399, 'person'), sp('plato', -427, -347, 'person'), sp('confucius', -551, -479, 'person', 'war')];
  const D = prep(people);
  const roles = new Map([['plato', 'infl-self'], ['socrates', 'infl-by']]);
  const links = [{ fromId: 'socrates', toId: 'plato', role: 'infl-by' as const }];

  it('lights up the open entry’s connections and fades the rest', () => {
    const S = layout(D, view(-600, -300, { selected: 'plato', roles, links }), env());
    const cls = (id: string) => S.z[1].find((p) => p.id === id)!.cls;
    expect(cls('socrates')).toContain('infl-by');
    expect(cls('confucius')).toContain('dimmed');
    const arc = S.z[3].find((p) => p.t === 5)!;
    expect(arc).toMatchObject({ cls: 'arc infl-by', from: 'socrates', to: 'plato', head: 'infl-by' });
  });
  it('draws an arrow only while both ends are in view', () => {
    const S = layout(D, view(-380, -300, { roles, links }), env());
    expect(S.z[3].filter((p) => p.t === 5)).toHaveLength(0);
  });
  it('runs an arrow off the edge toward an end scrolled out of view', () => {
    const tall = Array.from({ length: 30 }, (_, i) => sp(`p${i}`, -500, -400 + i));
    const D2 = prep([...tall, ev('w', -450, 'war')]);
    const S = layout(D2, view(-600, -300, { links: [{ fromId: 'p0', toId: 'w', role: 'draft', label: 'led to ?' }] }), env(1200, 300));
    expect(S.boxes.has('w')).toBe(false);
    expect(S.z[3].filter((p) => p.t === 5)).toHaveLength(1);
  });
  it('points at the cluster an end has merged into', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, -500 + i * 0.1));
    const D2 = prep([...many, ev('later', -300)]);
    const S = layout(D2, view(-2000, 500, { links: [{ fromId: 'e2', toId: 'later', role: 'linked' }] }), env());
    expect(S.boxes.get('e2')).toBe(S.boxes.get('e0'));
    expect(S.z[3].filter((p) => p.t === 5)).toHaveLength(1);
  });
  it('labels Claude’s drafted connections, and loops when both ends share a year', () => {
    const D2 = prep([ev('a', -449), ev('b', -449, 'war')]);
    const S = layout(D2, view(-460, -440, { links: [{ fromId: 'a', toId: 'b', role: 'draft', label: 'funded ?' }] }), env());
    const arc = S.z[3].find((p) => p.t === 5) as Prim & { d: string; dash: boolean };
    expect(arc.d).toContain('C');
    expect(arc.dash).toBe(true);
    expect(S.z[3].find((p) => p.t === 2)).toMatchObject({ s: 'funded ?', cls: 'tl-arc-label draft' });
  });
});

describe('drafts', () => {
  it('draws Claude’s drafts as ghosts with a "?", never in a cluster with entries', () => {
    const items = Array.from({ length: 5 }, (_, i) => ev(`e${i}`, -500 + i * 0.1));
    const D = prepare(items, LANES, { now: 2026, drafts: [ev('decree', -500.05)] });
    const S = layout(D, view(-2000, 500), env());
    expect(S.clusters[0].members).not.toContain('decree');
    const ghost = S.z[1].find((p) => p.id === 'decree')!;
    expect(ghost).toMatchObject({ cls: 'tl-draft', dash: true });
    expect(D.extent).toEqual({ start: -500, end: -499.6 });
  });
});

describe('dragging the open entry', () => {
  const D = prep([sp('war', -430, -403), ev('battle', -424)]);
  it('offers its body and both ends to drag, only when it is open', () => {
    const closed = layout(D, view(-450, -390, { editable: true }), env());
    expect(closed.targets.some((t) => t.grip)).toBe(false);
    const open = layout(D, view(-450, -390, { editable: true, selected: 'war' }), env());
    expect(open.targets.filter((t) => t.id === 'war').map((t) => t.grip)).toEqual(['body', 'start', 'end']);
    const bar = open.boxes.get('war')!;
    expect(hitTest(open, bar.x + 1, bar.y + 5)?.grip).toBe('start');
    expect(hitTest(open, bar.x + bar.w / 2, bar.y + 5)?.grip).toBe('body');
  });
  it('shows where it would go, its new dates on the axis, and fades where it was', () => {
    const S = layout(D, view(-450, -390, { editable: true, selected: 'battle', drag: { id: 'battle', s: -420, e: -420, label: '421 BCE', y: AXIS_H } }), env());
    expect(S.z[1].find((p) => p.id === 'battle')!.a).toBe(0.35);
    expect(S.z[3].find((p) => p.k === 'dragm')).toBeTruthy();
    expect(S.axis.find((p) => p.k === 'dragt')).toMatchObject({ s: '421 BCE' });
  });
});

describe('the arrow keys', () => {
  const D = prep([ev('a', -500), ev('b', -400), sp('c', -450, -300), ev('w', -420, 'war')]);
  const win = { start: -600, end: -200 };
  it('start at the entry nearest the middle of the view', () => {
    expect(stepActive(D, undefined, 'ArrowRight', win)).toBe('b');
  });
  it('go through a lane in time order, and stop at its ends', () => {
    expect(stepActive(D, 'a', 'ArrowRight', win)).toBe('c');
    expect(stepActive(D, 'c', 'ArrowRight', win)).toBe('b');
    expect(stepActive(D, 'b', 'ArrowRight', win)).toBe('b');
    expect(stepActive(D, 'b', 'Home', win)).toBe('a');
  });
  it('move to the nearest entry in time in the lane below or above', () => {
    expect(stepActive(D, 'b', 'ArrowDown', win)).toBe('w');
    expect(stepActive(D, 'w', 'ArrowUp', win)).toBe('b');
    expect(stepActive(D, 'w', 'ArrowDown', win)).toBe('w');
  });
  it('say where they are for screen readers', () => {
    expect(describeEntry(D, 'c')).toBe('c, 451–301 BCE, Politics & government, 2 of 3');
  });
});

describe('every kind of thing', () => {
  const as = <T extends DatedItem>(it: T, subject: DatedItem['subject']): T => ({ ...it, subject });
  const rel = (fromId: string, toId: string, type: Relation['type']): Relation => ({ id: `${fromId}>${toId}`, fromId, toId, type, updatedAt: 0 });
  const prims = (S: Scene) => [...S.z[0], ...S.z[1], ...S.z[2]];
  const glyphs = (S: Scene) => prims(S).flatMap((p) => (p.t === 6 ? [[p.id, p.g]] : []));

  it('draws a battle that is part of a war as a tick on the war’s bar, one to tap and step to', () => {
    const items = [as(sp('invasion', -480, -479, 'span', 'war'), 'war'), as(ev('salamis', -480, 'politics'), 'battle'), as(ev('marathon', -490, 'war'), 'battle')];
    const D = prepare(items, LANES, { now: 2026, relations: [rel('salamis', 'invasion', 'part-of')] });
    expect(D.byId.get('salamis')!.war).toBe('invasion');
    expect(D.lanes[0].events.map((e) => e.id)).toEqual([]);
    const S = layout(D, view(-495, -470), env());
    const tick = prims(S).find((p) => p.id === 'salamis');
    expect(tick).toMatchObject({ t: 3, cls: expect.stringContaining('tl-tick-mark') });
    const t = S.targets.find((x) => x.id === 'salamis')!;
    expect(t.w).toBeGreaterThanOrEqual(MIN_HIT);
    expect(hitTest(S, t.x + t.w / 2, t.y + t.h / 2)?.id).toBe('salamis');
    expect(describeEntry(D, 'salamis')).toContain('War & conflict');
    expect(stepActive(D, 'marathon', 'ArrowRight', view(-495, -470).win)).toBe('salamis');
    // A battle without a war in Chronicle is a point of its own, in its glyph.
    expect(glyphs(S)).toContainEqual(['marathon', 'battle']);
  });

  it('draws technology and works as their glyphs, and joins a work to its maker’s lifeline', () => {
    const items = [as(ev('trireme', -480), 'technology'), as(ev('histories', -430), 'work'), as(sp('herodotus', -484, -425, 'person'), 'person')];
    const D = prepare(items, LANES, { now: 2026, relations: [rel('herodotus', 'histories', 'related')] });
    const S = layout(D, view(-500, -400), env());
    expect(glyphs(S)).toEqual(expect.arrayContaining([['trireme', 'technology'], ['histories', 'work']]));
    const tie = prims(S).find((p) => p.cls === 'tl-tie' && p.t === 3);
    expect(tie).toBeDefined();
    const work = S.boxes.get('histories')!, life = S.boxes.get('herodotus')!;
    expect(tie).toMatchObject({ y1: work.y + work.h, y2: life.y });
  });

  it('draws an idea as a thread, a migration as an arrow, a place as a ground line and an economy with its coins', () => {
    const items = [as(sp('sophists', -460, -380), 'idea'), as(sp('ionian', -1050, -950), 'migration'), as(sp('olynthus', -431, -347), 'place'), as(sp('laurion', -483, -413), 'economy')];
    const D = prepare(items, LANES, { now: 2026 });
    const S = layout(D, view(-1100, -300), env());
    expect(glyphs(S)).toEqual(expect.arrayContaining([['sophists', 'idea'], ['olynthus', 'place'], ['laurion', 'economy'], ['ionian', 'migration']]));
    expect(prims(S).find((p) => p.t === 7 && p.id === 'ionian')).toBeDefined();
    const lines = (id: string) => prims(S).filter((p) => p.t === 3 && p.k.endsWith(id) && p.k.startsWith('bl'));
    expect(lines('sophists')).toHaveLength(1);
    expect(lines('olynthus')[0]).toMatchObject({ sw: 5 });
    // Every one is still a target as tall as its row.
    for (const id of ['sophists', 'ionian', 'olynthus', 'laurion']) expect(S.targets.find((t) => t.id === id)?.h).toBe(ROW_H);
  });

  it('dashes the approximate end of a place’s ground line', () => {
    const D = prepare([{ ...as(sp('olynthus', -431, -347), 'place'), end: { y: -347, approx: true } }], LANES, { now: 2026 });
    const S = layout(D, view(-500, -300), env());
    const pieces = prims(S).filter((p) => p.t === 3 && p.k.startsWith('bl') && p.k.endsWith('olynthus'));
    expect(pieces.map((p) => (p as { dash?: boolean }).dash)).toEqual([false, true]);
  });
});
