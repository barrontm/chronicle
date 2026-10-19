import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Relation, TimelineItem } from './types';
import {
  classesToFetch, classify, dateClaim, factRelations, findInChronicle, linkedIds, parseClassParents, parseSubjectEntity, regionsIn, seedRegion, subjectFacts, subjectPartOf, subjectWhen, toSubject,
  type ClassParents, type Claim, type Subject,
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
    ['Mines_of_Laurion', 'Q3314937', 'place'], // a mine, with coordinates
    ['Themistocles', 'Q179552', 'person'],
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

describe('the tray’s facts', () => {
  it('starts with when, where and part of, naming each item', () => {
    const lines = subjectFacts(subjectOf('Battle_of_Salamis'));
    expect(lines.map((l) => l.label).slice(0, 1)).toEqual(['When']);
    const where = lines.find((l) => l.label === 'Where')!;
    expect(where.pin).toBe(true);
    const partOf = lines.find((l) => l.label === 'Part of')!;
    expect(partOf.values[0]).toMatchObject({ text: expect.stringMatching(/Persian/), qid: expect.stringMatching(/^Q\d+$/) });
  });

  it('keeps long lists short', () => {
    const war = subjectFacts(subjectOf('Peloponnesian_War'), 2);
    const who = war.find((l) => l.label === 'Who took part')!;
    expect(who.values).toHaveLength(2);
  });

  it('shows coordinates when Wikidata names no place', () => {
    const s: Subject = { qid: 'Q1', kind: 'place', labels: {}, facts: { coords: { lat: 37.97, lon: -23.72 }, partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] } };
    expect(subjectFacts(s)).toEqual([{ label: 'Where', values: [{ text: '37.97° N, 23.72° W' }], pin: true }]);
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

describe('regions', () => {
  const facts = { partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] };
  const period = (region?: string) => ({ id: region ?? 'x', kind: 'span', title: 'P', start: { y: -500 }, end: { y: -400 }, categoryId: 'c', ...(region ? { region } : {}), updatedAt: 1 }) as TimelineItem;

  it('lists the regions Bob has used, once each, A to Z', () => {
    expect(regionsIn([period('Greece'), period(), period('Egypt'), period('Greece'), period('  ')])).toEqual(['Egypt', 'Greece']);
  });

  it('seeds a period’s region from its country, else its continent, in Bob’s spelling', () => {
    const labels = { Q41: 'Greece', Q46: 'Europe' };
    expect(seedRegion({ ...facts, country: ['Q41'], continent: ['Q46'] }, labels, [])).toBe('Greece');
    expect(seedRegion({ ...facts, continent: ['Q46'] }, labels, [])).toBe('Europe');
    expect(seedRegion({ ...facts, country: ['Q41'] }, labels, ['GREECE'])).toBe('GREECE');
    expect(seedRegion(facts, labels, [])).toBeUndefined();
  });

  it('reads country and continent from Wikidata', () => {
    const e = parseSubjectEntity({ entities: { Q1: { id: 'Q1', claims: {
      P17: [{ mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q41' } } } }], P30: [{ mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q46' } } } }],
    } } } })!;
    expect(e.facts).toMatchObject({ country: ['Q41'], continent: ['Q46'] });
  });
});

