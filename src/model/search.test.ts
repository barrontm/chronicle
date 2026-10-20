import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyDoc, parseDoc, upsert } from './doc';
import { search } from './search';

const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));

describe('search', () => {
  it('puts titles first, then the text of entries, notes and highlights', () => {
    const hits = search(doc, 'salamis');
    expect(hits[0]).toMatchObject({ type: 'item', title: 'Battle of Salamis', subject: 'event' });
    expect(hits[0].when).toMatch(/480 BCE/);
    expect(hits[0].bounds).toHaveLength(4);
    expect(hits[0].snippet).toBeUndefined();
    const types = hits.map((h) => h.type);
    expect(types).toContain('note');
    expect(types).toContain('highlight');
    // Every title match comes before every text match.
    const firstText = hits.findIndex((h) => h.snippet);
    expect(hits.slice(firstText).every((h) => h.snippet)).toBe(true);
    const note = hits.find((h) => h.type === 'note')!;
    expect(note.title).toBe('Where the fleet’s money came from');
    expect(note.snippet?.toLowerCase()).toContain('salamis');
  });

  it('ranks a title that starts with the words above one that only has them', () => {
    const titles = search(doc, 'battle').map((h) => h.title);
    expect(titles.length).toBeGreaterThan(5);
    expect(titles.slice(0, 5).every((t) => t.startsWith('Battle'))).toBe(true);
  });

  it('ignores case and accents', () => {
    const accented = upsert(createEmptyDoc(), 'items', { id: 'p', kind: 'person', title: 'Périclès', categoryId: 'c', start: { y: -494 }, end: { y: -428 }, updatedAt: 0 });
    expect(search(accented, 'PERICLES').map((h) => h.title)).toEqual(['Périclès']);
    expect(search(doc, 'THUCYDIDES')[0].title).toMatch(/Thucydides/);
  });

  it('needs every word, and finds territories with their shape and year', () => {
    const hits = search(doc, 'delian league');
    expect(hits.some((h) => h.type === 'territory' && h.title === 'Delian League (Athenian empire)' && h.bounds && h.year !== undefined)).toBe(true);
    expect(search(doc, 'delian zebra')).toEqual([]);
    expect(search(doc, 'athens (attica)')[0]).toMatchObject({ type: 'territory', when: '700–86 BCE' });
  });

  it('gives at most 20 results, and none for an empty query', () => {
    expect(search(doc, 'a').length).toBe(20);
    expect(search(doc, '   ')).toEqual([]);
  });

  it('finds sources by title and highlights by their text, under their source', () => {
    const src = search(doc, 'histories').find((h) => h.type === 'source' && h.title === 'The Histories');
    expect(src?.when).toMatch(/Herodotus/);
    const h = search(doc, 'laurion').find((x) => x.type === 'highlight')!;
    expect(h.sourceId).toBeTruthy();
    expect(h.snippet).toMatch(/Laurion/);
  });
});
