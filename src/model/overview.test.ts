import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDated } from './dates';
import { parseDoc } from './doc';
import { orderRegions, overview, polityLife } from './overview';
import { prominence } from './prominence';
import type { DatedItem, Territory } from './types';

const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const items = doc.items.filter(isDated);
const O = overview({ ...doc, items, prominence: prominence(doc), now: 2026 });

describe('overview', () => {
  it('orders the regions by geography, then by who dealt with whom: Greece next to Macedon, Persia to the east', () => {
    const names = O.regions.map((r) => r.name);
    expect(names).toEqual(['Italy', 'Macedon', 'Greece', 'Persia']);
    expect(Math.abs(names.indexOf('Greece') - names.indexOf('Macedon'))).toBe(1);
    expect(O.regions.map((r) => [r.parent, r.tone])).toEqual([['Mediterranean', 0], ['Mediterranean', 0], ['Mediterranean', 0], ['Near East', 1]]);
  });

  it('gives each polity its life from its entry, borders and strength points', () => {
    const athens = O.polities.find((p) => p.id === 't_athens')!;
    expect(athens).toMatchObject({ title: 'Athens', fullTitle: 'Athens (Attica)', region: 'Greece', s: -699, e: -85, group: 'g_classical_greece' });
    const still: Territory = { ...athens.t, itemId: undefined, strength: undefined, snapshots: [{ from: { y: 1990 } }] };
    expect(polityLife(still, undefined, 2026)).toMatchObject({ s: 1990, e: 2026, when: 'Since 1990' });
  });

  it('folds the city-states into their group, in their region', () => {
    expect(O.groups).toEqual([expect.objectContaining({ id: 'g_classical_greece', title: 'Classical Greece', region: 'Greece', members: ['t_athens', 't_sparta', 't_corinth', 't_thebes'] })]);
  });

  it('names a world event in the region most of its polities are in, gilding every region it touched', () => {
    expect(O.worlds).toEqual([{ id: 'i_alexander_persia', home: 'Macedon', touches: ['Macedon', 'Persia'] }]);
  });

  it('puts the entries Bob shows at the top, most prominent first, with a world event no polity places', () => {
    expect(O.top).toHaveLength(5);
    expect(O.top).toEqual(expect.arrayContaining(['i_persian', 'i_pelop', 'i_plague', 'i_delian_founded', 'i_academy']));
    const p = prominence(doc);
    for (let i = 1; i < O.top.length; i++) expect(p(O.top[i - 1])).toBeGreaterThanOrEqual(p(O.top[i]));
    const lone = { ...items.find((i) => i.id === 'i_academy')!, id: 'x_world', overview: 'world' } as DatedItem;
    expect(overview({ ...doc, items: [...items, lone], prominence: p, now: 2026 }).top).toContain('x_world');
  });
});

describe('orderRegions', () => {
  const C = new Map<string, [number, number]>([['Iberia', [-4, 40]], ['Italy', [12, 42]], ['Greece', [23, 38]], ['Egypt', [31, 27]], ['Levant', [35, 33]], ['China', [110, 34]]]);
  const parent: Record<string, string> = { Iberia: 'Europe', Italy: 'Europe', Greece: 'Europe', Egypt: 'Near East', Levant: 'Near East', China: 'East Asia' };
  it('runs parents west to east, keeps neighbours together, and puts Elsewhere and unmapped regions last', () => {
    const out = orderRegions(['China', 'Levant', '', 'Greece', 'Atlantis', 'Iberia', 'Egypt', 'Italy'], C, (r) => parent[r] ?? (r === 'Atlantis' ? 'Europe' : undefined), () => 0);
    expect(out.slice(0, 4)).toEqual(['Iberia', 'Italy', 'Greece', 'Atlantis']);
    expect(out.slice(4, 6).sort()).toEqual(['Egypt', 'Levant']);
    expect(out.slice(6)).toEqual(['China', '']);
  });
  it('lets connections decide which ends meet where two parents join', () => {
    const toLevant = orderRegions(['Greece', 'Italy', 'Iberia', 'Egypt', 'Levant'], C, (r) => parent[r], (a, b) => ([a, b].sort().join() === 'Greece,Levant' ? 50 : 0));
    expect(toLevant.slice(2, 4)).toEqual(['Greece', 'Levant']);
    const toEgypt = orderRegions(['Greece', 'Italy', 'Iberia', 'Egypt', 'Levant'], C, (r) => parent[r], (a, b) => ([a, b].sort().join() === 'Egypt,Greece' ? 50 : 0));
    expect(toEgypt.slice(2, 4)).toEqual(['Greece', 'Egypt']);
  });
});
