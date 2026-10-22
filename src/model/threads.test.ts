import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toDecimalYear } from './dates';
import { parseDoc } from './doc';
import { eraRegions } from './eras';
import { entryLanes } from './lanes';
import { polityMembers } from './polities';
import { prominence } from './prominence';
import { linkYear, threadEnds, threadLabel, threads, threadsAround, type ThreadInput } from './threads';
import type { Lane, Relation } from './types';

const read = (path: string) => readFileSync(new URL(`../../tests/fixtures/${path}`, import.meta.url), 'utf8');
const doc = parseDoc(read('greece/classical-greece.json'));

function fixtureInput(): ThreadInput {
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  return {
    relations: doc.relations,
    polities: polityMembers(doc),
    polityItems: new Map(doc.territories.flatMap((t) => (t.itemId ? [[t.itemId, t.id] as const] : []))),
    polityRegions: new Map(doc.territories.map((t) => [t.id, t.region ?? ''])),
    eras: eraRegions(doc.items, doc.highlights, doc.relations, 2026).flatMap((r) => r.eras),
    lanesOf: entryLanes(doc.items, doc.highlights),
    prominence: prominence(doc),
    years: (id) => { const i = byId.get(id); return i?.start ? { s: toDecimalYear(i.start), e: toDecimalYear(i.end ?? i.start) } : undefined; },
  };
}

const rel = (id: string, fromId: string, toId: string, extra: Partial<Relation> = {}): Relation => ({ id, fromId, toId, type: 'influenced', updatedAt: 0, ...extra });
const tiny = (relations: Relation[], extra: Partial<ThreadInput> = {}): ThreadInput => ({
  relations,
  polities: new Map([['athens', ['pericles', 'parthenon', 'plague']], ['macedon', ['philip']], ['sparta', ['lysander']]]),
  lanesOf: new Map<string, Lane[]>([['pericles', ['politics']], ['philip', ['war']], ['plague', ['nature']], ['parthenon', ['ideas']]]),
  prominence: (id) => (id === 'pericles' ? 20 : 0),
  years: (id) => ({ pericles: { s: -494, e: -429 }, philip: { s: -381, e: -336 }, lysander: { s: -450, e: -395 }, plague: { s: -430, e: -426 }, parthenon: { s: -447, e: -432 }, alex: { s: -284, e: 642 }, baghdad: { s: 830, e: 1258 } } as Record<string, { s: number; e: number }>)[id],
  ...extra,
});

