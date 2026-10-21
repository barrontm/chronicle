import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDated } from '../../model/dates';
import { parseDoc } from '../../model/doc';
import { eraRegions } from '../../model/eras';
import { entryLanes } from '../../model/lanes';
import { overview } from '../../model/overview';
import { polityMembers } from '../../model/polities';
import { prominence as prominenceOf } from '../../model/prominence';
import type { DatedItem, Lane, Relation } from '../../model/types';
import {
  AXIS_H, describeEntry, describeEra, describeLane1, eraLanes, ERAS_BACK, HEAD1_H, LANE_TOGGLE, OPEN_PICK, polityLanes, hitBox, hitTest, laneAt, layout, maxScroll, MIN_HIT, NO_LANE, prepare, REGION_GROW, regionSpan, ROW_H, stepActive, stepEra, stepLane1,
  type Env, type View,
} from './layout';
import { ARROW } from '../representations/influence';
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

describe('level 0: the overview', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const prominence = prominenceOf(doc);
  const O = overview({ ...doc, items, prominence, now: 2026 });
  const D = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: O });
  const textOf = (S: Scene) => [...S.z[2], ...S.gutter].flatMap((p) => (p.t === 2 ? [p.s] : []));
  const open = new Map([['g_classical_greece', 1]]);
  const at = (win: [number, number], extra: Partial<View> = {}, e = env(1200, 1400)) => layout(D, view(win[0], win[1], extra), e, 0);
  const strip = (S: Scene, id: string) => S.z[1].find((p) => p.t === 7 && p.id === id);

  it('grows the region Bob clicked on the map by 30% and fades the other bands to 40%, still drawn', () => {
    const win: [number, number] = [-560, -320];
    const plain = at(win), focused = at(win, { region: 'Persia' });
    const box = (S: Scene, id: string) => { const p = strip(S, id); return p && p.t === 7 ? p.d : ''; };
    const persia = (S: Scene) => S.targets.find((t) => t.id === 'pol:t_persia')!;
    expect(persia(focused).h + 4).toBeCloseTo((persia(plain).h + 4) * REGION_GROW, 5);
    expect(box(focused, 'pol:t_persia')).not.toBe(box(plain, 'pol:t_persia'));
    // Macedon's strip is still there, faded; Persia's isn't.
    expect(strip(focused, 'pol:t_macedon')!.a).toBeCloseTo(strip(plain, 'pol:t_macedon')!.a * 0.4, 5);
    expect(strip(focused, 'pol:t_persia')!.a).toBe(strip(plain, 'pol:t_persia')!.a);
    expect(textOf(focused)).toContain('Macedon');
    // Its band can be scrolled to.
    expect(regionSpan(D, view(win[0], win[1], { region: 'Persia' }), 'Persia', false)![0]).toBeGreaterThan(regionSpan(D, view(win[0], win[1]), 'Greece', false)![0]);
  });

  it('puts the bands in the overview’s order, with a group folded into one sub-row and the Delian League in another', () => {
    expect(D.bands.map((b) => b.label)).toEqual(['Italy', 'Macedon', 'Greece', 'Persia']);
    expect(D.bands.map((b) => b.parentHead)).toEqual([true, false, false, true]);
    const greece = D.bands[2];
    expect(greece.subs.map((row) => row.map((x) => (x.pol ?? x.group).id))).toEqual([['g_classical_greece'], ['t_delian']]);
    expect(greece.eras.map((e) => e.id)).toContain('i_classical');
    expect(D.overviewExtent!.start).toBe(-799);
  });

  it('draws a folded group as one strip named with its members, and its members when it unfolds', () => {
    const folded = at([-820, -10]);
    expect(strip(folded, 'grp:g_classical_greece')).toBeDefined();
    expect(strip(folded, 'pol:t_athens')).toBeUndefined();
    expect(textOf(folded)).toEqual(expect.arrayContaining(['▸ Classical Greece', 'Athens · Sparta · Corinth · Thebes']));
    const S = at([-820, -10], { unfolded: open });
    expect(strip(S, 'grp:g_classical_greece')).toBeUndefined();
    for (const id of ['t_athens', 't_sparta', 't_corinth', 't_thebes']) expect(strip(S, `pol:${id}`)).toBeDefined();
    expect(textOf(S)).toContain('Athens');
    // The bracket folds it back.
    const bracket = S.targets.find((t) => t.id === 'grp:g_classical_greece')!;
    expect(bracket.w).toBeLessThan(20);
    // Half open, the members' rows are half as tall and faded.
    const half = at([-820, -10], { unfolded: new Map([['g_classical_greece', 0.5]]) });
    expect(strip(half, 'pol:t_athens')!.a).toBeCloseTo(0.5);
  });

  it('makes a strip as thick as its strength: Athens thick at the Peloponnesian War, a sliver after Chaeronea', () => {
    const S = at([-820, -10], { unfolded: open });
    const athens = strip(S, 'pol:t_athens')!;
    const target = S.targets.find((t) => t.id === 'pol:t_athens')!;
    // Read the strip's thickness off its outline at a year.
    const pts = athens.t === 7 ? athens.d.slice(1, -1).split('L').map((xy) => xy.split(' ').map(Number)) : [];
    const half = pts.length / 2;
    const thick = (year: number) => {
      const x = S.plot.x + ((year + 820) / 810) * S.plot.w;
      const k = pts.slice(0, half).reduce((b, p, i) => (Math.abs(p[0] - x) < Math.abs(pts[b][0] - x) ? i : b), 0);
      return pts[pts.length - 1 - k][1] - pts[k][1];
    };
    expect(thick(-499)).toBeLessThan(thick(-430));
    expect(thick(-300)).toBeLessThan(thick(-430) / 3);
    // The whole row is its hit area, so even a sliver can be picked.
    expect(target.h).toBeGreaterThanOrEqual(MIN_HIT);
    expect(hitTest(S, target.x + target.w * 0.8, target.y + 2)?.id).toBe('pol:t_athens');
  });

  it('draws a strip with nothing known as an even, faint width with a dotted edge', () => {
    const bare = overview({ ...doc, items, territories: doc.territories.map((t) => ({ ...t, strength: undefined, snapshots: t.snapshots.map(({ areaKm2: _, ...s }) => s) })), prominence, now: 2026 });
    const D2 = prepare(items, lanes, { now: 2026, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: bare });
    const S = layout(D2, view(-820, -10), env(1200, 1400), 0);
    expect(strip(S, 'pol:t_persia')).toMatchObject({ dash: true, stroke: 'var(--pig-umber)' });
  });

  it('gilds a world event along the top of every band it touched, named in its home band', () => {
    const S = at([-820, -10]);
    const gold = S.z[1].filter((p) => p.id === 'i_alexander_persia' && p.cls?.startsWith('tl-world'));
    expect(gold).toHaveLength(2);
    expect(gold.every((p) => p.t === 0 && p.fill === 'gilt' && p.stroke === 'var(--gold-ink)')).toBe(true);
    // 7 px at home in Macedon, 3 px in Persia.
    expect(gold.map((p) => (p.t === 0 ? p.h : 0)).sort()).toEqual([3, 7]);
    expect(S.z[2].filter((p) => p.t === 2 && p.s === 'Alexander’s conquest of Persia')).toHaveLength(1);
  });

  it('puts the entries Bob shows at the top as their kind’s glyph and name, and opens them', () => {
    const S = at([-820, -10]);
    const glyphs = S.z[2].filter((p) => p.t === 6 && p.cls?.startsWith('tl-top'));
    expect(glyphs.length).toBeGreaterThanOrEqual(3);
    expect(textOf(S)).toContain('Peloponnesian War');
    const t = S.targets.find((x) => x.id === 'i_pelop')!;
    expect(hitTest(S, t.x + 4, t.y + t.h / 2)?.id).toBe('i_pelop');
  });

  it('puts eras behind as a wash named in italic, that opens the era where no strip is', () => {
    const S = at([-820, -10]);
    const wash = S.z[0].find((p) => p.cls?.startsWith('tl-era') && p.id === 'i_classical')!;
    expect(wash.t === 0 && wash.fill).toBe('var(--band-2)');
    expect(S.z[2].find((p) => p.t === 2 && p.s === 'Classical Greece' && p.f === 'wash')).toBeDefined();
    // The Archaic period's start is approximate: a dashed umber edge.
    expect(S.z[0].find((p) => p.k === 'eai_archaic')).toMatchObject({ dash: true, stroke: 'var(--pig-umber)' });
    const t = S.targets.find((x) => x.id === 'i_classical')!;
    expect(hitTest(S, t.x + 4, t.y + 6)?.id).toBe('i_classical');
  });

  it('says so in a thin row when a band has no polities in the years in view', () => {
    const S = at([100, 300]);
    expect(textOf(S).filter((s) => s === 'No polities in these years')).toHaveLength(4);
    const empty = layout(prepare([], LANES, { now: 2026, overview: overview({ items: [], territories: [], relations: [], highlights: [], prominence: () => 0, now: 2026 }) }), view(-800, 0), env(), 0);
    expect(textOf(empty)).toContain('Nothing in the overview yet');
  });

  it('puts region names on their bands on a phone, with no gutter', () => {
    const S = layout(D, view(-820, -10), { ...env(412, 1400), gutter: 0 }, 0);
    expect(S.gutter.length).toBe(0);
    const name = S.z[2].find((p) => p.t === 2 && p.s === 'Greece')!;
    const wash = S.z[0].find((p) => p.t === 0 && p.id === 'i_archaic')!;
    expect(name.t === 2 && wash.t === 0 && name.y > wash.y && name.y < wash.y + wash.h).toBe(true);
  });

  it('scrolls as far as its bands go, further with a group open', () => {
    const shut = maxScroll(D, 400, 0, 1200, view(-820, -10));
    expect(shut).toBeGreaterThan(0);
    expect(maxScroll(D, 400, 0, 1200, view(-820, -10, { unfolded: open }))).toBeGreaterThan(shut);
  });

  it('steps through eras with the arrow keys and describes them', () => {
    const win = { start: -820, end: -10 };
    expect(stepEra(D, undefined, 'ArrowRight', win)).toBeDefined();
    expect(stepEra(D, 'i_archaic', 'ArrowRight', win)).toBe('i_classical');
    expect(stepEra(D, 'i_classical', 'End', win)).toBe('i_hellenistic');
    expect(describeEra(D, 'i_classical')).toMatch(/^Classical Greece, 480–323 BCE, Greece, \d+ highlights, 2 of 6$/);
  });
});