describe('without classes', () => {
  it('falls back on the facts', () => {
    const e = { qid: 'Q1', classIds: [], facts: { partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] } };
    expect(toSubject(e, {}, {}).kind).toBeUndefined();
    expect(toSubject({ ...e, facts: { ...e.facts, born: { y: -100 } } }, {}, {}).kind).toBe('person');
    expect(toSubject({ ...e, facts: { ...e.facts, coords: { lat: 1, lon: 2 } } }, {}, {}).kind).toBe('place');
  });

  it('never makes a language an event, however dated (Latin, c. 800 BCE)', () => {
    const latin = { qid: 'Q397', classIds: ['Q45762', 'Q436240', 'Q34770', 'Q839470'], facts: { start: { y: -799, approx: true }, partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] } };
    expect(classesToFetch(latin.classIds, {})).toEqual([]);
    expect(toSubject(latin, {}, {}).kind).toBeUndefined();
    expect(subjectWhen(toSubject(latin, {}, {}))).toBe('c. 800 BCE');
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

describe('connections from facts', () => {
  const entry = (id: string, wikidataId?: string): TimelineItem => ({ id, kind: 'event', title: id, start: { y: -480 }, categoryId: 'c', updatedAt: 1, ...(wikidataId ? { wikidataId } : {}) });
  const ends = (rs: Relation[]) => rs.map(({ fromId, toId, type, highlightIds }) => ({ fromId, toId, type, highlightIds }));

  it('makes the Battle of Salamis part of the Second Persian invasion, citing the highlight', () => {
    const s = subjectOf('Battle_of_Salamis');
    const items = [entry('invasion', 'Q1122337'), entry('handmade'), entry('elsewhere', 'Q1')];
    expect(ends(factRelations('salamis', s.facts, { items, relations: [] }, 'h1'))).toEqual([
      { fromId: 'salamis', toId: 'invasion', type: 'part-of', highlightIds: ['h1'] },
    ]);
  });

  it('relates the Peloponnesian War to the participants and places already in Chronicle', () => {
    const s = subjectOf('Peloponnesian_War');
    const items = [entry('league', 'Q193235'), entry('persia', 'Q389688'), entry('sicily', 'Q1460'), entry('wars', 'Q29788594')];
    expect(ends(factRelations('war', s.facts, { items, relations: [] }))).toEqual([
      { fromId: 'war', toId: 'wars', type: 'part-of', highlightIds: undefined },
      { fromId: 'war', toId: 'league', type: 'related', highlightIds: undefined },
      { fromId: 'war', toId: 'persia', type: 'related', highlightIds: undefined },
      { fromId: 'war', toId: 'sicily', type: 'related', highlightIds: undefined },
    ]);
  });

  it('turns follows and followed by into "led to", and influences go both ways', () => {
    const facts = { follows: ['Q1'], followedBy: ['Q2'], influencedBy: ['Q913', 'Q999'], influenced: ['Q868', 'Q868'] };
    const items = [entry('before', 'Q1'), entry('after', 'Q2'), entry('socrates', 'Q913'), entry('aristotle', 'Q868')];
    expect(ends(factRelations('plato', facts, { items, relations: [] }))).toEqual([
      { fromId: 'before', toId: 'plato', type: 'caused', highlightIds: undefined },
      { fromId: 'plato', toId: 'after', type: 'caused', highlightIds: undefined },
      { fromId: 'socrates', toId: 'plato', type: 'influenced', highlightIds: undefined },
      { fromId: 'plato', toId: 'aristotle', type: 'influenced', highlightIds: undefined },
    ]);
  });

  it('suggests nothing Bob already has, nor the entry itself', () => {
    const s = subjectOf('Battle_of_Salamis');
    const have: Relation = { id: 'r1', fromId: 'invasion', toId: 'salamis', type: 'related', updatedAt: 1 };
    expect(factRelations('salamis', s.facts, { items: [entry('invasion', 'Q1122337')], relations: [have] })).toEqual([]);
    expect(factRelations('salamis', { partOf: ['Q178850'] }, { items: [entry('salamis', 'Q178850')], relations: [] })).toEqual([]);
  });

  it('reads influences from the entity, and copes with subjects cached before they were read', () => {
    expect(subjectOf('Pericles').facts.influencedBy).toBeInstanceOf(Array);
    const old = { partOf: [], follows: [], followedBy: [], participants: [], locations: [], government: [] };
    expect(factRelations('x', old, { items: [entry('y', 'Q1')], relations: [] })).toEqual([]);
  });
});

describe('dates in two calendars', () => {
  const W = 'http://www.wikidata.org/entity/';
  const claim = (time: string, cal: 'Q1985727' | 'Q1985786', rank = 'normal', precision = 11): Claim =>
    ({ rank, mainsnak: { snaktype: 'value', datavalue: { value: { time, precision, calendarmodel: W + cal } } } } as Claim);
  const born = (...c: Claim[]) => dateClaim({ P569: c }, 'P569');

  it('uses the Gregorian date after 1582, even when Wikidata prefers the Julian (Newton, Peter the Great)', () => {
    expect(born(claim('+1642-12-25T00:00:00Z', 'Q1985786', 'preferred'), claim('+1643-01-04T00:00:00Z', 'Q1985727'), claim('+1642-00-00T00:00:00Z', 'Q1985727', 'normal', 9)))
      .toEqual({ y: 1643, m: 1, d: 4 });
    expect(born(claim('+1672-05-30T00:00:00Z', 'Q1985786', 'preferred'), claim('+1672-06-09T00:00:00Z', 'Q1985727'))).toEqual({ y: 1672, m: 6, d: 9 });
  });

  it('uses the Julian date before 1583 (Dante), and in BCE', () => {
    const dante = [claim('+1321-09-22T00:00:00Z', 'Q1985727'), claim('+1321-09-14T00:00:00Z', 'Q1985786', 'preferred')];
    expect(dateClaim({ P570: dante }, 'P570')).toEqual({ y: 1321, m: 9, d: 14 });
    expect(born(claim('-0356-07-30T00:00:00Z', 'Q1985727'), claim('-0356-07-20T00:00:00Z', 'Q1985786'))).toEqual({ y: -355, m: 7, d: 20 });
    expect(born(claim('+0050-03-01T00:00:00Z', 'Q1985727'))).toEqual({ y: 50, m: 3, d: 1 });
  });

  it('keeps a lone Julian date, and never swaps for a different date or a deprecated one (Shakespeare)', () => {
    expect(born(claim('+1616-04-23T00:00:00Z', 'Q1985786'), claim('+1616-05-03T00:00:00Z', 'Q1985727', 'deprecated'))).toEqual({ y: 1616, m: 4, d: 23 });
    expect(born(claim('+1700-01-01T00:00:00Z', 'Q1985786', 'preferred'), claim('+1702-01-12T00:00:00Z', 'Q1985727'))).toEqual({ y: 1700, m: 1, d: 1 });
  });

  it('works across a leap day', () => {
    expect(born(claim('+1700-02-19T00:00:00Z', 'Q1985786', 'preferred'), claim('+1700-03-02T00:00:00Z', 'Q1985727'))).toEqual({ y: 1700, m: 3, d: 2 });
  });
});
