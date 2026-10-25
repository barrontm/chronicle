import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDated, toDecimalYear } from '../../model/dates';
import { parseDoc } from '../../model/doc';
import { eraRegions } from '../../model/eras';
import { entryLanes } from '../../model/lanes';
import { lensMarks } from '../../model/lenses';
import { overview } from '../../model/overview';
import { polityMembers } from '../../model/polities';
import { prominence as prominenceOf } from '../../model/prominence';
import type { DatedItem, Lane } from '../../model/types';
import {
  AXIS_H, blockH, blockSpan, describeEra, describeLane1, eraLanes, FOLD, HEAD1_H, head1H, LANE_TOGGLE, openSpan, parseToggle, polityLanes, hitBox, hitTest, layout, LENS_H, maxScroll, MIN_HIT, NO_LANE, prepare, REGION_GROW, regionSpan, stepEra, stepLane1,
  type EraLanes, type Env, type View,
} from './layout';
import { ARROW, RIBBON, RIBBON_FAINT, RIBBON_STRONG } from '../representations/influence';
import { threads } from '../../model/threads';
import type { Measure, Scene } from './scene';

const measure: Measure = (_font, s) => s.length * 7;
const env = (w = 1200, h = 600): Env => ({ w, h, gutter: 188, measure });
const view = (start: number, end: number, extra: Partial<View> = {}): View => ({ win: { start, end }, scrollY: 0, now: 2026, ...extra });
/** Lanes open in place for `key`. */
const opening = (key: string, EL: EraLanes, extra: Partial<View> = {}): Partial<View> => ({ opened: new Map([[key, EL]]), ...extra });
/** What a set of open lanes draws, by the key it drew it with. */
const own = (key: string, k: string) => `${key}|${k}`;

