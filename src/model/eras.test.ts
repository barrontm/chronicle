import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { entryDimensions, eraRegions, ELSEWHERE, isEra } from './eras';
import type { Highlight, Relation, TimelineItem } from './types';

const NOW = 2026.8;
const span = (id: string, a: number, b: number, o: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'span', title: id, start: { y: a }, end: { y: b }, categoryId: 'c', updatedAt: 0, ...o });
const ev = (id: string, y: number, o: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'event', title: id, start: { y }, categoryId: 'c', updatedAt: 0, ...o });
const hl = (id: string, usedBy: string[], dimension?: Highlight['dimension']): Highlight => ({ id, sourceId: 's', text: id, usedBy, dimension, updatedAt: 0 });
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
    expect(classical.mix.political).toBeGreaterThan(classical.mix.economic);
    expect(classical.mix.religious).toBeGreaterThan(0);
    expect(Object.values(classical.mix).reduce((a, b) => a + b, 0)).toBe(classical.highlights);
    expect(greece.highlights).toBe(doc.highlights.length);
    expect(classical.members).toContain('i_pelop'); // 431–404 BCE: between its inner eras
    expect(classical.members).not.toContain('i_ephialtes'); // 462 BCE: in the Fifty Years
    expect(by['The Fifty Years'].members).toContain('i_ephialtes');
  });

  it('puts an entry in the era it is part of before the one its dates fall in', () => {
    const items = [span('greece', -800, -300, { subject: 'period', region: 'Greece' }), span('persia', -550, -330, { subject: 'period', region: 'Persia' }), span('war', -499, -449), ev('marathon', -489)];
    const regions = eraRegions(items, [hl('h1', ['marathon'], 'political')], [partOf('marathon', 'war'), partOf('war', 'persia')], NOW);
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
    const regions = eraRegions(items, [hl('h1', ['x'], 'social'), hl('h2', ['y']), hl('h3', ['y'])], [], NOW);
    expect(regions.map((r) => [r.name, r.highlights])).toEqual([['Rome', 3], ['Greece', 1], [ELSEWHERE, 1]]);
    // A highlight with no dimension is counted, but not in the mix.
    expect(regions[0].eras[0].mix.social).toBe(1);
    expect(Object.values(regions[0].eras[0].mix).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('counts a highlight once per era, whether on the era, a theme or an entry, and takes the entry’s dimension when it has none', () => {
    const items = [
      span('e', -500, -400, { subject: 'period', region: 'R', themes: [{ id: 't', label: 'T', highlightIds: ['h1', 'h2'] }] }),
      ev('x', -450, { dimension: 'economic' }),
    ];
    const [r] = eraRegions(items, [hl('h1', ['e', 'x']), hl('h2', [])], [], NOW);
    expect(r.eras[0].highlights).toBe(2);
    expect(r.eras[0].mix.economic).toBe(1);
  });

  it('runs an era without an end up to now, and has no regions without eras', () => {
    expect(eraRegions([ev('x', 1)], [], [], NOW)).toEqual([]);
    const [r] = eraRegions([{ ...span('modern', 1900, 0, { subject: 'period' }), end: undefined }], [], [], NOW);
    expect(r.eras[0].e).toBe(NOW);
  });
});

describe('entryDimensions', () => {
  it('takes an entry’s own dimension, else the one most of its highlights have, first in pigment order on a tie', () => {
    const items = [ev('own', 1, { dimension: 'religious' }), ev('voted', 2), ev('tie', 3), ev('none', 4)];
    const hs = [hl('h1', ['own', 'voted'], 'economic'), hl('h2', ['voted'], 'social'), hl('h3', ['voted'], 'social'), hl('h4', ['tie'], 'social'), hl('h5', ['tie'], 'political'), hl('h6', ['none'])];
    const dims = entryDimensions(items, hs);
    expect(dims.get('own')).toBe('religious');
    expect(dims.get('voted')).toBe('social');
    expect(dims.get('tie')).toBe('political');
    expect(dims.has('none')).toBe(false);
  });
});