describe('level 1: an era’s six lanes', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const D = prepare(items, lanes, { now: 2026, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: overview({ ...doc, items, prominence: () => 0, now: 2026 }) });
  const dims = entryLanes(items, doc.highlights);
  const EL = eraLanes(D, 'i_classical', dims)!;
  const win = { start: -490, end: -312 };
  const open = (extra: Partial<View> = {}, e = env(1200, 2400)) => layout(D, view(win.start, win.end, { era: EL, ...extra }), e, 1);
  const textOf = (S: Scene) => [...S.z[2], ...S.z[3], ...S.gutter].flatMap((p) => (p.t === 2 ? [p.s] : []));

  it('puts the era’s entries, and its inner eras, in each of their lanes, the lanes in pigment order', () => {
    expect(EL.lanes.map((l) => l.id)).toEqual(['politics', 'war', 'economy', 'ideas', 'technology', 'nature', NO_LANE]);
    const lane = (id: string) => EL.lanes[EL.laneOf.get(id)!].id;
    expect(lane('i_owls')).toBe('economy');
    expect(lane('i_plato')).toBe('ideas');
    // Philosophy and religion, and Nature: drawn in each, the arrow keys starting from its first.
    expect(lane('i_plague')).toBe('ideas');
    expect(EL.lanes.filter((l) => l.order.some((x) => x.id === 'i_plague')).map((l) => l.id)).toEqual(['ideas', 'nature']);
    expect(lane('i_b_potidaea')).toBe('war');
    expect(lane('i_pentecontaetia')).toBe(NO_LANE); // an inner era, in no lane of its own
    expect(EL.laneOf.has('i_classical')).toBe(false);
    expect(EL.laneOf.has('i_hoplite')).toBe(false); // Archaic
    const eco = EL.lanes[2];
    expect(eco.spans.map((x) => x.id)).toContain('i_owls');
    expect(eco.moments.every((m) => m.kind === 'event')).toBe(true);
    // Lane counts are the era's highlights in each lane, as level 0's strip counts them.
    expect(EL.lanes.slice(0, 6).map((l) => l.count)).toEqual(['politics', 'war', 'economy', 'ideas', 'technology', 'nature'].map((d) => EL.era!.mix[d as keyof NonNullable<typeof EL.era>["mix"]]));
    // Spans that overlap take different rows; one that follows can share.
    for (const L of EL.lanes) for (const a of L.spans) for (const b of L.spans) {
      if (a !== b && EL.rowOf.get(`${L.id}:${a.id}`) === EL.rowOf.get(`${L.id}:${b.id}`)) expect(a.e <= b.s || b.e <= a.s).toBe(true);
    }
  });

  it('gives entries in no lane a lane of their own at the bottom, and says when a lane is empty', () => {
    const fewer = new Map([...dims].filter(([id, d]) => !d.includes('technology') && id !== 'i_plato'));
    const E2 = eraLanes(D, 'i_classical', fewer)!;
    expect(E2.lanes.map((l) => l.id).at(-1)).toBe(NO_LANE);
    expect(E2.lanes.at(-1)!.label).toBe('No lane yet');
    expect(E2.lanes.at(-1)!.order.map((x) => x.id)).toContain('i_plato');
    const S = layout(D, view(win.start, win.end, { era: E2 }), env(1200, 2400), 1);
    expect(textOf(S)).toContain('No technology here yet.');
    expect(textOf(S)).toContain('NO LANE YET');
    // With nothing in no lane, that lane isn't drawn.
    const all = new Map<string, readonly Lane[]>([...dims, ...E2.lanes.at(-1)!.order.map((x): [string, Lane[]] => [x.id, ['politics']])]);
    expect(eraLanes(D, 'i_classical', all)!.lanes.map((l) => l.id)).not.toContain(NO_LANE);
  });

  it('draws a header with the era’s name and "All eras", lane names with counts, named spans and diamonds', () => {
    const S = open();
    const text = textOf(S);
    expect(text).toContain('Classical Greece');
    expect(text).toContain('‹ All eras');
    expect(text).toContain('ECONOMY');
    expect(text).toContain(`${EL.era!.mix.politics} highlights`);
    expect(text).toContain('Athenian silver “owls”');
    const owls = S.z[1].find((p) => p.id === 'i_owls' && p.cls?.includes('tl-phase'))!;
    expect(owls.t === 0 && owls.dash).toBe(true); // it starts c. 510 BCE
    expect(S.z[1].some((p) => p.t === 6 && p.g.startsWith('diamond'))).toBe(true);
    // "All eras" answers in the gutter; the era's name opens the era; spans are 24 px to tap.
    const back = S.targets.find((t) => t.id === ERAS_BACK)!;
    expect(hitTest(S, back.x + 10, back.y + 10)?.id).toBe(ERAS_BACK);
    const name = S.targets.find((t) => t.id === 'i_classical')!;
    expect(hitTest(S, name.x + 10, name.y + 10)?.id).toBe('i_classical');
    const t = S.targets.find((x) => x.id === 'i_owls')!;
    expect(t.w).toBeGreaterThanOrEqual(MIN_HIT);
    expect(t.h).toBeGreaterThanOrEqual(MIN_HIT);
    expect(hitTest(S, t.x + 4, t.y + t.h / 2)?.id).toBe('i_owls');
    // The lanes scroll under the header.
    expect(maxScroll(D, 400, 1, 1200, { win, era: EL })).toBeGreaterThan(0);
    expect(owls.t === 0 && owls.y).toBeGreaterThan(AXIS_H + HEAD1_H);
  });

  it('is a vertical list on a phone: names above, bars without labels, then a dated list to tap', () => {
    const S = open({}, { ...env(412, 6000), gutter: 0 });
    expect(S.gutter.length).toBe(0);
    const row = S.targets.find((x) => x.id === 'i_owls')!;
    expect(row.w).toBeGreaterThan(300);
    expect(row.h).toBeGreaterThanOrEqual(MIN_HIT);
    const item = S.z[2].find((p) => p.t === 2 && p.id === 'i_owls' && p.cls?.startsWith('tl-list-item'));
    expect(item).toBeDefined();
    // The bar above the list has no label of its own.
    expect(S.z[2].some((p) => p.k === 'qbteconomyi_owls')).toBe(false);
  });

  it('grows out of the era’s band while it opens: the other rows fade and nothing answers a tap', () => {
    const S = open({ zoom: { t: 0.3, fade: false, scroll0: 0 } }, env(1200, 700));
    const band = S.z[0].find((p) => p.cls?.startsWith('tl-era') && p.id === 'i_archaic')!;
    expect(band.a).toBeCloseTo(0.7);
    // The political lane is squeezed into the band, on its way to full height.
    const wash = (X: Scene) => X.z[0].find((p) => p.k === 'qwpolitics')!;
    const now = wash(S), done = wash(open({}, env(1200, 700)));
    expect(now.t === 0 && done.t === 0 && now.h < done.h * 0.6).toBe(true);
    expect(S.targets.filter((t) => t.id !== 'playhead')).toEqual([]);
    // With reduced motion it only fades.
    const F = open({ zoom: { t: 0.3, fade: true, scroll0: 0 } }, env(1200, 700));
    const header = F.z[3].find((p) => p.k === 'qhn')!;
    expect(header.t === 2 && header.y).toBe(AXIS_H + 24);
    expect(header.a).toBeCloseTo(0.3);
  });

  it('steps through a lane in time order, between lanes by time, and says where it is', () => {
    expect(stepLane1(EL, undefined, 'ArrowRight', win)).toBeDefined();
    const eco = EL.lanes[2].order;
    expect(stepLane1(EL, eco[0].id, 'ArrowRight', win)).toBe(eco[1].id);
    expect(stepLane1(EL, eco[0].id, 'Home', win)).toBe(eco[0].id);
    expect(EL.laneOf.get(stepLane1(EL, eco[0].id, 'ArrowDown', win)!)).toBe(3);
    expect(describeLane1(EL, 'i_owls')).toMatch(/^Athenian silver “owls”, c\. 510 BCE – 322 BCE, Economy, \d+ of \d+$/);
  });
});