describe('the overview', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const prominence = prominenceOf(doc);
  const O = overview({ ...doc, items, prominence, now: 2026 });
  const D = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: O });
  const textOf = (S: Scene) => [...S.z[2], ...S.gutter].flatMap((p) => (p.t === 2 ? [p.s] : []));
  const open = new Map([['g_classical_greece', 1]]);
  const at = (win: [number, number], extra: Partial<View> = {}, e = env(1200, 1400)) => layout(D, view(win[0], win[1], extra), e);
  const strip = (S: Scene, id: string) => S.z[1].find((p) => p.t === 7 && p.id === id);

  it('puts each era’s theme chips on its wash, and the band grows a line for each line they take', () => {
    const bare = doc.items.filter(isDated).map((i) => ({ ...i, themes: undefined }));
    const D0 = prepare(bare, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(bare, doc.highlights, doc.relations, 2026), overview: O });
    const chips = (S: Scene) => S.z[2].filter((p) => p.cls?.startsWith('tl-chip') && p.t === 0);
    const greece = (S: Scene) => S.targets.filter((t) => t.id === 'i_classical')[0];
    const wide = at([-520, -300]), narrow = at([-900, 100]);
    expect(chips(wide).map((p) => p.id)).toContain('theme:i_classical:t-war');
    expect(chips(wide)).toHaveLength(8);
    expect(textOf(wide)).toContain('Peloponnesian War');
    // Narrower, the chips wrap onto more lines and the band grows to hold them all.
    expect(chips(narrow)).toHaveLength(8);
    const plain = layout(D0, view(-900, 100), env(1200, 1400));
    expect(greece(narrow).h).toBeGreaterThan(greece(plain).h);
    expect(greece(narrow).h).toBeGreaterThan(greece(wide).h);
    // A chip is a target of its own on top of the wash.
    const c = wide.targets.find((t) => t.id === 'theme:i_classical:t-dem')!;
    expect(hitTest(wide, c.x + 4, c.y + 4)?.id).toBe('theme:i_classical:t-dem');
  });

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
    expect(regionSpan(D, view(win[0], win[1], { region: 'Persia' }), 'Persia', env())![0]).toBeGreaterThan(regionSpan(D, view(win[0], win[1]), 'Greece', env())![0]);
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
    const S = layout(D2, view(-820, -10), env(1200, 1400));
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
    const empty = layout(prepare([], [], { now: 2026, overview: overview({ items: [], territories: [], relations: [], highlights: [], prominence: () => 0, now: 2026 }) }), view(-800, 0), env());
    expect(textOf(empty)).toContain('Nothing on the timeline yet');
  });

  it('puts region names on their bands on a phone, with no gutter', () => {
    const S = layout(D, view(-820, -10), { ...env(412, 1400), gutter: 0 });
    expect(S.gutter.length).toBe(0);
    const name = S.z[2].find((p) => p.t === 2 && p.s === 'Greece')!;
    const wash = S.z[0].find((p) => p.t === 0 && p.id === 'i_archaic')!;
    expect(name.t === 2 && wash.t === 0 && name.y > wash.y && name.y < wash.y + wash.h).toBe(true);
  });

  it('scrolls as far as its bands go, further with a group open', () => {
    const shut = maxScroll(D, 400, 1200, view(-820, -10));
    expect(shut).toBeGreaterThan(0);
    expect(maxScroll(D, 400, 1200, view(-820, -10, { unfolded: open }))).toBeGreaterThan(shut);
  });

  it('steps through eras with the arrow keys and describes them', () => {
    const win = { start: -820, end: -10 };
    expect(stepEra(D, undefined, 'ArrowRight', win)).toBeDefined();
    expect(stepEra(D, 'i_archaic', 'ArrowRight', win)).toBe('i_classical');
    expect(stepEra(D, 'i_classical', 'End', win)).toBe('i_hellenistic');
    expect(describeEra(D, 'i_classical')).toMatch(/^Classical Greece, 480–323 BCE, Greece, \d+ highlights, 2 of 6$/);
  });

  it('a lens adds a strip of its lane’s ticks under every band, and never moves what’s above it', () => {
    const lanesOf = entryLanes(doc.items, doc.highlights);
    const lenses = lensMarks({
      entries: items.map((i) => ({ id: i.id, s: toDecimalYear(i.start) })),
      polities: polityMembers(doc),
      polityItems: new Map(doc.territories.flatMap((t) => (t.itemId ? [[t.itemId, t.id] as const] : []))),
      polityRegions: new Map(O.polities.map((p) => [p.id, p.region])),
      eras: eraRegions(items, doc.highlights, doc.relations, 2026).flatMap((r) => r.eras),
      lanesOf,
    });
    const DL = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: O, lenses });
    const win: [number, number] = [-520, -300];
    const plain = layout(DL, view(win[0], win[1]), env(1200, 1400));
    const S = layout(DL, view(win[0], win[1], { lenses: ['war'] }), env(1200, 1400));
    const ticks = S.z[1].filter((p) => p.cls?.startsWith('tl-lens-tick'));
    expect(ticks.map((p) => p.id)).toContain('i_lade');
    expect(plain.z[1].some((p) => p.cls?.startsWith('tl-lens'))).toBe(false);
    // One strip per band, named in the gutter, in the lane's pigment.
    expect(S.z[0].filter((p) => p.cls === 'tl-lens')).toHaveLength(DL.bands.length);
    expect(S.gutter.filter((p) => p.t === 2 && p.s === 'War')).toHaveLength(DL.bands.length);
    expect(ticks.every((p) => p.t === 0 && p.fill === 'var(--pig-cinnabar)')).toBe(true);
    // Strips stay where they were; only the bands' feet move down.
    const top = (X: Scene, id: string) => X.targets.find((t) => t.id === id)!;
    expect(top(S, 'pol:t_persia').y).toBeGreaterThan(top(plain, 'pol:t_persia').y);
    expect(top(S, 'pol:t_syracuse').y).toBe(top(plain, 'pol:t_syracuse').y);
    // Greece is the third band: the two above it each grew by one strip.
    expect(top(S, 'grp:g_classical_greece').y).toBe(top(plain, 'grp:g_classical_greece').y + 2 * (2 + LENS_H));
    // Two lenses, two strips a band; a tick opens its entry.
    const two = layout(DL, view(win[0], win[1], { lenses: ['war', 'economy'] }), env(1200, 1400));
    expect(two.z[0].filter((p) => p.cls === 'tl-lens')).toHaveLength(DL.bands.length * 2);
    const t = S.targets.find((x) => x.id === 'i_lade')!;
    expect(hitTest(S, t.x + t.w / 2, t.y + t.h / 2)?.id).toBe('i_lade');
  });
});

