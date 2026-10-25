import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDated, toDecimalYear } from './dates';
import { parseDoc } from './doc';
import { eraRegions } from './eras';
import { entryLanes } from './lanes';
import { lensMarks } from './lenses';
import { overview } from './overview';
import { polityMembers } from './polities';
import type { Lane } from './types';

const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const items = doc.items.filter(isDated);
const eras = eraRegions(doc.items, doc.highlights, doc.relations, 2026).flatMap((r) => r.eras);
const O = overview({ items, territories: doc.territories, relations: doc.relations, highlights: doc.highlights, groups: doc.groups, regions: doc.regions, prominence: () => 0, now: 2026 });
const M = lensMarks({
  entries: items.map((i) => ({ id: i.id, s: toDecimalYear(i.start) })),
  polities: polityMembers(doc),
  polityItems: new Map(doc.territories.flatMap((t) => (t.itemId ? [[t.itemId, t.id] as const] : []))),
  polityRegions: new Map(O.polities.map((p) => [p.id, p.region])),
  eras,
  lanesOf: entryLanes(doc.items, doc.highlights),
});

describe('lensMarks', () => {
  it('on the Greece fixture, puts each entry in its polities’ regions, per lane, earliest first', () => {
    const war = M.get('Greece')!.get('war')!;
    expect(war).toContain('i_lade');
    // A war Persia fought is in Persia's band too.
    expect([...M.keys()]).toEqual(expect.arrayContaining(['Greece', 'Persia', 'Macedon']));
    expect(M.get('Persia')!.get('war')!.length).toBeGreaterThan(0);
    const start = new Map(items.map((i) => [i.id, toDecimalYear(i.start)]));
    for (let i = 1; i < war.length; i++) expect(start.get(war[i])!).toBeGreaterThanOrEqual(start.get(war[i - 1])!);
  });

  it('gives polities’ own entries and eras no tick: they are the strips and washes', () => {
    const all = new Set([...M.values()].flatMap((m) => [...m.values()].flat()));
    for (const t of doc.territories) if (t.itemId) expect(all.has(t.itemId)).toBe(false);
    for (const e of eras) expect(all.has(e.id)).toBe(false);
  });

  it('an entry with no lane, or in no polity or era, has no tick', () => {
    const tiny = lensMarks({
      entries: [{ id: 'a', s: 0 }, { id: 'b', s: 1 }, { id: 'c', s: 2 }],
      polities: new Map([['t1', ['a', 'b']]]),
      polityRegions: new Map([['t1', 'Greece']]),
      lanesOf: new Map<string, Lane[]>([['a', ['war', 'economy']], ['c', ['war']]]),
    });
    expect([...tiny.keys()]).toEqual(['Greece']);
    expect(tiny.get('Greece')!.get('war')).toEqual(['a']);
    expect(tiny.get('Greece')!.get('economy')).toEqual(['a']);
  });
});
