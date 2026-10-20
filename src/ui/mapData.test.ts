import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../model/doc';
import type { Flow, Relation, Territory, TimelineItem } from '../model/types';
import { aboutPeople, activeRoutes, contactsAt, contactsDuring, followAt, arcPoints, arcsBetween, choroplethAt, draftPins, endBearing, flowDashes, flowFeatures, flowScale, mapKindOf, mixColor, parseColor, pinsAt, placesToDraw, rateAt, territoriesAt, territoryCircles, type FlowPlaces } from './mapData';

const fixture = () => parseDoc(readFileSync(new URL('../../tests/fixtures/sample-history.json', import.meta.url), 'utf8'));
const colorOf = (id: string) => (id === 'hidden' ? undefined : '#123456');

const athens = { name: 'Athens', lat: 37.98, lon: 23.73 };
const item = (over: Partial<TimelineItem>): TimelineItem => ({ id: 'x', kind: 'event', title: 'X', start: { y: -489 }, categoryId: 'war', updatedAt: 0, ...over });

describe('pins', () => {
  it('draws a person at their birthplace and an event at its sites', () => {
    expect(placesToDraw(item({ kind: 'person', places: [{ ...athens, role: 'died' }, { name: 'Stagira', lat: 40.5, lon: 23.7, role: 'born' }] }))[0].name).toBe('Stagira');
    expect(placesToDraw(item({ places: [athens, { ...athens, name: 'Sparta' }] }))).toHaveLength(2);
    expect(placesToDraw(item({}))).toEqual([]);
  });

  it('shows only what is happening in the year, in visible categories', () => {
    const items = [
      item({ id: 'a', places: [athens] }),
      item({ id: 'b', start: { y: 1900 }, places: [athens] }),
      item({ id: 'c', categoryId: 'hidden', places: [athens] }),
      item({ id: 'd' }),
    ];
    const pins = pinsAt(items, -489, { fadeYears: 20, keepPast: false, colorOf, selectedId: 'a' });
    expect(pins.features.map((f) => f.properties.id)).toEqual(['a']);
    expect(pins.features[0].properties).toMatchObject({ opacity: 1, selected: true, color: '#123456' });
    expect(pins.features[0].geometry.coordinates).toEqual([23.73, 37.98]);
  });

  it('joins connected entries that are both on the map', () => {
    const items = [item({ id: 'a', places: [athens] }), item({ id: 'b', places: [{ lat: 31.2, lon: 29.9 }] }), item({ id: 'c', start: { y: 2000 }, places: [athens] })];
    const pins = pinsAt(items, -489, { fadeYears: 20, keepPast: false, colorOf });
    const rel = (id: string, fromId: string, toId: string): Relation => ({ id, fromId, toId, type: 'influenced', updatedAt: 0 });
    const arcs = arcsBetween([rel('r1', 'a', 'b'), rel('r2', 'a', 'c')], pins);
    expect(arcs.features.map((f) => f.properties.id)).toEqual(['r1']);
    expect(arcs.features[0].geometry.coordinates).toEqual([[23.73, 37.98], [29.9, 31.2]]);
  });
});

describe('places', () => {
  const place = (over: Partial<TimelineItem>) => item({ id: 'olynthus', kind: 'span', subject: 'place', title: 'Olynthus', places: [{ name: 'Olynthus', lat: 40.29, lon: 23.35, role: 'site' }], ...over });
  const opacityIn = (it: TimelineItem, year: number, keepPast = false) => pinsAt([it], year, { fadeYears: 20, keepPast, colorOf }).features[0]?.properties.opacity ?? 0;

  it('fades a place’s pin in from its founding and out after it was abandoned', () => {
    const olynthus = place({ start: { y: -431 }, end: { y: -347 } });
    expect(opacityIn(olynthus, -432)).toBe(0);
    expect(opacityIn(olynthus, -431)).toBeCloseTo(0.3);
    expect(opacityIn(olynthus, -421)).toBeCloseTo(0.65);
    expect(opacityIn(olynthus, -400)).toBe(1);
    expect(opacityIn(olynthus, -346)).toBe(1);
    expect(opacityIn(olynthus, -336)).toBeCloseTo(0.5);
    expect(opacityIn(olynthus, -320)).toBe(0);
    expect(opacityIn(olynthus, -320, true)).toBeCloseTo(0.4);
  });
  it('shows a place with no dates in every year, and one still there from its founding on', () => {
    expect(opacityIn(place({ start: undefined }), -3000)).toBe(1);
    expect(opacityIn(place({ start: undefined }), 2000)).toBe(1);
    expect(opacityIn(place({ start: { y: -330 } }), 2000)).toBe(1);
    expect(opacityIn(place({ start: undefined, end: { y: -347 } }), -320)).toBe(0);
  });
});