describe('threads', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const prominence = prominenceOf(doc);
  const eras = eraRegions(items, doc.highlights, doc.relations, 2026);
  const T = threads({
    relations: doc.relations, polities: polityMembers(doc), polityRegions: new Map(doc.territories.map((t) => [t.id, t.region ?? ''])),
    eras: eras.flatMap((r) => r.eras), lanesOf: entryLanes(doc.items, doc.highlights), prominence,
    years: (id) => { const i = doc.items.find((x) => x.id === id); return i?.start ? { s: toDecimalYear(i.start), e: toDecimalYear(i.end ?? i.start) } : undefined; },
  });
  const D = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras, overview: overview({ ...doc, items, prominence, now: 2026 }), threads: T });
  const open = new Map([['g_classical_greece', 1]]);
  const at = (extra: Partial<View> = {}, w = 1200) => layout(D, view(-520, -300, { unfolded: open, ...extra }), env(w, 1400));
  const ribbons = (S: Scene) => S.z[1].filter((p) => p.cls?.startsWith('tl-ribbon'));
  const labels = (S: Scene) => S.z[2].flatMap((p) => (p.t === 2 && p.cls === 'tl-thread-label' ? [p.s] : []));
  const stripA = (S: Scene, id: string) => S.z[1].find((p) => p.t === 7 && p.id === id)!.a;

  it('draws nothing until a strip is in focus', () => {
    expect(ribbons(at())).toHaveLength(0);
  });

  it('lights up Athens’ threads when its strip is hovered: a ribbon to Macedon with its count, and the strips it doesn’t touch fade', () => {
    const S = at({ threadHover: 'pol:t_athens' });
    const rb = ribbons(S).find((p) => p.id === `${RIBBON}pol:t_athens|pol:t_macedon`)!;
    expect(rb).toBeDefined();
    expect(rb.a).toBe(RIBBON_STRONG);
    expect(labels(S)).toContain('3 · influenced');
    expect(S.ribbons?.get(rb.id!)).toEqual({ ids: expect.arrayContaining(['r_39', 'r_philippics', 'r_to_philip']), title: 'Athens and Macedon' });
    expect(stripA(S, 'pol:t_macedon')).toBe(1);
    expect(stripA(S, 'pol:t_persia')).toBeLessThan(0.5);
    // It runs in the gutter under Greece's band, not across Macedon's rows.
    expect(rb.t === 5 && /H/.test(rb.d)).toBe(true);
  });

  it('a picked strip keeps its threads; a folded group carries its members’ ribbons', () => {
    expect(labels(at({ pick: 'pol:t_athens' }))).toContain('3 · influenced');
    const folded = layout(D, view(-520, -300, { threadHover: 'grp:g_classical_greece' }), env(1200, 1400));
    expect(ribbons(folded).map((p) => p.id)).toContain(`${RIBBON}grp:g_classical_greece|pol:t_macedon`);
  });

  it('“Show all threads” draws every ribbon faintly, and not on the phone', () => {
    const all = ribbons(at({ allThreads: true }));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.a === RIBBON_FAINT)).toBe(true);
    expect(labels(at({ allThreads: true }))).toHaveLength(0);
    expect(ribbons(at({ allThreads: true }, 420))).toHaveLength(0);
  });
});

