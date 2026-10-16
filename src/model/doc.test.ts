import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  authoredBy,
  bibliographyFor,
  createEmptyDoc,
  DocValidationError,
  influencesOf,
  mergeDocs,
  notesFor,
  openStoredDoc,
  parseDoc,
  relationsFor,
  remove,
  serializeDoc,
  upsert,
} from './doc';
import { SCHEMA_VERSION, type Relation, type TimelineItem } from './types';

const fixtureJson = readFileSync(new URL('../../tests/fixtures/sample-history.json', import.meta.url), 'utf8');
const fixture = () => parseDoc(fixtureJson);
const fixtureV1Json = readFileSync(new URL('../../tests/fixtures/sample-history-v1.json', import.meta.url), 'utf8');
const fixtureV2Json = readFileSync(new URL('../../tests/fixtures/sample-history-v2.json', import.meta.url), 'utf8');
const fixtureV3Json = readFileSync(new URL('../../tests/fixtures/sample-history-v3.json', import.meta.url), 'utf8');
const fixtureV4Json = readFileSync(new URL('../../tests/fixtures/sample-history-v4.json', import.meta.url), 'utf8');

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

  it('still imports a schema 2 backup, dropping territory geometry that was never a polygon', () => {
    const v2 = JSON.parse(fixtureV2Json);
    expect(v2.schemaVersion).toBe(2);
    v2.territories = [{ id: 't_old', title: 'Old', categoryId: 'politics', snapshots: [{ from: { y: 100 }, geometry: { type: 'Point', coordinates: [0, 0] } }], updatedAt: 1 }];
    const doc = parseDoc(JSON.stringify(v2));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.territories[0].snapshots[0].geometry).toBeUndefined();
  });

  it('accepts a map-only trend but rejects bad regional values and territories', () => {
    expect(fixture().series[2].points).toEqual([]);
    const badSeries = JSON.parse(fixtureJson);
    badSeries.series[2].regions.FRA = [{ x: 1800, v: 'lots' }];
    expect(() => parseDoc(JSON.stringify(badSeries))).toThrow(/\(FRA\) has non-numeric points/);
    const badTerritory = JSON.parse(fixtureJson);
    badTerritory.territories[0].snapshots[0].from = { y: 1.5 };
    badTerritory.territories[0].snapshots[1].geometry = { type: 'Point', coordinates: [0, 0] };
    expect(() => parseDoc(JSON.stringify(badTerritory))).toThrow(/invalid date[\s\S]*isn't a polygon/);
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

describe('migration flows', () => {
  it('imports a schema 3 backup with no migrations yet', () => {
    expect(JSON.parse(fixtureV3Json).schemaVersion).toBe(3);
    const doc = parseDoc(fixtureV3Json);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.flows).toEqual([]);
    expect(doc.territories).toHaveLength(1);
  });

  it('checks causes, ends and numbers', () => {
    const bad = JSON.parse(fixtureJson);
    bad.flows[0].cause = 'wanderlust';
    bad.flows[0].routes[0].to = { country: 'usa' };
    bad.flows[1].routes[0].points[0].v = -5;
    const problems = (() => { try { parseDoc(JSON.stringify(bad)); return []; } catch (e) { return (e as DocValidationError).problems; } })().join('\n');
    expect(problems).toMatch(/unknown cause "wanderlust"/);
    expect(problems).toMatch(/Famine emigration.*invalid end/);
    expect(problems).toMatch(/Colonists abroad.*invalid numbers/);
  });

  it('unlinks a deleted entry and keeps routes to a deleted territory as a named point', () => {
    let doc = remove(fixture(), 'items', 'i_indrev', 5);
    expect(doc.flows[0].itemId).toBeUndefined();
    doc = remove(doc, 'territories', 't_fixture', 6);
    expect(doc.flows[0].routes[1].to).toEqual({ name: 'Fixture Republic', lon: 12.5, lat: 42 });
    expect(doc.flows[0].updatedAt).toBe(6);
    expect(parseDoc(serializeDoc(doc)).flows).toHaveLength(2);
  });

  it('merges migrations like everything else', () => {
    const base = fixture();
    const edited = upsert(base, 'flows', { ...base.flows[0], title: 'Edited' }, 2e12);
    const removed = remove(base, 'flows', 'f_colonies', 2e12);
    const merged = mergeDocs(edited, removed);
    expect(merged.flows.map((f) => f.title)).toEqual(['Edited']);
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

  it('removing an entry unlinks territories; removing a territory drops its values', () => {
    let doc = remove(fixture(), 'items', 'i_pelop', 7);
    expect(doc.territories[0].itemId).toBeUndefined();
    doc = remove(doc, 'territories', 't_fixture', 8);
    const regional = doc.series.find((s) => s.id === 'sr_regional')!;
    expect(Object.keys(regional.regions!)).toEqual(['FRA', 'GBR', 'ITA']);
    expect(() => parseDoc(serializeDoc(doc))).not.toThrow();
  });

  it('removing a territory deletes a trend that only had values for it', () => {
    const base = fixture();
    const only = { ...base.series[2], id: 'sr_only', regions: { t_fixture: base.series[2].regions!.t_fixture } };
    const doc = remove(upsert(base, 'series', only, 5), 'territories', 't_fixture', 9);
    expect(doc.series.some((s) => s.id === 'sr_only')).toBe(false);
    expect(doc.deleted.sr_only).toBe(9);
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

describe('draft provenance', () => {
  it('imports a schema 4 backup as it is', () => {
    expect(JSON.parse(fixtureV4Json).schemaVersion).toBe(4);
    const doc = parseDoc(fixtureV4Json);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.items).toEqual(JSON.parse(fixtureV4Json).items);
  });

  it('keeps provenance and rejects a malformed one', () => {
    expect(fixture().items.find((i) => i.id === 'i_principia')?.drafted).toEqual({ model: 'claude-opus-5-5', prompt: 'entries@1', draftedAt: 1760000000000 });
    const bad = JSON.parse(fixtureJson);
    bad.items[0].drafted = { model: 'x' };
    expect(() => parseDoc(JSON.stringify(bad))).toThrow(/malformed draft details/);
  });
});

describe('openStoredDoc', () => {
  it('upgrades docs saved by older versions, keeping their records', () => {
    for (const json of [fixtureV1Json, fixtureV2Json, fixtureV3Json, fixtureV4Json]) {
      const raw = JSON.parse(json);
      const { doc, status } = openStoredDoc(raw);
      expect(status).toBe('upgraded');
      expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
      expect(doc.items.length).toBe(raw.items.length);
      expect(doc.id).toBe(raw.id);
    }
  });

  it('leaves a current doc untouched', () => {
    const d = fixture();
    expect(openStoredDoc(d)).toEqual({ doc: d, status: 'current' });
    expect(openStoredDoc(d).doc).toBe(d);
  });

  it('reports a doc from a newer version without changing it', () => {
    const newer = { ...fixture(), schemaVersion: 99, alliances: [] };
    const opened = openStoredDoc(newer);
    expect(opened.status).toBe('newer');
    expect(opened.doc).toBe(newer);
  });
});

describe('influencesOf', () => {
  it('reads only "influenced" connections, in both directions', () => {
    const r = (id: string, fromId: string, toId: string, type: Relation['type'] = 'influenced'): Relation => ({ id, fromId, toId, type, updatedAt: 1 });
    const rels = [r('1', 'socrates', 'plato'), r('2', 'plato', 'aristotle'), r('3', 'plato', 'academy', 'caused')];
    expect(influencesOf(rels, 'plato')).toEqual({ by: ['socrates'], on: ['aristotle'] });
    expect(influencesOf(rels, 'nobody')).toEqual({ by: [], on: [] });
  });
});

describe('bibliographyFor', () => {
  it('gathers sources cited here, by notes, and by connected entries, each once', () => {
    const { cited, related } = bibliographyFor(fixture(), 'i_aristotle');
    expect(cited.map((e) => [e.source.id, e.locator])).toEqual([['s_barnes', 'ch. 1']]);
    expect(related).toEqual([]);
    const plato = bibliographyFor(fixture(), 'i_plato');
    expect(plato.cited).toEqual([]);
    expect(plato.related.map((e) => [e.source.id, e.via])).toEqual([['s_barnes', 'Socrates → Plato → Aristotle']]);
  });

  it('lists works a person wrote', () => {
    expect(bibliographyFor(fixture(), 'i_plato').works.map((s) => s.id)).toEqual(['s_republic']);
    expect(bibliographyFor(fixture(), 'i_pelop').works).toEqual([]);
  });
});

describe('authoredBy', () => {
  it('matches a name however the authors are written', () => {
    expect(authoredBy('Plato; trans. G. M. A. Grube', 'Plato')).toBe(true);
    expect(authoredBy('Darwin, Charles', 'Charles Darwin')).toBe(true);
    expect(authoredBy('Will Durant and Ariel Durant', 'Ariel Durant')).toBe(true);
    expect(authoredBy('Aristotélēs', 'Aristoteles')).toBe(true);
  });

  it('doesn’t match part of a word or a missing author', () => {
    expect(authoredBy('Andrei Platonov', 'Plato')).toBe(false);
    expect(authoredBy(undefined, 'Plato')).toBe(false);
  });
});