describe('territories and values', () => {
  it('draws the snapshot in effect and changes its key only when the snapshot changes', () => {
    const doc = fixture();
    const a = territoriesAt(doc.territories, -400, colorOf);
    const b = territoriesAt(doc.territories, -300, colorOf);
    const c = territoriesAt(doc.territories, -100, colorOf);
    expect(a.shapes.features).toHaveLength(1);
    expect(a.key).toBe(b.key);
    expect(c.key).not.toBe(a.key);
    expect(a.labels[0]).toMatchObject({ id: 't_fixture', title: 'Fixture Republic', lon: 12.5, lat: 42 });
    expect(territoriesAt(doc.territories, 500, colorOf).shapes.features).toHaveLength(0);
  });

  it('switches a city-state’s borders at the dates Bob gave them', () => {
    const shape = (s: number) => ({ type: 'Polygon' as const, coordinates: [[[23, 38], [23 + s, 38], [23 + s, 38 + s], [23, 38]]] });
    const athens: Territory = {
      id: 't_athens', title: 'Athens', categoryId: 'politics', updatedAt: 0,
      // 508 BCE until 338 BCE, then smaller after Chaeronea.
      snapshots: [{ from: { y: -507 }, to: { y: -337 }, geometry: shape(1) }, { from: { y: -337 }, geometry: shape(0.5) }],
    };
    expect(territoriesAt([athens], -508, colorOf).shapes.features).toHaveLength(0);
    expect(territoriesAt([athens], -430, colorOf).shapes.features[0].geometry).toEqual(shape(1));
    expect(territoriesAt([athens], -337, colorOf).shapes.features[0].geometry).toEqual(shape(0.5));
  });

  it('shades countries on a fixed scale and skips years without data', () => {
    const series = fixture().series.find((s) => s.id === 'sr_regional')!;
    const { shades, values, extent } = choroplethAt(series, 1900);
    expect(extent).toEqual([5, 95]);
    expect(values.get('FRA')).toBe(40);
    expect(shades.get('ITA')).toBeCloseTo((25 - 5) / 90);
    expect(shades.has('t_fixture')).toBe(false);
    expect(choroplethAt(series, 1700).shades.size).toBe(0);
  });

  it('sizes circles on territories by value', () => {
    const doc = fixture();
    const series = doc.series.find((s) => s.id === 'sr_regional')!;
    const circles = territoryCircles(series, territoriesAt(doc.territories, -200, colorOf), -200, '#000');
    expect(circles.features).toHaveLength(1);
    expect(circles.features[0].properties.value).toBe(3);
    expect(circles.features[0].properties.radius).toBeCloseTo(6 + 34 * Math.sqrt(3 / 5));
  });

  it('says what a trend can show on the map', () => {
    const doc = fixture();
    expect(mapKindOf(doc.series.find((s) => s.id === 'sr_regional')!)).toBe('both');
    expect(mapKindOf(doc.series[0])).toBeNull();
  });
});

describe('colors', () => {
  it('parses and mixes CSS colors', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor(' #2f5da8')).toEqual([47, 93, 168]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('papayawhip')).toBeNull();
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
  });
});

