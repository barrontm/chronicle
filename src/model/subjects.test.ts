import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classesToFetch, classify, findInChronicle, linkedIds, parseClassParents, parseSubjectEntity, subjectPartOf, subjectWhen, toSubject,
  type ClassParents, type Subject,
} from './subjects';

/** Recorded with `node scripts/record-subjects.mjs <keys>`. */
interface Recording { key: string; entity: unknown; parents: ClassParents; labels: Record<string, string> }
const recording = (key: string): Recording =>
  JSON.parse(readFileSync(new URL(`../../tests/fixtures/subjects/${key}.json`, import.meta.url), 'utf8'));

function subjectOf(key: string): Subject {
  const r = recording(key);
  const e = parseSubjectEntity(r.entity)!;
  return toSubject(e, r.parents, r.labels);
}

describe('classifying the Greece fixture’s subjects', () => {
  it.each([
    ['Pericles', 'Q80398', 'person'],
    ['Peloponnesian_War', 'Q33745', 'war'],
    ['Battle_of_Salamis', 'Q178850', 'battle'], // a naval battle, one class up
    ['Classical_Athens', 'Q844930', 'polity'], // a polis and an archaeological site: the polis wins
    ['Athens', 'Q1524', 'place'], // today's city: a big city, though it is also a "free city"
    ['Delian_League', 'Q193235', 'polity'], // a confederation
    ['Sparta', 'Q5690', 'polity'],
  ])('%s is a %s', (key, qid, kind) => {
    const s = subjectOf(key);
    expect(s.qid).toBe(qid);
    expect(s.kind).toBe(kind);
  });

  it.each([
    ['Stoicism', 'idea'],
    ['Trireme', 'technology'], // a type of ship: P279, not P31
    ['Republic_(Plato)', 'work'],
    ['Greek_colonisation', 'migration'],
    ['Plague_of_Athens', 'event'],
    ['Archaic_Greece', 'period'],
    ['Economy_of_ancient_Greece', 'economy'],
  ])('%s is a %s', (key, kind) => {
    expect(subjectOf(key).kind).toBe(kind);
  });
});

describe('facts', () => {
  it('gives a person’s life', () => {
    const s = subjectOf('Pericles');
    expect(s.label).toBe('Pericles');
    expect(subjectWhen(s)).toBe('494–429 BCE'); // Wikidata prefers 494 over 495
  });

  it('gives a war’s span, what it was part of, and who fought', () => {
    const s = subjectOf('Peloponnesian_War');
    expect(subjectWhen(s)).toBe('431 BCE – 25 Apr 404 BCE');
    expect(s.facts.participants.length).toBeGreaterThan(1);
    for (const q of linkedIds(s.facts)) expect(s.labels[q]).toBeTruthy();
  });

  it('gives a battle’s moment, place and war', () => {
    const s = subjectOf('Battle_of_Salamis');
    expect(subjectWhen(s)).toMatch(/480 BCE/);
    expect(s.facts.coords).toBeTruthy();
    expect(subjectPartOf(s)).toMatch(/Persian/);
  });

  it('gives a polity’s founding and end', () => {
    const s = subjectOf('Delian_League');
    expect(subjectWhen(s)).toBe('478–403 BCE');
  });
});

describe('walking the class chain', () => {
  const salamis = () => parseSubjectEntity(recording('Battle_of_Salamis').entity)!;

  it('asks for parents only until a kind is found', () => {
    const e = salamis();
    expect(classesToFetch(e.classIds, {})).toEqual(['Q1261499']);
    expect(classesToFetch(e.classIds, { Q1261499: ['Q178561', 'Q113782315'] })).toEqual([]);
    expect(classesToFetch(['Q5'], {})).toEqual([]); // human: known at once
  });

  it('stops after four levels up', () => {
    const chain: ClassParents = { A: ['B'], B: ['C'], C: ['D'], D: ['E'], E: ['Q5'] };
    expect(classesToFetch(['A'], chain)).toEqual([]);
    expect(classify(['A'], chain)).toBeUndefined();
    expect(classify(['B'], chain)).toBe('person');
  });

  it('prefers the nearer class over the order of kinds', () => {
    expect(classify(['Q515', 'X'], { X: ['Q7275'] })).toBe('place');
    expect(classify(['Q515', 'Q7275'], {})).toBe('polity');
  });

  it('reads the query service’s answer, keeping classes with no parents', () => {
    const json = { results: { bindings: [
      { c: { value: 'http://www.wikidata.org/entity/Q1261499' }, p: { value: 'http://www.wikidata.org/entity/Q178561' } },
      { c: { value: 'http://www.wikidata.org/entity/Q1261499' }, p: { value: 'http://www.wikidata.org/entity/Q178561' } },
    ] } };
    expect(parseClassParents(json, ['Q1261499', 'Q9'])).toEqual({ Q1261499: ['Q178561'], Q9: [] });
  });
});

describe('without classes', () => {
  it('falls back on the facts', () => {
    const e = { qid: 'Q1', classIds: [], facts: { partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] } };
    expect(toSubject(e, {}, {}).kind).toBeUndefined();
    expect(toSubject({ ...e, facts: { ...e.facts, born: { y: -100 } } }, {}, {}).kind).toBe('person');
    expect(toSubject({ ...e, facts: { ...e.facts, coords: { lat: 1, lon: 2 } } }, {}, {}).kind).toBe('place');
  });

  it('knows when a page has no Wikidata item', () => {
    expect(parseSubjectEntity({ entities: { '-1': { site: 'enwiki', title: 'Nope', missing: '' } } })).toBeUndefined();
  });
});

it('finds what Bob already has by Wikidata id', () => {
  const items = [{ id: 'a', wikidataId: 'Q80398' }, { id: 'b' }];
  expect(findInChronicle(items, 'Q80398')?.id).toBe('a');
  expect(findInChronicle(items, 'Q1')).toBeUndefined();
});