describe('threads', () => {
  it('on the Greece fixture, rolls Athens’ links to Macedon into one ribbon with its count and main effect', () => {
    const T = threads(fixtureInput());
    const am = T.find((t) => t.key === 'pol:t_athens|pol:t_macedon')!;
    expect(am).toBeDefined();
    expect(threadLabel(am)).toBe('3 · influenced');
    expect(am.links.map((l) => l.r.id).sort()).toEqual(['r_39', 'r_philippics', 'r_to_philip']);
    // Heaviest first.
    for (let i = 1; i < am.links.length; i++) expect(am.links[i - 1].weight).toBeGreaterThanOrEqual(am.links[i].weight);
    expect(am.lane).toBe('ideas');
    // A war fought by Athens and Sparta is in both: inside, not a thread between them.
    expect(T.some((t) => t.key === 'pol:t_athens|pol:t_sparta')).toBe(false);
    for (const t of T) expect(t.a < t.b).toBe(true);
  });

  it('counts each link once per pair, leaves out part-of links and links inside a polity', () => {
    const T = threads(tiny([
      rel('r1', 'pericles', 'philip', { effect: 'weakened' }),
      rel('r2', 'philip', 'pericles', { effect: 'weakened' }),
      rel('r3', 'plague', 'philip', { effect: 'prompted' }),
      rel('r4', 'pericles', 'plague'),
      rel('r5', 'philip', 'pericles', { type: 'part-of' }),
      rel('r6', 'lysander', 'pericles', { effect: 'ended' }),
    ]));
    expect(T.map((t) => [t.key, t.count, t.effect])).toEqual([['pol:athens|pol:macedon', 3, 'weakened'], ['pol:athens|pol:sparta', 1, 'ended']]);
    // Its lane is the cause's, by weight: Pericles is the most prominent cause.
    expect(T[0].lane).toBe('politics');
    // It leaves Athens at the mean start of the Athenian ends.
    expect(T[0].ya).toBeCloseTo((-494 - 494 - 430) / 3);
  });

  it('treats a polity that is part of another (a league and its leader) as its reach, not a thread', () => {
    const input = tiny([rel('r1', 'pericles', 'philip'), rel('p', 'macedon', 'athens', { type: 'part-of' })]);
    expect(threads(input)).toHaveLength(0);
  });

  it('puts an entry in no polity in its outermost era, and skips an era and a polity in the same region', () => {
    const eras = [
      { id: 'classical', region: 'Greece', members: ['herodotus'] },
      { id: 'fifty', region: 'Greece', parent: 'classical', members: ['thucydides'] },
      { id: 'abbasid', region: 'Mesopotamia', members: ['baghdad'] },
    ];
    const ends = threadEnds({ polities: tiny([]).polities, eras });
    expect(ends('thucydides')).toEqual(['classical']);
    expect(ends('pericles')).toEqual(['pol:athens']);
    const T = threads(tiny([rel('r1', 'thucydides', 'pericles'), rel('r2', 'thucydides', 'baghdad'), rel('r3', 'pericles', 'baghdad')], { eras, polityRegions: new Map([['athens', 'Greece']]) }));
    expect(T.map((t) => t.key).sort()).toEqual(['abbasid|classical', 'abbasid|pol:athens']);
  });

  it('dates a link by when its effect began, so a chain plays in order', () => {
    const { years } = tiny([]);
    expect(linkYear(rel('a', 'pericles', 'alex'), years)).toBe(-284);
    expect(linkYear(rel('b', 'alex', 'baghdad'), years)).toBe(830);
    // A cause that came while the effect went on: the cause's start.
    expect(linkYear(rel('c', 'plague', 'pericles'), years)).toBe(-430);
  });

  it('lists the threads around a focus', () => {
    const T = threads(tiny([rel('r1', 'pericles', 'philip'), rel('r2', 'lysander', 'philip')]));
    expect(threadsAround(T, ['pol:sparta']).map((t) => t.key)).toEqual(['pol:macedon|pol:sparta']);
    expect(threadsAround(T, ['pol:athens', 'pol:sparta'])).toHaveLength(2);
  });

  it('rolls up the stress appendix (2,000 entries, 300 links) quickly, one ribbon per pair', () => {
    const S = JSON.parse(read('overview/stress.json')) as {
      entries: { id: string; start: number; end?: number; lanes?: Lane[]; polities?: string[]; highlights: number }[];
      threads: { from: string; to: string; effect: string }[];
    };
    const polities = new Map<string, string[]>();
    for (const e of S.entries) for (const p of e.polities ?? []) polities.set(p, [...(polities.get(p) ?? []), e.id]);
    const byId = new Map(S.entries.map((e) => [e.id, e]));
    const relations = S.threads.map((t, i) => rel(`s${i}`, t.from, t.to, { effect: t.effect }));
    const t0 = performance.now();
    const T = threads({
      relations, polities,
      lanesOf: new Map(S.entries.flatMap((e) => (e.lanes?.length ? [[e.id, e.lanes] as const] : []))),
      prominence: (id) => (byId.get(id)?.highlights ?? 0) * 3,
      years: (id) => { const e = byId.get(id); return e && { s: e.start, e: e.end ?? e.start }; },
    });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(T.length).toBeGreaterThan(20);
    expect(new Set(T.map((t) => t.key)).size).toBe(T.length);
    // Many links share a pair, so there are fewer ribbons than links.
    expect(T.reduce((n, t) => n + t.count, 0)).toBeGreaterThan(T.length);
    for (let i = 1; i < T.length; i++) expect(T[i - 1].weight).toBeGreaterThanOrEqual(T[i].weight);
  });
});