describe('an era’s six lanes, open under its band', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const D = prepare(items, lanes, { now: 2026, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: overview({ ...doc, items, prominence: () => 0, now: 2026 }) });
  const dims = entryLanes(items, doc.highlights);
  const EL = eraLanes(D, 'i_classical', dims)!;
  const win = { start: -490, end: -312 };
  const open = (extra: Partial<View> = {}, e = env(1200, 2400)) => layout(D, view(win.start, win.end, opening('i_classical', EL, extra)), e);
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
    const S = layout(D, view(win.start, win.end, opening('i_classical', E2)), env(1200, 2400));
    expect(textOf(S)).toContain('No technology here yet.');
    expect(textOf(S)).toContain('NO LANE YET');
    // With nothing in no lane, that lane isn't drawn.
    const all = new Map<string, readonly Lane[]>([...dims, ...E2.lanes.at(-1)!.order.map((x): [string, Lane[]] => [x.id, ['politics']])]);
    expect(eraLanes(D, 'i_classical', all)!.lanes.map((l) => l.id)).not.toContain(NO_LANE);
  });

  it('draws a head with the era’s name and "Fold", lane names with counts, named spans and diamonds', () => {
    const S = open();
    const text = textOf(S);
    expect(text).toContain('Classical Greece');
    expect(text).toContain('▴ Fold');
    expect(text).toContain('ECONOMY');
    expect(text).toContain(`${EL.era!.mix.politics} highlights`);
    expect(text).toContain('Athenian silver “owls”');
    const owls = S.z[1].find((p) => p.id === 'i_owls' && p.cls?.includes('tl-phase'))!;
    expect(owls.t === 0 && owls.dash).toBe(true); // it starts c. 510 BCE
    expect(S.z[1].some((p) => p.t === 6 && p.g.startsWith('diamond'))).toBe(true);
    // "Fold" answers in the gutter; the era's name opens the era; spans are 24 px to tap.
    const fold = S.targets.find((t) => t.id === `${FOLD}i_classical`)!;
    expect(hitTest(S, fold.x + 10, fold.y + 10)?.id).toBe(`${FOLD}i_classical`);
    const name = S.targets.find((t) => t.id === 'i_classical' && t.lane === 'head')!;
    expect(hitTest(S, name.x + 10, name.y + 10)).toMatchObject({ id: 'i_classical', lane: 'head' });
    const t = S.targets.find((x) => x.id === 'i_owls')!;
    expect(t.w).toBeGreaterThanOrEqual(MIN_HIT);
    expect(t.h).toBeGreaterThanOrEqual(MIN_HIT);
    expect(hitTest(S, t.x + 4, t.y + t.h / 2)?.id).toBe('i_owls');
    // The lanes sit under the band's head, and make the overview scroll further.
    expect(maxScroll(D, 400, 1200, { win, ...opening('i_classical', EL) })).toBeGreaterThan(maxScroll(D, 400, 1200, { win }));
    const greece = regionSpan(D, { win }, 'Greece', env(1200, 2400))!;
    expect(owls.t === 0 && owls.y).toBeGreaterThan(AXIS_H + greece[0] + HEAD1_H);
  });

  it('lines its theme chips up under the name, and a picked theme fades everything outside it', () => {
    expect(EL.themes.map((t) => t.theme.id)).toContain('t-war');
    expect(head1H(EL, env(1200, 2400))).toBeGreaterThan(HEAD1_H);
    // One line, ending in "+N more" when they don't all fit; opened, they take as many lines as they need.
    const phone = { ...env(412, 2400), gutter: 0 };
    expect(head1H(EL, phone)).toBe(HEAD1_H + 25);
    const shut = layout(D, view(win.start, win.end, opening('i_classical', EL)), phone);
    expect(textOf(shut).some((t) => /^\+\d+ more$/.test(t))).toBe(true);
    const opened = { ...EL, allThemes: true };
    expect(head1H(opened, phone)).toBeGreaterThan(head1H(EL, phone));
    expect(textOf(layout(D, view(win.start, win.end, opening('i_classical', opened)), phone))).toContain('Show fewer');
    // A picked theme past the first line opens them all.
    const lastKey = `${EL.themes.at(-1)!.era}:${EL.themes.at(-1)!.theme.id}`;
    expect(head1H(EL, phone, lastKey)).toBe(head1H(opened, phone));
    const war = EL.themes.find((t) => t.theme.id === 't-war')!.theme;
    const S = open({ theme: { key: 'i_classical:t-war', ids: new Set(war.ids) } });
    const chip = S.z[2].find((p) => p.t === 0 && p.id === 'theme:i_classical:t-war' && p.k.startsWith('i_classical|'))!;
    expect(chip.cls).toContain('picked');
    const marks = [...S.z[1], ...S.z[2]].filter((p) => p.id && p.cls && !p.id.startsWith('theme:'));
    const inIt = marks.filter((p) => war.ids.includes(p.id!)), outside = marks.filter((p) => !war.ids.includes(p.id!) && D.byId.has(p.id!));
    expect(inIt.length).toBeGreaterThan(0);
    expect(inIt.every((p) => !p.cls!.includes('dimmed'))).toBe(true);
    expect(outside.some((p) => p.cls!.includes('dimmed'))).toBe(true);
    expect(textOf(open())).toContain('Athenian democracy');
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
    expect(S.z[2].some((p) => p.k === own('i_classical', 'qbteconomyi_owls'))).toBe(false);
  });

  it('unfurls under the band: what’s below moves down with it, nothing in it answers a tap until it’s open', () => {
    const E = env(1200, 3000);
    const S = open({ openT: new Map([['i_classical', 0.3]]) }, E), done = open({}, E), shut = layout(D, view(win.start, win.end), E);
    // The political lane is squeezed, on its way to full height.
    const wash = (X: Scene) => X.z[0].find((p) => p.k === own('i_classical', 'qwpolitics'))!;
    const [now, full] = [wash(S), wash(done)];
    expect(now.t === 0 && full.t === 0 && now.h < full.h * 0.6).toBe(true);
    expect(S.targets.some((t) => D.byId.has(t.id) && t.lane)).toBe(false);
    // Persia's band, under Greece's, moves down by as much as the lanes take.
    const persia = (X: Scene) => X.targets.find((t) => t.id === 'pol:t_persia')!.y;
    const h = blockH(EL, E);
    expect(persia(done) - persia(shut)).toBeCloseTo(h, 5);
    expect(persia(S) - persia(shut)).toBeCloseTo(h * 0.3, 5);
    // With reduced motion it only fades, already at its full height.
    const F = open({ openT: new Map([['i_classical', 0.3]]), openFade: true }, E);
    expect(persia(F)).toBeCloseTo(persia(done), 5);
    const name = F.z[2].find((p) => p.k === own('i_classical', 'qhn'))!;
    expect(name.a).toBeCloseTo(0.3);
  });

  it('steps through a lane in time order, between lanes by time, and says where it is', () => {
    expect(stepLane1([EL], undefined, 'ArrowRight', win)).toBeDefined();
    const eco = EL.lanes[2].order;
    expect(stepLane1([EL], eco[0].id, 'ArrowRight', win)).toBe(eco[1].id);
    expect(stepLane1([EL], eco[0].id, 'Home', win)).toBe(eco[0].id);
    expect(EL.laneOf.get(stepLane1([EL], eco[0].id, 'ArrowDown', win)!)).toBe(3);
    expect(describeLane1(EL, 'i_owls')).toMatch(/^Athenian silver “owls”, c\. 510 BCE – 322 BCE, Economy, \d+ of \d+$/);
  });
});

