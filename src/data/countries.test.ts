import { describe, expect, it } from 'vitest';
import { parseCountries } from './countries';

const box = (x: number, y: number, s: number) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];

describe('parseCountries', () => {
  it('places each country at the middle of its largest piece, sorted by name, skipping codes that are not countries', () => {
    const list = parseCountries({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { iso3: 'USA', name: 'United States' }, geometry: { type: 'MultiPolygon', coordinates: [box(-120, 30, 40), box(-160, 55, 4)] } },
        { type: 'Feature', properties: { iso3: 'IRL', name: 'Ireland' }, geometry: { type: 'Polygon', coordinates: box(-10, 52, 4) } },
        { type: 'Feature', properties: { iso3: '-99', name: 'Somewhere' }, geometry: { type: 'Polygon', coordinates: box(0, 0, 1) } },
      ],
    });
    expect(list.map((c) => c.code)).toEqual(['IRL', 'USA']);
    expect(list[1].lon).toBeCloseTo(-100);
    expect(list[1].lat).toBeGreaterThan(40);
  });
});
