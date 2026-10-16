import { describe, expect, it } from 'vitest';
import { coordsText, parseCoords, placeLabel } from './places';

describe('parseCoords', () => {
  it('reads two decimals, latitude first', () => {
    expect(parseCoords('37.97, 23.72')).toEqual({ lat: 37.97, lon: 23.72 });
    expect(parseCoords(' -33.9249 18.4241 ')).toEqual({ lat: -33.9249, lon: 18.4241 });
    expect(parseCoords('37.97°, 23.72°')).toEqual({ lat: 37.97, lon: 23.72 });
  });

  it('reads hemisphere letters, in either order', () => {
    expect(parseCoords('37.97° N, 23.72° E')).toEqual({ lat: 37.97, lon: 23.72 });
    expect(parseCoords('23.72 E 37.97 N')).toEqual({ lat: 37.97, lon: 23.72 });
    expect(parseCoords('34.6 S, 58.4 W')).toEqual({ lat: -34.6, lon: -58.4 });
  });

  it('reads degrees, minutes and seconds as Wikipedia prints them', () => {
    expect(parseCoords('37°58′N 23°43′E')).toEqual({ lat: 37.9667, lon: 23.7167 });
    expect(parseCoords(`37°58'30"N 23°43'0"E`)).toEqual({ lat: 37.975, lon: 23.7167 });
    expect(parseCoords('51°30′26″N 0°7′39″W')).toEqual({ lat: 51.5072, lon: -0.1275 });
  });

  it('refuses what is not a place on Earth', () => {
    expect(parseCoords('')).toBeUndefined();
    expect(parseCoords('Athens')).toBeUndefined();
    expect(parseCoords('37.97')).toBeUndefined();
    expect(parseCoords('97, 23')).toBeUndefined();
    expect(parseCoords('37, 190')).toBeUndefined();
    expect(parseCoords('37°75′N 23°E')).toBeUndefined();
    expect(parseCoords('37 N 38 N')).toBeUndefined();
  });

  it('round-trips what it shows in the editor', () => {
    const p = { lat: 37.97151, lon: -23.72569 };
    expect(parseCoords(coordsText(p))).toEqual({ lat: 37.9715, lon: -23.7257 });
  });
});

describe('placeLabel', () => {
  it('names the role, the place and where it is', () => {
    expect(placeLabel({ name: 'Stagira', lat: 40.53, lon: 23.75, role: 'born' })).toBe('Born in Stagira (40.53°N, 23.75°E)');
    expect(placeLabel({ lat: -34.6, lon: -58.4 })).toBe('34.60°S, 58.40°W');
  });
});
