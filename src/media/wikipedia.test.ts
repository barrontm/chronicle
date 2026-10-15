import { describe, expect, it } from 'vitest';
import type { Source } from '../model/types';
import {
  buildCoordsUrl,
  buildDraft,
  buildEntityUrl,
  buildSearchUrl,
  buildSummaryUrl,
  kindAndDates,
  parseCoords,
  parseEntity,
  parseLabels,
  parseSearch,
  parseSummary,
} from './wikipedia';

const time = (t: string, precision = 9) => ({ mainsnak: { snaktype: 'value', datavalue: { value: { time: t, precision } } }, rank: 'normal' });
const item = (id: string) => ({ mainsnak: { snaktype: 'value', datavalue: { value: { id } } }, rank: 'normal' });
const entity = (qid: string, claims: Record<string, unknown[]>) => ({ entities: { [qid]: { claims } } });

describe('URLs', () => {
  it('asks Wikimedia for anonymous CORS where needed', () => {
    expect(buildSearchUrl('battle of marathon')).toBe('https://en.wikipedia.org/w/rest.php/v1/search/page?q=battle+of+marathon&limit=10');
    expect(buildSummaryUrl('Battle_of_Marathon')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Battle_of_Marathon');
    expect(buildEntityUrl('Q33')).toContain('origin=*');
    expect(buildCoordsUrl('Q90')).toContain('property=P625');
  });
});

describe('parsing responses', () => {
  it('reads search results and fixes protocol-relative thumbnails', () => {
    const r = parseSearch({ pages: [
      { key: 'Battle_of_Marathon', title: 'Battle of Marathon', description: 'Battle in 490 BC', thumbnail: { url: '//upload.wikimedia.org/m.jpg' } },
      { key: 'Marathon', title: 'Marathon', description: null, thumbnail: null },
    ] });
    expect(r).toEqual([
      { key: 'Battle_of_Marathon', title: 'Battle of Marathon', description: 'Battle in 490 BC', thumbUrl: 'https://upload.wikimedia.org/m.jpg' },
      { key: 'Marathon', title: 'Marathon', description: undefined, thumbUrl: undefined },
    ]);
    expect(parseSearch({})).toEqual([]);
  });

  it('reads a page summary', () => {
    const s = parseSummary({
      title: 'Ada Lovelace', description: 'English mathematician (1815–1852)', extract: ' Augusta Ada King… ', wikibase_item: 'Q7259',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
    });
    expect(s).toEqual({ title: 'Ada Lovelace', description: 'English mathematician (1815–1852)', extract: 'Augusta Ada King…', qid: 'Q7259', pageUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace', coords: undefined });
    expect(() => parseSummary({})).toThrow(/couldn’t read/);
  });

  it('reads a person: human, dates, birth and death places, image', () => {
    const f = parseEntity(entity('Q7259', {
      P31: [item('Q5')], P569: [time('+1815-12-10T00:00:00Z', 11)], P570: [time('+1852-11-27T00:00:00Z', 11)],
      P19: [item('Q84')], P20: [item('Q84')], P18: [{ mainsnak: { snaktype: 'value', datavalue: { value: 'Ada Lovelace portrait.jpg' } } }],
    }), 'Q7259');
    expect(f).toMatchObject({ isHuman: true, born: { y: 1815, m: 12, d: 10 }, died: { y: 1852, m: 11, d: 27 }, birthPlaceId: 'Q84', imageFile: 'Ada Lovelace portrait.jpg' });
    expect(kindAndDates(f)).toEqual({ kind: 'person', start: { y: 1815, m: 12, d: 10 }, end: { y: 1852, m: 11, d: 27 } });
  });

  it('reads a BCE battle as an event with its coordinates', () => {
    const f = parseEntity(entity('Q33', {
      P31: [item('Q178561')], P585: [time('-0490-00-00T00:00:00Z')],
      P625: [{ mainsnak: { snaktype: 'value', datavalue: { value: { latitude: 38.118, longitude: 23.978 } } } }],
    }), 'Q33');
    expect(kindAndDates(f)).toEqual({ kind: 'event', start: { y: -489 } });
    expect(f.coords).toEqual({ lat: 38.118, lon: 23.978 });
  });

  it('reads something with a start and an end as a period, using inception/dissolved as fallbacks', () => {
    const f = parseEntity(entity('Q2277', { P571: [time('-0026-00-00T00:00:00Z')], P576: [time('+1453-05-29T00:00:00Z', 11)] }), 'Q2277');
    expect(kindAndDates(f)).toEqual({ kind: 'span', start: { y: -25 }, end: { y: 1453, m: 5, d: 29 } });
  });

  it('prefers preferred-rank values, skips deprecated and unknown ones, and honours circa', () => {
    const f = parseEntity(entity('Q1', {
      P585: [
        { ...time('+1400-00-00T00:00:00Z'), rank: 'deprecated' },
        time('+1430-00-00T00:00:00Z'),
        { ...time('+1440-00-00T00:00:00Z'), rank: 'preferred', qualifiers: { P1480: [{ datavalue: { value: { id: 'Q5727902' } } }] } },
      ],
      P580: [{ mainsnak: { snaktype: 'somevalue' }, rank: 'normal' }],
    }), 'Q1');
    expect(f.pointInTime).toEqual({ y: 1440, approx: true });
    expect(f.start).toBeUndefined();
  });

  it('reads place coordinates and labels', () => {
    expect(parseCoords({ claims: { P625: [{ mainsnak: { snaktype: 'value', datavalue: { value: { latitude: 51.5, longitude: -0.12 } } } }] } })).toEqual({ lat: 51.5, lon: -0.12 });
    expect(parseCoords({ claims: {} })).toBeUndefined();
    expect(parseLabels({ entities: { Q84: { labels: { en: { value: 'London' } } }, Q2: { labels: {} } } })).toEqual({ Q84: 'London' });
  });
});

describe('buildDraft', () => {
  const summary = parseSummary({
    title: 'Battle of Marathon', description: 'battle in 490 BC', extract: 'The Battle of Marathon took place in 490 BC.', wikibase_item: 'Q33',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Battle_of_Marathon' } }, coordinates: { lat: 38.1, lon: 23.9 },
  });
  const facts = parseEntity(entity('Q33', { P585: [time('-0490-00-00T00:00:00Z')] }), 'Q33');

  it('prefills an entry that cites a new Wikipedia source and quotes the intro', () => {
    const { item, newSources } = buildDraft({ summary, facts, existingSources: [], categoryId: 'war', today: '2026-10-15' });
    expect(newSources).toHaveLength(1);
    const src = newSources[0];
    expect(src).toMatchObject({ kind: 'web', title: 'Battle of Marathon', authors: 'Wikipedia contributors', publisher: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Battle_of_Marathon', accessed: '2026-10-15' });
    expect(item).toMatchObject({
      kind: 'event', title: 'Battle of Marathon', start: { y: -489 }, categoryId: 'war', description: 'Battle in 490 BC', wikidataId: 'Q33',
      citations: [{ sourceId: src.id }], excerpt: { text: 'The Battle of Marathon took place in 490 BC.', sourceId: src.id },
      places: [{ name: 'Battle of Marathon', lat: 38.1, lon: 23.9, role: 'site' }],
    });
  });

  it('reuses a source already in the bibliography', () => {
    const existing: Source = { id: 's_old', kind: 'web', title: 'Battle of Marathon', url: 'https://en.wikipedia.org/wiki/Battle_of_Marathon', updatedAt: 1 };
    const { item, newSources } = buildDraft({ summary, facts, existingSources: [existing], categoryId: 'war', today: '2026-10-15' });
    expect(newSources).toEqual([]);
    expect(item.citations).toEqual([{ sourceId: 's_old' }]);
  });

  it('prefers Wikidata places over the page coordinates, and leaves the date empty when unknown', () => {
    const { item } = buildDraft({ summary, places: [{ name: 'Marathon', lat: 38.15, lon: 23.96, role: 'site' }], existingSources: [], categoryId: 'war', today: '2026-10-15' });
    expect(item.places).toEqual([{ name: 'Marathon', lat: 38.15, lon: 23.96, role: 'site' }]);
    expect(item.start).toBeUndefined();
    expect(item.kind).toBe('event');
  });
});
