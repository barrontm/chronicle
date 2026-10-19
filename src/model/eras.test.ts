import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { eraRegions, ELSEWHERE, isEra } from './eras';
import type { Highlight, Relation, TimelineItem } from './types';

const NOW = 2026.8;
const span = (id: string, a: number, b: number, o: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'span', title: id, start: { y: a }, end: { y: b }, categoryId: 'c', updatedAt: 0, ...o });
const ev = (id: string, y: number, o: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'event', title: id, start: { y }, categoryId: 'c', updatedAt: 0, ...o });
const hl = (id: string, usedBy: string[], ...lanes: NonNullable<Highlight['lanes']>): Highlight => ({ id, sourceId: 's', text: id, usedBy, ...(lanes.length ? { lanes } : {}), updatedAt: 0 });
const partOf = (fromId: string, toId: string): Relation => ({ id: `${fromId}>${toId}`, fromId, toId, type: 'part-of', updatedAt: 0 });

describe('isEra', () => {
  it('takes periods, and older spans only once they have a region', () => {
    expect(isEra(span('a', -500, -400, { subject: 'period' }))).toBe(true);
    expect(isEra(span('b', -500, -400))).toBe(false);
    expect(isEra(span('c', -500, -400, { region: 'Greece' }))).toBe(true);
    expect(isEra(span('d', -500, -400, { subject: 'war', region: 'Greece' }))).toBe(false);
    expect(isEra(ev('e', -500, { subject: 'period' }))).toBe(false);
  });
});

describe('eraRegions', () => {
  it('lays out the Greece fixture’s eras in the Greece row, the Fifty Years inside the Classical period', () => {
    const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
    const regions = eraRegions(doc.items, doc.highlights, doc.relations, NOW);
    expect(regions.map((r) => r.name)).toEqual(['Greece']);
    const [greece] = regions;
    expect(greece.eras.map((e) => e.title)).toEqual(['Archaic Greece', 'Classical Greece', 'The Fifty Years', 'Spartan and Theban supremacy', 'Macedon rises', 'Hellenistic period']);
    const by = Object.fromEntries(greece.eras.map((e) => [e.title, e]));
    expect(by['The Fifty Years'].parent).toBe('i_classical');
    expect(by['Classical Greece'].parent).toBeUndefined();
    const classical = by['Classical Greece'];
    // Its own, its themes', and the highlights of everything in it, counting its inner eras.
    expect(classical.highlights).toBeGreaterThan(by['The Fifty Years'].highlights + by['Macedon rises'].highlights);
    expect(classical.mix.politics).toBeGreaterThan(classical.mix.economy);
    expect(classical.mix.ideas).toBeGreaterThan(0);
    // Every highlight is in a lane or counted as in none; one in two lanes counts in both.
    expect(Object.values(classical.mix).reduce((a, b) => a + b, 0) + classical.noLane).toBeGreaterThanOrEqual(classical.highlights);
    expect(greece.highlights).toBe(doc.highlights.length);
    expect(classical.members).toContain('i_pelop'); // 431–404 BCE: between its inner eras
    expect(classical.members).not.toContain('i_ephialtes'); // 462 BCE: in the Fifty Years
    expect(by['The Fifty Years'].members).toContain('i_ephialtes');
  });

  it('puts an entry in the era it is part of before the one its dates fall in', () => {
    const items = [span('greece', -800, -300, { subject: 'period', region: 'Greece' }), span('persia', -550, -330, { subject: 'period', region: 'Persia' }), span('war', -499, -449), ev('marathon', -489)];
    const regions = eraRegions(items, [hl('h1', ['marathon'], 'politics')], [partOf('marathon', 'war'), partOf('war', 'persia')], NOW);
    const persia = regions.find((r) => r.name === 'Persia')!;
    expect(persia.eras[0].highlights).toBe(1);
    expect(persia.eras[0].members).toEqual(['war', 'marathon']);
    expect(regions.find((r) => r.name === 'Greece')!.eras[0].highlights).toBe(0);
  });

  it('counts an entry in every region whose dates hold it, and puts the most highlighted region first and Elsewhere last', () => {
    const items = [
      span('a', -600, -300, { subject: 'period' }), span('rome', -509, -27, { subject: 'period', region: 'Rome' }),
      span('greece', -800, -300, { subject: 'period', region: 'Greece' }), ev('x', -400), ev('y', -100),
    ];
    const regions = eraRegions(items, [hl('h1', ['x'], 'nature', 'ideas'), hl('h2', ['y']), hl('h3', ['y'])], [], NOW);
    expect(regions.map((r) => [r.name, r.highlights])).toEqual([['Rome', 3], ['Greece', 1], [ELSEWHERE, 1]]);
    // A highlight in two lanes counts in both; one in none is counted, but as in no lane.
    expect(regions[0].eras[0].mix).toMatchObject({ nature: 1, ideas: 1, politics: 0 });
    expect(regions[0].eras[0].noLane).toBe(2);
  });

  it('counts a highlight once per era, whether on the era, a theme or an entry, and takes the entry’s lanes when it has none', () => {
    const items = [
      span('e', -500, -400, { subject: 'period', region: 'R', themes: [{ id: 't', label: 'T', highlightIds: ['h1', 'h2'] }] }),
      ev('x', -450, { lanes: ['economy'] }),
    ];
    const [r] = eraRegions(items, [hl('h1', ['e', 'x']), hl('h2', [])], [], NOW);
    expect(r.eras[0].highlights).toBe(2);
    expect(r.eras[0].mix.economy).toBe(1);
    expect(r.eras[0].noLane).toBe(1);
  });

  it('runs an era without an end up to now, and has no regions without eras', () => {
    expect(eraRegions([ev('x', 1)], [], [], NOW)).toEqual([]);
    const [r] = eraRegions([{ ...span('modern', 1900, 0, { subject: 'period' }), end: undefined }], [], [], NOW);
    expect(r.eras[0].e).toBe(NOW);
  });
});