describe('migration flows', () => {
  const famine: Flow = {
    id: 'f', title: 'Famine emigration', categoryId: 'society', cause: 'disaster', measure: 'moved', updatedAt: 0,
    routes: [{ from: { country: 'IRL' }, to: { country: 'USA' }, points: [{ x: 1846, v: 130000 }, { x: 1855, v: 130000 }] }],
  };
  const places: FlowPlaces = {
    countries: new Map([['IRL', { name: 'Ireland', lon: -8, lat: 53 }], ['USA', { name: 'United States', lon: -99, lat: 39 }]]),
    territories: fixture().territories,
    year: 1850,
  };

  it('counts whole years and draws nothing outside the numbers', () => {
    const pts = famine.routes[0].points;
    expect(rateAt(pts, 1845.9)).toBeUndefined();
    expect(rateAt(pts, 1846)).toBe(130000);
    expect(rateAt(pts, 1855.7)).toBe(130000);
    expect(rateAt(pts, 1856)).toBeUndefined();
    expect(rateAt([{ x: 1900, v: 10 }, { x: 1910, v: 30 }], 1905)).toBe(20);
    expect(activeRoutes([famine], 1850, () => true)).toHaveLength(1);
    expect(activeRoutes([famine], 1870, () => true)).toHaveLength(0);
    expect(activeRoutes([famine], 1850, (f) => f.cause !== 'disaster')).toHaveLength(0);
  });

  it('keeps flows and stocks on separate scales', () => {
    const living: Flow = { ...famine, id: 'l', measure: 'living', routes: [{ ...famine.routes[0], points: [{ x: 1900, v: 4e6 }] }] };
    expect(flowScale([famine, living])).toEqual({ moved: 130000, living: 4e6 });
  });

  it('follows a curved great circle that ends exactly at both places', () => {
    const arc = arcPoints([-8, 53], [-99, 39]);
    expect(arc[0]).toEqual([-8, 53]);
    expect(arc.at(-1)).toEqual([-99, 39]);
    // The great circle from Ireland to the US arcs north of both ends.
    expect(Math.max(...arc.map((p) => p[1]))).toBeGreaterThan(53);
    // A → B and B → A bow to opposite sides.
    const there = arcPoints([0, 0], [20, 0])[24];
    const back = arcPoints([20, 0], [0, 0])[24];
    expect(Math.sign(there[1])).toBe(-Math.sign(back[1]));
    // Across the Pacific the line stays continuous instead of crossing the whole map.
    const pacific = arcPoints([140, 35], [-122, 37]);
    for (let i = 1; i < pacific.length; i++) expect(Math.abs(pacific[i][0] - pacific[i - 1][0])).toBeLessThan(10);
    expect(endBearing([[0, 0], [0, 1]])).toBeCloseTo(0);
    expect(endBearing([[0, 0], [1, 0]])).toBeCloseTo(90);
  });

  it('makes a labeled, arrowed route sized by the rate', () => {
    const active = activeRoutes([famine], 1850, () => true);
    const { lines, heads } = flowFeatures(active, places, flowScale([famine]), () => '#123456');
    expect(lines.features[0].properties).toMatchObject({
      label: 'Ireland → United States · famine & disaster · about 130,000 a year (1846–1855)',
      moving: true, width: 11.5, color: '#123456',
    });
    expect(heads.features[0].geometry.coordinates).toEqual([-99, 39]);
    // A route to a territory that has no borders that year still finds it; an unknown country is skipped.
    const toTerr: Flow = { ...famine, routes: [{ ...famine.routes[0], to: { territoryId: 't_fixture' } }, { ...famine.routes[0], to: { country: 'ZZZ' } }] };
    const t = flowFeatures(activeRoutes([toTerr], 1850, () => true), places, flowScale([toTerr]), () => '#000');
    expect(t.lines.features).toHaveLength(1);
    expect(t.heads.features[0].geometry.coordinates).toEqual([12.5, 42]);
  });

  it('moves dashes from origin to destination, faster for bigger flows', () => {
    const { lines } = flowFeatures(activeRoutes([famine], 1850, () => true), places, flowScale([famine]), () => '#000');
    const a = flowDashes(lines, 0);
    const b = flowDashes(lines, 0.5);
    expect(a.features.length).toBeGreaterThanOrEqual(3);
    // The first dash has moved west, towards the United States.
    expect(b.features[0].geometry.coordinates[0][0]).toBeLessThan(a.features[0].geometry.coordinates[0][0]);
    const still = flowFeatures(activeRoutes([{ ...famine, measure: 'living' }], 1850, () => true), places, { moved: 0, living: 130000 }, () => '#000');
    expect(flowDashes(still.lines, 1).features).toEqual([]);
  });

  it('rounds estimates to two figures', () => {
    expect(aboutPeople(131234)).toBe('about 130,000');
    expect(aboutPeople(1340000)).toBe('about 1.3 million');
    expect(aboutPeople(45)).toBe('about 45');
  });
});

describe('draftPins', () => {
  const item = (id: string, places: TimelineItem['places'], kind: TimelineItem['kind'] = 'event'): TimelineItem => ({ id, kind, title: id, start: { y: -489 }, categoryId: 'war', places, updatedAt: 0 });
  it('draws every pending draft at its places, with bounds to frame them', () => {
    const r = draftPins([item('a', [{ lat: 38, lon: 24 }]), item('b', [{ lat: 37, lon: 23.5 }, { lat: 40, lon: 20 }]), item('c', undefined)], () => '#c00');
    expect(r.pins.map((p) => [p.id, p.lon, p.lat, p.color])).toEqual([['a#0', 24, 38, '#c00'], ['b#0', 23.5, 37, '#c00'], ['b#1', 20, 40, '#c00']]);
    expect(r.bounds).toEqual([20, 37, 24, 40]);
  });
  it('has no bounds when nothing has a place', () => {
    expect(draftPins([item('c', [])], () => undefined)).toEqual({ pins: [], bounds: null });
  });
});