describe('level 1: a polity’s six lanes', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const prominence = prominenceOf(doc);
  const D = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: overview({ ...doc, items, prominence, now: 2026 }) });
  const dims = entryLanes(items, doc.highlights);
  const members = polityMembers(doc);
  const athens = () => polityLanes(D, 'pol:t_athens', members.get('t_athens')!, dims)!;
  const win = { start: -520, end: -300 };
  const at = (EL: ReturnType<typeof athens>, e = env(1200, 2400), extra: Partial<View> = {}) => layout(D, view(win.start, win.end, { era: EL, ...extra }), e, 1);
  const textOf = (S: Scene) => [...S.z[2], ...S.z[3], ...S.gutter].flatMap((p) => (p.t === 2 ? [p.s] : []));
  const inLane = (EL: ReturnType<typeof athens>, lane: string) => EL.lanes.find((l) => l.id === lane)!.order.map((x) => x.id);

  it('holds Athens’ entries in their lanes: Laurion in Economy, the war in War, an entry in each of its lanes', () => {
    const EL = athens();
    expect(EL.head).toMatchObject({ id: 'pol:t_athens', title: 'Athens (Attica)', back: '‹ Overview', opens: 'i_classical' });
    expect(EL.compact).toBe(true);
    expect(inLane(EL, 'economy')).toContain('i_laurion');
    expect(inLane(EL, 'nature')).toContain('i_laurion');
    expect(inLane(EL, 'war')).toContain('i_pelop');
    expect(EL.laneOf.has('i_classical')).toBe(false); // its own entry is the strip
    expect(EL.lanes.find((l) => l.id === 'war')!.countLabel).toMatch(/^\d+ entries$/);
    // Closed, the Economy lane names Laurion and the War lane the Peloponnesian War (the e2e test looks for them).
    expect(EL.lanes.find((l) => l.id === 'economy')!.ranked.slice(0, 3).map((x) => x.id)).toContain('i_laurion');
    expect(EL.lanes.find((l) => l.id === 'war')!.ranked.slice(0, 3).map((x) => x.id)).toContain('i_pelop');
  });

  it('starts with every lane closed: ticks, the ends of arrows and three of the most prominent named on rows without overlapping', () => {
    const EL = athens();
    const S = at(EL);
    for (const L of EL.lanes) {
      const named = S.z[2].filter((p) => p.t === 2 && p.k.startsWith(`qnt${L.id}`));
      const ends = new Set(EL.influences.flatMap((x) => [x.from === L.id ? x.r.fromId : '', x.to === L.id ? x.r.toId : '']).filter(Boolean));
      expect(named.length).toBeLessThanOrEqual(ends.size + 3);
      // On each of its rows, no name runs into the next.
      for (const y of new Set(named.map((p) => (p.t === 2 ? p.y : 0)))) {
        const xs = named.filter((p) => p.t === 2 && p.y === y).map((p) => (p.t === 2 ? [p.x, p.x + measure('ui', p.s)] : [0, 0])).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < xs.length; i++) expect(xs[i][0]).toBeGreaterThan(xs[i - 1][1]);
      }
    }
    const war = EL.lanes.find((l) => l.id === 'war')!;
    expect(S.z[0].filter((p) => p.k.startsWith('qtwar')).length).toBeGreaterThan(5);
    // The most prominent war is named.
    expect(S.z[2].some((p) => p.t === 2 && p.id === war.ranked[0].id)).toBe(true);
    // The lane's name says how many and opens it.
    expect(textOf(S)).toContain(`Show all ${war.order.length} ▾`);
    const toggle = S.targets.find((t) => t.id === `${LANE_TOGGLE}war` && t.gutter)!;
    expect(hitTest(S, toggle.x + 20, toggle.y + 12)?.id).toBe(`${LANE_TOGGLE}war`);
  });

  it('opens one lane to all its entries, and says when a lane is empty', () => {
    const EL = athens();
    const closedH = maxScroll(D, 400, 1, 1200, { win, era: EL });
    EL.open = 'war';
    const S = at(EL);
    expect(maxScroll(D, 400, 1, 1200, { win, era: EL })).toBeGreaterThan(closedH);
    expect(S.z[1].some((p) => p.id === 'i_pelop' && p.cls?.includes('tl-phase'))).toBe(true);
    expect(textOf(S)).toContain('Show fewer ▴');
    const none = polityLanes(D, 'pol:t_syracuse', [], dims)!;
    expect(textOf(at(none))).toContain('No technology here yet.');
  });

  it('is a vertical list on a phone: the ends of arrows and three most prominent per closed lane, then "Show all"', () => {
    const EL = athens();
    const S = at(EL, { ...env(412, 6000), gutter: 0 });
    const war = EL.lanes.find((l) => l.id === 'war')!;
    const ends = new Set(EL.influences.flatMap((x) => [x.from === 'war' ? x.r.fromId : '', x.to === 'war' ? x.r.toId : '']).filter(Boolean));
    expect(S.z[2].filter((p) => p.t === 2 && p.k.startsWith('qltwar')).length).toBe(ends.size + 3);
    expect(textOf(S)).toContain(`Show all ${war.order.length} ▾`);
  });

  it('puts "+ Add" under each lane’s name in the gutter, and at the end of each heading on a phone, only while in view', () => {
    const EL = athens();
    const S = at(EL);
    expect(S.adds.map((a) => a.lane)).toEqual(EL.lanes.filter((l) => l.id !== NO_LANE).map((l) => l.id));
    for (const a of S.adds) expect(a.x + a.w).toBeLessThanOrEqual(env().gutter);
    const phone = at(EL, { ...env(412, 6000), gutter: 0 });
    for (const a of phone.adds) expect(a.x + a.w).toBeLessThanOrEqual(412);
    // A short timeline only has room for the first lanes' buttons; level 2 has none.
    expect(at(EL, env(1200, 200)).adds.length).toBeLessThan(S.adds.length);
    expect(layout(D, view(win.start, win.end), env(1200, 2400), 2).adds).toEqual([]);
  });

  it('grows out of Athens’ strip while it opens', () => {
    const unfolded = new Map([['g_classical_greece', 1]]);
    const S = at(athens(), env(1200, 700), { zoom: { t: 0.2, fade: false, scroll0: 0 }, unfolded });
    const done = at(athens(), env(1200, 700), { unfolded });
    const wash = (X: Scene) => X.z[0].find((p) => p.k === 'qwpolitics')!;
    const [now, open] = [wash(S), wash(done)];
    expect(now.t === 0 && open.t === 0 && now.h < open.h * 0.5).toBe(true);
    expect(S.targets.filter((t) => t.id !== 'playhead')).toEqual([]);
  });

  it('opens a world event the same way, with what is part of it and connected to it', () => {
    const EL = polityLanes(D, 'i_alexander_persia', ['i_issus', 'i_gaugamela'], dims)!;
    expect(EL.head.sub).toBe('World event · 2 entries');
    expect(inLane(EL, 'war')).toEqual(['i_issus', 'i_gaugamela']);
  });

  it('puts "Open ▾" on the picked strip at level 0', () => {
    const S = layout(D, view(win.start, win.end, { pick: 'pol:t_macedon' }), env(1200, 900), 0);
    const pill = S.targets.find((t) => t.id === OPEN_PICK)!;
    expect(pill).toBeDefined();
    expect(hitTest(S, pill.x + pill.w / 2, pill.y + pill.h / 2)?.id).toBe(OPEN_PICK);
  });

  it('draws an arrow across lanes for each influence, in the cause’s pigment, labelled with its effect', () => {
    const EL = athens();
    const S = at(EL);
    const decelea = EL.influences.find((x) => x.r.fromId === 'i_decelean' && x.r.toId === 'i_owls')!;
    expect(decelea).toMatchObject({ from: 'war', to: 'economy' });
    const arc = S.z[3].find((p) => p.t === 5 && p.k === `inf${decelea.r.id}`);
    expect(arc).toMatchObject({ stroke: 'var(--pig-cinnabar)', from: 'i_decelean', to: 'i_owls' });
    // Both ends are named in their closed lanes, so the arrow has somewhere to go.
    expect(S.laneBoxes.has('war:i_decelean') && S.laneBoxes.has('economy:i_owls')).toBe(true);
    // Its pill, if it found room, opens the connection; else the curve's middle does.
    const target = S.targets.find((t) => t.id === `${ARROW}${decelea.r.id}`)!;
    expect(hitTest(S, target.x + target.w / 2, target.y + target.h / 2)?.id).toBe(`${ARROW}${decelea.r.id}`);
    // A "part of" link and a link inside one lane are not influences.
    expect(EL.influences.every((x) => x.r.type !== 'part-of' && x.from !== x.to)).toBe(true);
  });

  it('puts an arrow in focus on hover: the rest fade, and its label shows', () => {
    const EL = athens();
    const r = EL.influences.find((x) => x.r.fromId === 'i_decelean' && x.r.toId === 'i_owls')!.r;
    const S = at(EL, env(1200, 2400), { hover: `${ARROW}${r.id}` });
    const arcs = S.z[3].filter((p) => p.t === 5 && p.cls?.startsWith('tl-influence') && p.cls !== 'tl-influence-halo');
    expect(arcs.find((p) => p.k === `inf${r.id}`)).toMatchObject({ a: 1, sw: 2.2 });
    expect(arcs.filter((p) => p.k !== `inf${r.id}`).every((p) => p.a < 0.2)).toBe(true);
    expect(S.z[3].some((p) => p.t === 2 && p.id === `${ARROW}${r.id}` && p.s === 'weakened')).toBe(true);
    // Entries it doesn't touch fade too.
    expect(S.z[2].find((p) => p.id === 'i_pelop')?.a).toBeLessThan(0.5);
  });

  it('on a phone lists each end’s effects under it and joins them in the margin', () => {
    const EL = athens();
    EL.open = 'economy';
    const S = at(EL, { ...env(412, 9000), gutter: 0 });
    const lines = S.z[2].filter((p) => p.t === 2 && p.cls === 'tl-effect-line').map((p) => (p.t === 2 ? p.s : ''));
    expect(lines).toContain('weakened by');
    expect(lines).toContain('Decelean War');
    expect(S.z[3].some((p) => p.t === 5 && p.cls === 'tl-margin-arc')).toBe(true);
    expect(S.targets.some((t) => t.id.startsWith(ARROW))).toBe(true);
  });

});

