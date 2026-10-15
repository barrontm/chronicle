import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createEmptyDoc,
  DocValidationError,
  mergeDocs,
  notesFor,
  parseDoc,
  relationsFor,
  remove,
  serializeDoc,
  upsert,
} from './doc';
import { SCHEMA_VERSION, type TimelineItem } from './types';

const fixtureJson = readFileSync(new URL('../../tests/fixtures/sample-history.json', import.meta.url), 'utf8');
const fixture = () => parseDoc(fixtureJson);
const fixtureV1Json = readFileSync(new URL('../../tests/fixtures/sample-history-v1.json', import.meta.url), 'utf8');

describe('parseDoc', () => {
  it('accepts the fixture and round-trips it', () => {
    const doc = fixture();
    expect(doc.items.length).toBeGreaterThan(10);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it('starts new docs empty but with categories', () => {
    const doc = createEmptyDoc();
    expect(doc.items).toEqual([]);
    expect(doc.categories.length).toBeGreaterThan(3);
  });

  it('explains what is wrong with a bad file', () => {
    const bad = JSON.parse(fixtureJson);
    bad.items[0].end = { y: -500 }; // ends before it starts
    bad.items[1].categoryId = 'nope';
    try {
      parseDoc(JSON.stringify(bad));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DocValidationError);
      const problems = (e as DocValidationError).problems.join('\n');
      expect(problems).toMatch(/Peloponnesian War" ends before it starts/);
      expect(problems).toMatch(/unknown category "nope"/);
    }
  });

  it('rejects non-JSON and files from a newer schema', () => {
    expect(() => parseDoc('not json')).toThrow(/not valid JSON/);
    expect(() => parseDoc(JSON.stringify({ schemaVersion: 99 }))).toThrow(/newer version/);
  });

  it('still imports a schema 1 backup and upgrades it', () => {
    const doc = parseDoc(fixtureV1Json);
    expect(JSON.parse(fixtureV1Json).schemaVersion).toBe(1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.items.length).toBeGreaterThan(10);
  });

  it('rejects places with impossible coordinates', () => {
    const bad = JSON.parse(fixtureJson);
    bad.items[0].places = [{ lat: 95, lon: 10 }];
    expect(() => parseDoc(JSON.stringify(bad))).toThrow(/invalid coordinates/);
  });

  it('rejects citations of sources that do not exist', () => {
    const bad = JSON.parse(fixtureJson);
    bad.sources = [];
    expect(() => parseDoc(JSON.stringify(bad))).toThrow(/unknown source/);
  });
});

describe('mutations', () => {
  const item: TimelineItem = { id: 'i_new', kind: 'event', title: 'Battle of Marathon', start: { y: -489 }, categoryId: 'war', updatedAt: 0 };

  it('upserts and stamps updatedAt', () => {
    const doc = upsert(fixture(), 'items', item, 123);
    expect(doc.items.find((i) => i.id === 'i_new')?.updatedAt).toBe(123);
    const again = upsert(doc, 'items', { ...item, title: 'Marathon' }, 456);
    expect(again.items.filter((i) => i.id === 'i_new')).toHaveLength(1);
    expect(again.items.find((i) => i.id === 'i_new')?.title).toBe('Marathon');
  });

  it('removing an item drops its connections and unlinks notes, but keeps the notes', () => {
    const doc = remove(fixture(), 'items', 'i_plato', 999);
    expect(doc.items.some((i) => i.id === 'i_plato')).toBe(false);
    expect(doc.relations.some((r) => r.fromId === 'i_plato' || r.toId === 'i_plato')).toBe(false);
    const note = doc.notes.find((n) => n.id === 'n_teachers')!;
    expect(note).toBeDefined();
    expect(note.linkedIds).toEqual(['i_socrates', 'i_aristotle']);
    expect(doc.deleted.i_plato).toBe(999);
    expect(doc.deleted.r_1).toBe(999);
  });

  it('removing a source strips citations of it', () => {
    const doc = remove(fixture(), 'sources', 's_barnes', 5);
    expect(doc.items.find((i) => i.id === 'i_aristotle')?.citations).toEqual([]);
    expect(doc.notes[0].citations).toEqual([]);
    expect(() => parseDoc(serializeDoc(doc))).not.toThrow();
  });

  it('removing a source drops excerpts quoted from it', () => {
    const doc = remove(fixture(), 'sources', 's_wp_magna', 5);
    const magna = doc.items.find((i) => i.id === 'i_magna')!;
    expect(magna.excerpt).toBeUndefined();
    expect(magna.citations).toEqual([]);
    expect(magna.updatedAt).toBe(5);
    expect(() => parseDoc(serializeDoc(doc))).not.toThrow();
  });
});

describe('queries', () => {
  it('finds notes and connections for an item', () => {
    const doc = fixture();
    expect(notesFor(doc, 'i_aristotle').map((n) => n.id)).toEqual(['n_teachers']);
    const rel = relationsFor(doc, 'i_plato');
    expect(rel.incoming.map((r) => r.fromId)).toEqual(['i_socrates']);
    expect(rel.outgoing.map((r) => r.toId)).toEqual(['i_aristotle']);
  });
});

describe('mergeDocs', () => {
  const T = 1_770_000_000_000; // after the fixture's timestamps
  it('keeps the newer edit of each record', () => {
    const base = fixture();
    const phone = upsert(base, 'items', { ...base.items[0], title: 'Edited on phone' }, T + 2000);
    const laptop = upsert(base, 'notes', { ...base.notes[0], body: 'Edited on laptop' }, T + 3000);
    const merged = mergeDocs(phone, laptop);
    expect(merged.items[0].title).toBe('Edited on phone');
    expect(merged.notes[0].body).toBe('Edited on laptop');
  });

  it('lets a later deletion win over an earlier edit', () => {
    const base = fixture();
    const phone = remove(base, 'items', 'i_moon', T + 5000);
    const laptop = upsert(base, 'items', { ...base.items.find((i) => i.id === 'i_moon')!, title: 'Moon' }, T + 4000);
    expect(mergeDocs(phone, laptop).items.some((i) => i.id === 'i_moon')).toBe(false);
  });

  it('lets an edit after a deletion bring the record back', () => {
    const base = fixture();
    const phone = remove(base, 'items', 'i_moon', T + 5000);
    const laptop = upsert(base, 'items', { ...base.items.find((i) => i.id === 'i_moon')!, title: 'Moon' }, T + 6000);
    expect(mergeDocs(phone, laptop).items.find((i) => i.id === 'i_moon')?.title).toBe('Moon');
  });

  it('is order-independent for records', () => {
    const base = fixture();
    const a = upsert(base, 'items', { ...base.items[2], title: 'A' }, T + 7000);
    const b = remove(base, 'sources', 's_barnes', T + 8000);
    const ab = mergeDocs(a, b);
    const ba = mergeDocs(b, a);
    expect(ab.items).toEqual(expect.arrayContaining(ba.items));
    expect(ab.sources).toEqual(ba.sources);
  });
});