describe('following the timeline', () => {
  const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
  const how = (cs: { territoryId: string; how: string }[]) => Object.fromEntries(cs.map((c) => [c.territoryId, c.how]));
  const t = (id: string, extra: Partial<Territory> = {}): Territory => ({ id, title: id, categoryId: 'c', snapshots: [], updatedAt: 0, ...extra });
  const e = (id: string, y: number, end?: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: end === undefined ? 'event' : 'span', title: id, categoryId: 'c', start: { y }, ...(end === undefined ? {} : { end: { y: end } }), updatedAt: 0, ...extra });
  const rel = (fromId: string, toId: string, side?: 1 | 2, type: Relation['type'] = 'related'): Relation => ({ id: `${fromId}-${toId}`, fromId, toId, type, ...(side ? { side } : {}), updatedAt: 0 });

  it('in 431 BCE Athens is at war with Sparta, Corinth and Thebes (the Peloponnesian War)', () => {
    const cs = contactsAt('t_athens', -430, doc);
    expect(how(cs)).toMatchObject({ t_sparta: 'war', t_corinth: 'war', t_thebes: 'war' });
    expect(cs.find((c) => c.territoryId === 't_sparta')!.via).toContain('i_pelop');
    // The Delian League is Athens' own alliance, not a polity it was at peace with; founding it made them allies that year.
    expect(how(cs).t_delian).toBeUndefined();
    expect(how(contactsAt('t_athens', -477, doc)).t_delian).toBe('allied');
    // Persia isn't in it that year.
    expect(how(cs).t_persia).toBeUndefined();
  });

  it('reads sides: the same side of a war is allied, opposite sides of a treaty at peace, no sides allied', () => {
    const d = {
      items: [e('war', -400, -390, { subject: 'war' }), e('peace', -380, undefined, { lanes: ['politics'] }), e('league', -370)],
      territories: [t('a'), t('b'), t('c')],
      relations: [rel('a', 'war', 1), rel('b', 'war', 1), rel('c', 'war', 2), rel('a', 'peace', 1), rel('c', 'peace', 2), rel('a', 'league'), rel('b', 'league')],
    };
    expect(how(contactsAt('a', -395, d))).toEqual({ b: 'allied', c: 'war' });
    expect(how(contactsAt('a', -380, d))).toEqual({ c: 'peace' });
    expect(how(contactsAt('a', -370, d))).toEqual({ b: 'allied' });
    expect(contactsAt('a', -360, d)).toEqual([]);
    // Over years, the strongest: at war beats allied.
    expect(how(contactsDuring('a', -400, -360, d))).toEqual({ b: 'allied', c: 'war' });
  });

  it('a polity’s entry stands for it, trade comes from flows for work and the economy', () => {
    const d = {
      items: [e('athens-entry', -500, -300), e('war', -400, -390, { subject: 'war' })],
      territories: [t('a', { itemId: 'athens-entry' }), t('b')],
      relations: [rel('athens-entry', 'war', 1), rel('b', 'war', 2)],
      flows: [{ id: 'f', title: 'Grain', categoryId: 'c', cause: 'economic' as const, measure: 'moved' as const, routes: [{ from: { territoryId: 'b' }, to: { territoryId: 'a' }, points: [{ x: -350, v: 1 }, { x: -340, v: 1 }] }], updatedAt: 0 }],
    };
    expect(how(contactsAt('a', -395, d))).toEqual({ b: 'war' });
    expect(how(contactsAt('a', -345, d))).toEqual({ b: 'trade' });
  });

  it('a picked polity is drawn in ink with its contacts named, and the map fits those it fought', () => {
    const f = followAt({ ...doc, focus: { pick: 'pol:t_athens' }, year: -430, window: { start: -500, end: -300 } });
    expect(f.marks.get('t_athens')).toEqual({ how: 'picked' });
    expect(f.marks.get('t_sparta')).toEqual({ how: 'war', text: 'at war' });
    expect(f.pickFit?.key).toBe('pol:t_athens|');
    // Sparta's lands are in the fit.
    const [w, s] = f.pickFit!.bounds;
    expect(w).toBeLessThan(22.5);
    expect(s).toBeLessThan(37);
  });

  it('the War lane names everyone it fought in the years in view; the Economy lane pins its entries', () => {
    const war = followAt({ ...doc, focus: { pick: 'pol:t_athens', open: true, lane: 'war' }, year: -430, window: { start: -500, end: -300 } });
    expect(war.marks.get('t_persia')).toEqual({ how: 'war', text: 'fought' });
    expect(war.marks.get('t_macedon')).toEqual({ how: 'war', text: 'fought' });
    const eco = followAt({ ...doc, focus: { pick: 'pol:t_athens', open: true, lane: 'economy', laneIds: ['i_laurion'] }, year: -482, window: { start: -500, end: -300 } });
    expect(eco.pins.features.map((p) => p.properties.id)).toEqual(['i_laurion']);
    expect(eco.pins.features[0].properties.opacity).toBe(1);
  });

  it('a region Bob clicks is fitted', () => {
    const f = followAt({ ...doc, focus: {}, region: 'Persia', year: -430, window: { start: -500, end: -300 } });
    expect(f.regionFit?.key).toBe('Persia');
    expect(f.regionFit!.bounds[2]).toBeGreaterThan(50);
  });
});
