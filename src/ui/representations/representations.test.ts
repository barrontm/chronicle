import { describe, expect, it } from 'vitest';
import { SUBJECT_KINDS, type Relation, type TimelineItem } from '../../model/types';
import { makerOf, markOf, REPRESENTATIONS, representationOf, warOf } from '.';
import { chipLines, chipPrims, packChips, parseThemeKey, themeKey } from './era';

const rel = (fromId: string, toId: string, type: Relation['type'] = 'part-of'): Relation => ({ id: `${fromId}>${toId}`, fromId, toId, type, updatedAt: 0 });

describe('representations', () => {
  it('has one for every kind of thing, and no two kinds share a glyph', () => {
    expect(Object.keys(REPRESENTATIONS).sort()).toEqual([...SUBJECT_KINDS].sort());
    for (const k of SUBJECT_KINDS) expect(REPRESENTATIONS[k].kind).toBe(k);
    const glyphs = SUBJECT_KINDS.map((k) => REPRESENTATIONS[k].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('draws an entry as its kind of thing, and one without as its kind', () => {
    const of = (kind: TimelineItem['kind'], subject?: TimelineItem['subject']) => representationOf({ kind, subject });
    expect(of('event').kind).toBe('event');
    expect(of('span').kind).toBe('period');
    expect(of('person').kind).toBe('person');
    expect(of('span', 'war').bar).toBe('war');
    expect(of('event', 'battle').point).toBe('glyph');
    expect(of('event', 'technology').point).toBe('glyph');
    expect(of('event', 'work').point).toBe('glyph');
    expect(of('event', 'event').point).toBe('dot');
    expect(of('span', 'idea').bar).toBe('thread');
    expect(of('span', 'migration').bar).toBe('arrow');
    expect(of('span', 'place').bar).toBe('ground');
    expect(of('span', 'economy')).toMatchObject({ bar: 'bar', badge: true });
    expect(of('span', 'polity')).toMatchObject({ bar: 'bar', badge: true });
    expect(of('span', 'period').bar).toBe('bar');
    expect(of('span', 'period').badge).toBeUndefined();
  });

  it('puts each entry in a row of moments, spans or lives', () => {
    expect(markOf({ kind: 'event', subject: 'work' })).toBe('event');
    expect(markOf({ kind: 'span', subject: 'place' })).toBe('span');
    expect(markOf({ kind: 'person' })).toBe('person');
    expect(markOf({ kind: 'span', subject: 'person' })).toBe('person');
    expect(markOf({ kind: 'person', subject: 'polity' })).toBe('span');
  });
});

describe('warOf', () => {
  const items: Pick<TimelineItem, 'id' | 'kind' | 'subject'>[] = [
    { id: 'invasion', kind: 'span', subject: 'war' },
    { id: 'salamis', kind: 'event', subject: 'battle' },
    { id: 'marathon', kind: 'event', subject: 'battle' },
    { id: 'treaty', kind: 'event', subject: 'event' },
    { id: 'league', kind: 'span', subject: 'polity' },
  ];
  it('puts a battle that is part of a war on the war’s bar', () => {
    const m = warOf(items, [rel('salamis', 'invasion'), rel('treaty', 'invasion'), rel('marathon', 'league')]);
    expect([...m]).toEqual([['salamis', 'invasion']]);
  });
  it('leaves a battle with no war, or only a related one, as a point of its own', () => {
    expect(warOf(items, [rel('salamis', 'invasion', 'related'), rel('invasion', 'salamis')]).size).toBe(0);
  });
});

describe('makerOf', () => {
  const items = [
    { id: 'histories', kind: 'event' as const, subject: 'work' as const, s: -429, e: -429 },
    { id: 'herodotus', kind: 'person' as const, subject: 'person' as const, s: -483, e: -424 },
    { id: 'thucydides', kind: 'person' as const, s: -459, e: -399 },
    { id: 'homer', kind: 'person' as const, s: -799, e: -700 },
    { id: 'athens', kind: 'span' as const, subject: 'place' as const, s: -1400, e: 2026 },
  ];
  it('joins a work to a connected person alive when it was made, either way round', () => {
    expect(makerOf(items, [rel('homer', 'histories', 'influenced'), rel('histories', 'herodotus', 'related')]).get('histories')).toBe('herodotus');
  });
  it('falls back to the first connected person, and never to anything but a life', () => {
    expect(makerOf(items, [rel('homer', 'histories', 'influenced')]).get('histories')).toBe('homer');
    expect(makerOf(items, [rel('histories', 'athens', 'related')]).has('histories')).toBe(false);
  });
});

describe('theme chips', () => {
  const M = (_: string, s: string) => s.length * 7;
  const t = (id: string, label: string) => ({ era: 'e', theme: { id, label, highlights: 3, lane: 'war' as const, ids: [] } });
  it('packs chips onto new lines when they run past the room, never leaving one out', () => {
    const boxes = packChips([t('a', 'War'), t('b', 'Democracy'), t('c', 'Plays')], 100, 300, M);
    expect(boxes.map((b) => b.line)).toEqual([0, 0, 1]);
    expect(boxes[0].x).toBe(100);
    expect(boxes[2].x).toBe(100);
    expect(chipLines(boxes)).toBe(2);
    expect(chipLines([])).toBe(0);
  });
  it('cuts a long label short, and gives a narrow era at least 150 px', () => {
    const [b] = packChips([t('a', 'Socrates, Plato, Aristotle and the schools')], 0, 20, M);
    expect(b.label.endsWith('…')).toBe(true);
    expect(b.w).toBeLessThanOrEqual(150);
  });
  it('draws a square in the theme’s lane pigment and a target id that names its era', () => {
    const [b] = packChips([t('a', 'War')], 0, 300, M);
    const prims = chipPrims(b, 10, { hot: false, picked: true });
    expect(prims[1]).toMatchObject({ fill: 'var(--pig-cinnabar)' });
    expect(prims[0].cls).toContain('picked');
    expect(parseThemeKey(themeKey('i_classical', 't-war'))).toEqual({ era: 'i_classical', theme: 't-war' });
    expect(parseThemeKey('pol:x')).toBeUndefined();
  });
});