describe('a polity’s six lanes, open under its strip', () => {
  const doc = parseDoc(readFileSync(new URL('../../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const items = doc.items.filter(isDated);
  const lanes = doc.categories.map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const prominence = prominenceOf(doc);
  const D = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: overview({ ...doc, items, prominence, now: 2026 }) });
  const dims = entryLanes(items, doc.highlights);
  const members = polityMembers(doc);
  const athens = () => polityLanes(D, 'pol:t_athens', members.get('t_athens')!, dims)!;
  const win = { start: -520, end: -300 };
  const unfolded = new Map([['g_classical_greece', 1]]);
  const at = (EL: ReturnType<typeof athens>, e = env(1200, 2400), extra: Partial<View> = {}) => layout(D, view(win.start, win.end, opening(EL.head.id, EL, { unfolded, ...extra })), e);
  const toggleOf = (EL: EraLanes, lane: string) => `${LANE_TOGGLE}${EL.head.id}|${lane}`;
  const textOf = (S: Scene) => [...S.z[2], ...S.z[3], ...S.gutter].flatMap((p) => (p.t === 2 ? [p.s] : []));
  const inLane = (EL: ReturnType<typeof athens>, lane: string) => EL.lanes.find((l) => l.id === lane)!.order.map((x) => x.id);

  it('holds Athens’ entries in their lanes: Laurion in Economy, the war in War, an entry in each of its lanes', () => {
    const EL = athens();
    expect(EL.head).toMatchObject({ id: 'pol:t_athens', title: 'Athens (Attica)', opens: 'i_classical' });
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
      const named = S.z[2].filter((p) => p.t === 2 && p.k.startsWith(own('pol:t_athens', `qnt${L.id}`)));
      const ends = new Set(EL.influences.flatMap((x) => [x.from === L.id ? x.r.fromId : '', x.to === L.id ? x.r.toId : '']).filter(Boolean));
      expect(named.length).toBeLessThanOrEqual(ends.size + 3);
      // On each of its rows, no name runs into the next.
      for (const y of new Set(named.map((p) => (p.t === 2 ? p.y : 0)))) {
        const xs = named.filter((p) => p.t === 2 && p.y === y).map((p) => (p.t === 2 ? [p.x, p.x + measure('ui', p.s)] : [0, 0])).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < xs.length; i++) expect(xs[i][0]).toBeGreaterThan(xs[i - 1][1]);
      }
    }
    const war = EL.lanes.find((l) => l.id === 'war')!;
    expect(S.z[0].filter((p) => p.k.startsWith(own('pol:t_athens', 'qtwar'))).length).toBeGreaterThan(5);
    // The most prominent war is named.
    expect(S.z[2].some((p) => p.t === 2 && p.id === war.ranked[0].id)).toBe(true);
    // The lane's name says how many and opens it.
    expect(textOf(S)).toContain(`Show all ${war.order.length} ▾`);
    const toggle = S.targets.find((t) => t.id === toggleOf(EL, 'war') && t.gutter)!;
    expect(hitTest(S, toggle.x + 20, toggle.y + 12)?.id).toBe(toggleOf(EL, 'war'));
    expect(parseToggle(toggle.id)).toEqual(['pol:t_athens', 'war']);
  });

  it('carries the themes of the eras its region had while it lived, outer eras first; a world event has none', () => {
    expect(athens().themes.map((t) => `${t.era}:${t.theme.id}`)).toContain('i_classical:t-war');
    expect(athens().themes[0].era).toBe('i_classical');
    expect(polityLanes(D, 'i_alexander_persia', ['i_issus'], dims)!.themes).toEqual([]);
  });

  it('opens one lane to all its entries, and says when a lane is empty', () => {
    const EL = athens();
    const closedH = maxScroll(D, 400, 1200, { win, unfolded, ...opening(EL.head.id, EL) });
    EL.open = 'war';
    const S = at(EL);
    expect(maxScroll(D, 400, 1200, { win, unfolded, ...opening(EL.head.id, EL) })).toBeGreaterThan(closedH);
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
    expect(S.z[2].filter((p) => p.t === 2 && p.k.startsWith(own('pol:t_athens', 'qltwar'))).length).toBe(ends.size + 3);
    expect(textOf(S)).toContain(`Show all ${war.order.length} ▾`);
  });

  it('puts "+ Add" under each lane’s name in the gutter, and at the end of each heading on a phone, only while in view', () => {
    const EL = athens();
    const S = at(EL);
    expect(S.adds.map((a) => a.lane)).toEqual(EL.lanes.filter((l) => l.id !== NO_LANE).map((l) => l.id));
    expect(S.adds.every((a) => a.block === 'pol:t_athens')).toBe(true);
    for (const a of S.adds) expect(a.x + a.w).toBeLessThanOrEqual(env().gutter);
    const phone = at(EL, { ...env(412, 6000), gutter: 0 });
    for (const a of phone.adds) expect(a.x + a.w).toBeLessThanOrEqual(412);
    // A short timeline only has room for the lanes in view; with nothing open there are none.
    expect(at(EL, env(1200, 500)).adds.length).toBeLessThan(S.adds.length);
    expect(layout(D, view(win.start, win.end, { unfolded }), env(1200, 2400)).adds).toEqual([]);
  });

  it('unfurls right under Athens’ strip, the window and everything above it where they were', () => {
    const E = env(1200, 3000);
    const EL = athens();
    const shut = layout(D, view(win.start, win.end, { unfolded }), E), S = at(EL, E);
    const y = (X: Scene, id: string) => X.targets.find((t) => t.id === id)!.y;
    // Athens and what's above it stay put; Sparta, the next row, moves down by the lanes' height.
    expect(y(S, 'pol:t_athens')).toBe(y(shut, 'pol:t_athens'));
    expect(y(S, 'pol:t_macedon')).toBe(y(shut, 'pol:t_macedon'));
    expect(y(S, 'pol:t_sparta') - y(shut, 'pol:t_sparta')).toBeCloseTo(blockH(EL, E), 5);
    // The lanes start just under Athens' row.
    const lanes = blockSpan(D, { win, unfolded, ...opening(EL.head.id, EL) }, 'pol:t_athens', E)!;
    const athensRow = S.targets.find((t) => t.id === 'pol:t_athens')!;
    expect(AXIS_H + lanes[0]).toBeGreaterThanOrEqual(athensRow.y + athensRow.h);
    expect(AXIS_H + lanes[0]).toBeLessThan(athensRow.y + athensRow.h + 8);
    // Half open, nothing in it answers a tap yet.
    const half = at(EL, E, { openT: new Map([['pol:t_athens', 0.5]]) });
    expect(half.targets.some((t) => t.id.startsWith(LANE_TOGGLE))).toBe(false);
  });

  it('opens several at once, each under its own strip, each answering for itself', () => {
    const E = env(1200, 4000);
    const A = athens(), Sp = polityLanes(D, 'pol:t_sparta', members.get('t_sparta')!, dims)!;
    const both = layout(D, view(win.start, win.end, { unfolded, opened: new Map([['pol:t_athens', A], ['pol:t_sparta', Sp]]) }), E);
    const a = blockSpan(D, { win, unfolded, opened: new Map([['pol:t_athens', A], ['pol:t_sparta', Sp]]) }, 'pol:t_athens', E)!;
    const s = blockSpan(D, { win, unfolded, opened: new Map([['pol:t_athens', A], ['pol:t_sparta', Sp]]) }, 'pol:t_sparta', E)!;
    expect(s[0]).toBeGreaterThan(a[1]);
    // Two War lanes, two toggles that don't answer for each other, and no two primitives share a key.
    expect(both.targets.filter((t) => t.id === toggleOf(A, 'war') || t.id === toggleOf(Sp, 'war')).map((t) => t.id)).toEqual(expect.arrayContaining([toggleOf(A, 'war'), toggleOf(Sp, 'war')]));
    const keys = [...both.z.flat(), ...both.gutter].map((p) => p.k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(both.targets.filter((t) => t.id.startsWith(FOLD)).map((t) => t.id).sort()).toEqual([`${FOLD}pol:t_athens`, `${FOLD}pol:t_sparta`]);
    // Hovering Athens' War toggle lights only Athens'.
    const hot = layout(D, view(win.start, win.end, { unfolded, hover: toggleOf(A, 'war'), opened: new Map([['pol:t_athens', A], ['pol:t_sparta', Sp]]) }), E);
    const ink = (key: string) => hot.gutter.find((p) => p.k === own(key, 'qgcwar'));
    expect(ink('pol:t_athens')).toMatchObject({ fill: 'var(--ink)' });
    expect(ink('pol:t_sparta')).toMatchObject({ fill: 'var(--muted)' });
  });

  it('finds where an entry sits in the open lanes, to scroll to it', () => {
    const EL = athens();
    EL.open = 'economy';
    const V = { win, unfolded, ...opening(EL.head.id, EL) };
    const ys = openSpan(D, V, 'i_laurion', env(1200, 2400))!;
    const lanes = blockSpan(D, V, 'pol:t_athens', env(1200, 2400))!;
    expect(ys[0]).toBeGreaterThan(lanes[0]);
    expect(ys[1]).toBeLessThan(lanes[1]);
    expect(openSpan(D, { win, unfolded }, 'i_laurion', env(1200, 2400))).toBeUndefined();
  });

  it('opens a world event the same way, with what is part of it and connected to it', () => {
    const EL = polityLanes(D, 'i_alexander_persia', ['i_issus', 'i_gaugamela'], dims)!;
    expect(EL.head.sub).toBe('World event · 2 entries');
    expect(inLane(EL, 'war')).toEqual(['i_issus', 'i_gaugamela']);
  });

  it('draws Claude’s drafts in their lanes as dashed umber ghosts with a "?", named even when closed', () => {
    const draft = { id: 'd1', kind: 'event', title: 'Drafted battle', start: { y: -460 }, categoryId: items[0].categoryId, updatedAt: 0 } as DatedItem;
    const D2 = prepare(items, lanes, { now: 2026, prominence, relations: doc.relations, drafts: [draft], eras: eraRegions(items, doc.highlights, doc.relations, 2026), overview: overview({ ...doc, items, prominence, now: 2026 }) });
    const EL = polityLanes(D2, 'pol:t_athens', [...members.get('t_athens')!, 'd1'], new Map([...dims, ['d1', ['war']]]))!;
    expect(EL.lanes.find((l) => l.id === 'war')!.order.map((x) => x.id)).toContain('d1');
    // It isn't counted among Athens' entries.
    expect(EL.head.sub).toBe(athens().head.sub);
    const S = layout(D2, view(win.start, win.end, opening(EL.head.id, EL, { unfolded })), env(1200, 2400));
    const mark = S.z[1].find((p) => p.id === 'd1')!;
    expect(mark).toMatchObject({ color: 'var(--pig-umber)', g: 'diamond-approx' });
    expect(mark.cls).toContain('tl-draft');
    expect(S.z[2].some((p) => p.t === 2 && p.id === 'd1' && p.s.endsWith('?'))).toBe(true);
    // The arrow keys skip it.
    const war = EL.lanes.find((l) => l.id === 'war')!.order.filter((x) => !x.draft);
    expect(war.length).toBeGreaterThan(1);
    for (let i = 0, id = war[0].id; i < war.length; i++, id = stepLane1([EL], id, 'ArrowRight', win)!) expect(id).not.toBe('d1');
  });

  it('lets the open entry be dragged in its lane: its body, and both ends of a span wide enough', () => {
    const EL = athens();
    EL.open = 'war';
    const S = at(EL, env(1200, 2400), { selected: 'i_pelop', editable: true });
    const grips = S.targets.filter((t) => t.id === 'i_pelop' && t.grip).map((t) => t.grip);
    expect(grips).toEqual(expect.arrayContaining(['body', 'start', 'end']));
    // Not while it isn't open, nor when nothing may be moved.
    expect(at(EL, env(1200, 2400), { editable: true }).targets.some((t) => t.grip)).toBe(false);
    expect(at(EL, env(1200, 2400), { selected: 'i_pelop' }).targets.some((t) => t.grip)).toBe(false);
    // While it's dragged a copy shows where it'd go, in its lane's pigment, and its new dates sit on the axis.
    const body = S.targets.find((t) => t.id === 'i_pelop' && t.grip === 'body')!;
    const D2 = at(EL, env(1200, 2400), { selected: 'i_pelop', editable: true, drag: { id: 'i_pelop', s: -420, e: -393, label: '420–393 BCE', y: body.y, color: 'var(--pig-cinnabar)' } });
    expect(D2.z[3].find((p) => p.k === 'dragb')).toMatchObject({ fill: expect.stringContaining('--pig-cinnabar'), y: body.y + 4 });
    expect(D2.axis.some((p) => p.t === 2 && p.s === '420–393 BCE')).toBe(true);
    expect(D2.z[1].filter((p) => p.id === 'i_pelop').every((p) => p.a === 0.35)).toBe(true);
  });

  it('draws an arrow across lanes for each influence, in the cause’s pigment, labelled with its effect', () => {
    const EL = athens();
    const S = at(EL);
    const decelea = EL.influences.find((x) => x.r.fromId === 'i_decelean' && x.r.toId === 'i_owls')!;
    expect(decelea).toMatchObject({ from: 'war', to: 'economy' });
    const arc = S.z[3].find((p) => p.t === 5 && p.k === own('pol:t_athens', `inf${decelea.r.id}`));
    expect(arc).toMatchObject({ stroke: 'var(--pig-cinnabar)', from: 'i_decelean', to: 'i_owls' });
    // Both ends are named in their closed lanes, so the arrow has somewhere to go.
    expect(S.boxes.has('i_decelean') && S.boxes.has('i_owls')).toBe(true);
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
    expect(arcs.find((p) => p.k === own('pol:t_athens', `inf${r.id}`))).toMatchObject({ a: 1, sw: 2.2 });
    expect(arcs.filter((p) => p.k !== own('pol:t_athens', `inf${r.id}`)).every((p) => p.a < 0.2)).toBe(true);
    expect(S.z[3].some((p) => p.t === 2 && p.id === `${ARROW}${r.id}` && p.s === 'weakened')).toBe(true);
    // Entries it doesn't touch fade too.
    expect(S.z[2].find((p) => p.id === 'i_pelop' && p.k.startsWith('pol:t_athens|'))?.a).toBeLessThan(0.5);
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
  const eras = eraRegions(items, doc.highlights, doc.relations, 2026);
  const O = overview({ ...doc, items, prominence: () => 0, now: 2026 });
  const dims = entryLanes(items, doc.highlights);
  const D = prepare(items, lanes, { now: 2026, relations: doc.relations, eras, overview: O });
  const E = env(1600, 3000);
  // The eras the Persian Wars' battles are in, open, their entries in their lanes.
  const ids = ['i_marathon', 'i_salamis', 'i_thermopylae'];
  const keys = [...new Set(ids.map((id) => D.regions.flatMap((r) => r.eras).find((e) => eraLanes(D, e.id, dims)!.laneOf.has(id))!.id))];
  const classical = (): Partial<View> => ({ opened: new Map(keys.map((k) => [k, eraLanes(D, k, dims)!])) });
  const S = layout(D, view(-500, -470, classical()), E);
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
    const D2 = prepare(items, lanes, { now: 2026, relations: doc.relations, drafts: [draft], eras, overview: O });
    const EL = polityLanes(D2, 'pol:t_athens', ['i_marathon', 'd1'], new Map([...dims, ['d1', ['war']]]))!;
    const S2 = layout(D2, view(-500, -470, opening('pol:t_athens', EL, { unfolded: new Map([['g_classical_greece', 1]]) })), E);
    expect(S2.boxes.has('d1')).toBe(true);
    expect(hitBox(S2, D2, S2.plot)).not.toContain('d1');
  });
  it('rings each picked entry, and draws the box being drawn', () => {
    const S2 = layout(D, view(-500, -470, { ...classical(), picked: new Set(['i_marathon', 'i_salamis']), box: { x: 300, y: 100, w: -50, h: 40 } }), E);
    const rings = S2.z[3].filter((p) => p.cls === 'tl-picked');
    expect(rings.map((p) => p.id).sort()).toEqual(['i_marathon', 'i_salamis']);
    const box = S2.z[3].find((p) => p.cls === 'tl-box');
    expect(box).toMatchObject({ x: 250, y: 100, w: 50, h: 40 });
  });
});
