import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { entryLanes, lanesOf, sortLanes } from './lanes';
import type { Highlight, TimelineItem } from './types';

const ev = (id: string, o: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'event', title: id, start: { y: -430 }, categoryId: 'c', updatedAt: 0, ...o });
const hl = (id: string, usedBy: string[], lanes?: Highlight['lanes']): Highlight => ({ id, sourceId: 's', text: id, usedBy, lanes, updatedAt: 0 });

describe('lanesOf', () => {
  it('takes Bob’s lanes over everything, in pigment order', () => {
    const doc = { highlights: [hl('h', ['x'], ['nature'])] };
    expect(lanesOf(ev('x', { subject: 'war', lanes: ['economy', 'politics'] }), doc)).toEqual(['politics', 'economy']);
  });

  it('else sorts it by its kind of thing', () => {
    const doc = { highlights: [hl('h', ['x'], ['nature'])] };
    const of = (subject: TimelineItem['subject']) => lanesOf(ev('x', { subject }), doc);
    expect(of('war')).toEqual(['war']);
    expect(of('battle')).toEqual(['war']);
    expect(of('polity')).toEqual(['politics']);
    expect(of('economy')).toEqual(['economy']);
    expect(of('idea')).toEqual(['ideas']);
    expect(of('work')).toEqual(['ideas']);
    expect(of('technology')).toEqual(['technology']);
  });

  it('else takes the lanes of the highlights it uses, each once', () => {
    const doc = { highlights: [hl('h1', ['x'], ['nature', 'ideas']), hl('h2', ['x', 'y'], ['nature']), hl('h3', ['y'], ['war'])] };
    expect(lanesOf(ev('x', { subject: 'person' }), doc)).toEqual(['ideas', 'nature']);
    expect(lanesOf(ev('z'), doc)).toEqual([]);
  });

  it('treats an empty list of Bob’s as not set', () => {
    expect(lanesOf(ev('x', { lanes: [], subject: 'battle' }), { highlights: [] })).toEqual(['war']);
  });

  it('sorts the Greece fixture: the plague in Nature and Philosophy and religion, a battle in War', () => {
    const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
    const of = (id: string) => lanesOf(doc.items.find((i) => i.id === id)!, doc);
    expect(of('i_plague')).toEqual(['ideas', 'nature']);
    expect(of('i_laurion')).toEqual(['economy', 'nature']);
    expect(of('i_b_potidaea')).toEqual(['war']);
  });
});

describe('entryLanes', () => {
  it('agrees with lanesOf, and leaves out entries in no lane', () => {
    const items = [ev('a', { lanes: ['war'] }), ev('b', { subject: 'idea' }), ev('c'), ev('d')];
    const highlights = [hl('h', ['c'], ['economy'])];
    const m = entryLanes(items, highlights);
    for (const it of items.slice(0, 3)) expect(m.get(it.id)).toEqual(lanesOf(it, { highlights }));
    expect(m.has('d')).toBe(false);
  });

  it('sortLanes keeps pigment order and drops repeats', () => {
    expect(sortLanes(['nature', 'politics', 'nature'])).toEqual(['politics', 'nature']);
  });
});