describe('box-select', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const D = prepare(items, lanes, { now: 2026, relations: doc.relations });
  const E = env(1600, 3000);
  const S = layout(D, view(-500, -470), E);
  const around = (ids: string[]) => {
    const bs = ids.map((id) => S.boxes.get(id)!);
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x: x - 1, y: y - 1, w: Math.max(...bs.map((b) => b.x + b.w)) - x + 2, h: Math.max(...bs.map((b) => b.y + b.h)) - y + 2 };
  };

  it('selects what a box touches, drawn in any direction', () => {
    const b = around(['i_marathon']);
    expect(hitBox(S, D, b)).toContain('i_marathon');
    const flipped = { x: b.x + b.w, y: b.y + b.h, w: -b.w, h: -b.h };
    expect(hitBox(S, D, flipped).sort()).toEqual(hitBox(S, D, b).sort());
    // Every entry the box touches is in, and nothing drawn wholly outside it.
    const big = around(['i_marathon', 'i_salamis', 'i_thermopylae']);
    const got = hitBox(S, D, big);
    expect(got).toEqual(expect.arrayContaining(['i_marathon', 'i_salamis', 'i_thermopylae']));
    for (const id of got) {
      const r = S.boxes.get(id)!;
      expect(r.x <= big.x + big.w && r.x + r.w >= big.x && r.y <= big.y + big.h && r.y + r.h >= big.y).toBe(true);
    }
  });
  it('finds nothing in the gutter, over the axis, or in empty space', () => {
    expect(hitBox(S, D, { x: 0, y: AXIS_H, w: E.gutter - 2, h: 2000 })).toEqual([]);
    expect(hitBox(S, D, { x: E.gutter, y: 0, w: 400, h: AXIS_H - 2 })).toEqual([]);
    expect(hitBox(S, D, { x: E.gutter + 10, y: S.contentH + AXIS_H + 50, w: 50, h: 50 })).toEqual([]);
  });
  it('leaves out Claude’s drafts', () => {
    const draft = { id: 'd1', kind: 'event', title: 'Drafted', start: { y: -485 }, categoryId: 'war', updatedAt: 0 } as DatedItem;
    const D2 = prepare(items, lanes, { now: 2026, relations: doc.relations, drafts: [draft] });
    const S2 = layout(D2, view(-500, -470), E);
    expect(S2.boxes.has('d1')).toBe(true);
    expect(hitBox(S2, D2, S2.plot)).not.toContain('d1');
  });
  it('rings each picked entry, and draws the box being drawn', () => {
    const S2 = layout(D, view(-500, -470, { picked: new Set(['i_marathon', 'i_salamis']), box: { x: 300, y: 100, w: -50, h: 40 } }), E);
    const rings = S2.z[3].filter((p) => p.cls === 'tl-picked');
    expect(rings.map((p) => p.id).sort()).toEqual(['i_marathon', 'i_salamis']);
    const box = S2.z[3].find((p) => p.cls === 'tl-box');
    expect(box).toMatchObject({ x: 250, y: 100, w: 50, h: 40 });
  });
});
