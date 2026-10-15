import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from '../model/doc';
import type { Relation, TimelineItem } from '../model/types';
import { arcsBetween, choroplethAt, mapKindOf, mixColor, parseColor, pinsAt, placesToDraw, territoriesAt, territoryCircles } from './mapData';

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
