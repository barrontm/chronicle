import type { FeatureCollection, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { BASEMAP_YEARS, basemapFor, basemapUrl, mapsDuring, matchPolity, polityNames, snapshotsFor, withinLife } from './basemaps';
import { areaKm2, bbox, FINE, isArea, labelPoint, parseGeoJsonAreas, simplifyArea, simplifyLine } from './geo';

const square = (x: number, y: number, size: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
});

describe('simplify', () => {
  it('drops points that lie within the tolerance of a straight line', () => {
    const line = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [3, 3]];
    expect(simplifyLine(line, 0.01)).toEqual([[0, 0], [3, 0], [3, 3]]);
    expect(simplifyLine(line, 0)).toHaveLength(5);
  });

  it('keeps big shapes, drops islands that collapse, and rounds coordinates', () => {
    const g = { type: 'MultiPolygon' as const, coordinates: [square(10.00004, 40, 2).coordinates, square(30, 30, 0.001).coordinates] };
    const s = simplifyArea(g, 0.05, 3)!;
    expect(s.type).toBe('Polygon');
    expect((s as Polygon).coordinates[0][0]).toEqual([10, 40]);
    expect(simplifyArea(square(0, 0, 0.001), 0.05)).toBeNull();
  });

  it('handles a long ring without blowing the stack', () => {
    const ring = Array.from({ length: 50_000 }, (_, i) => [Math.cos((i / 50_000) * 2 * Math.PI), Math.sin((i / 50_000) * 2 * Math.PI)]);
    ring.push(ring[0]);
    const s = simplifyArea({ type: 'Polygon', coordinates: [ring] }, 0.01)!;
    expect((s as Polygon).coordinates[0].length).toBeLessThan(200);
  });
});

describe('measuring', () => {
  it('computes areas on the sphere', () => {
    // A 1°×1° cell at the equator is about 12,364 km².
    expect(areaKm2(square(0, 0, 1))).toBeGreaterThan(12_200);
    expect(areaKm2(square(0, 0, 1))).toBeLessThan(12_500);
    // Holes are subtracted.
    const holed: Polygon = { type: 'Polygon', coordinates: [square(0, 0, 2).coordinates[0], square(0.5, 0.5, 1).coordinates[0]] };
    expect(areaKm2(holed)).toBeCloseTo(areaKm2(square(0, 0, 2)) - areaKm2(square(0.5, 0.5, 1)), 0);
  });

  it('labels the largest piece and finds the bounding box', () => {
    const g = { type: 'MultiPolygon' as const, coordinates: [square(100, 0, 0.5).coordinates, square(10, 40, 4).coordinates] };
    expect(labelPoint(g)).toEqual({ lon: 12, lat: 42 });
    expect(bbox(g)).toEqual([10, 0, 100.5, 44]);
  });

  it('recognises polygons', () => {
    expect(isArea(square(0, 0, 1))).toBe(true);
    expect(isArea({ type: 'Point', coordinates: [0, 0] })).toBe(false);
    expect(isArea(null)).toBe(false);
  });
});

describe('historical-basemaps', () => {
  it('maps file names to astronomical years', () => {
    expect(BASEMAP_YEARS[0]).toEqual({ y: -122_999, file: 'world_bc123000.geojson' });
    expect(BASEMAP_YEARS.find((b) => b.file === 'world_bc500.geojson')!.y).toBe(-499);
    expect(BASEMAP_YEARS.find((b) => b.file === 'world_bc1.geojson')!.y).toBe(0);
    expect(basemapUrl(BASEMAP_YEARS.find((b) => b.y === 1880)!)).toBe('https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_1880.geojson');
  });

  it('picks the latest map at or before a year', () => {
    expect(basemapFor(-490).file).toBe('world_bc500.geojson');
    expect(basemapFor(1913).file).toBe('world_1900.geojson');
    expect(basemapFor(1914).file).toBe('world_1914.geojson');
    expect(basemapFor(-500_000).file).toBe('world_bc123000.geojson');
  });

  const fc = (features: Array<[string | null, Polygon]>): FeatureCollection => ({
    type: 'FeatureCollection',
    features: features.map(([NAME, geometry]) => ({ type: 'Feature', properties: { NAME }, geometry })),
  });
  const y = (file: string) => BASEMAP_YEARS.find((b) => b.file === file)!;

  it('lists polity names without blanks or duplicates', () => {
    expect(polityNames(fc([['Rome', square(0, 0, 1)], [null, square(5, 5, 1)], ['Carthage', square(9, 9, 1)], ['Rome', square(2, 2, 1)]]))).toEqual(['Carthage', 'Rome']);
  });

  it('collects one polity across snapshots, merging its pieces, each lasting until the next map', () => {
    const snaps = snapshotsFor('Rome', [
      { year: y('world_bc200.geojson'), fc: fc([['Rome', square(10, 40, 4)], ['Rome', square(20, 40, 1)]]) },
      { year: y('world_bc300.geojson'), fc: fc([['Rome', square(11, 41, 2)]]) },
      { year: y('world_bc100.geojson'), fc: fc([['Gaul', square(0, 45, 3)]]) },
    ]);
    expect(snaps.map((s) => [s.from.y, s.to?.y])).toEqual([[-299, -199], [-199, -99]]);
    expect(snaps[1].geometry!.type).toBe('MultiPolygon');
    expect(snaps[1].areaKm2).toBeGreaterThan(snaps[0].areaKm2!);
  });

  it('finds a polity on the maps by the names Wikidata and Wikipedia give it', () => {
    const names = ['Achaemenid Empire', 'Macedonia', 'Sparta', 'Épire'];
    expect(matchPolity(names, ['Sparta', 'Sparta'])).toBe('Sparta');
    expect(matchPolity(names, ['Macedonia (ancient kingdom)'])).toBe('Macedonia');
    expect(matchPolity(names, ['the Achaemenid empire'])).toBe('Achaemenid Empire');
    expect(matchPolity(names, ['Epire'])).toBe('Épire');
    expect(matchPolity(names, ['Corinth', ''])).toBeUndefined();
  });

  it('reads the maps of a polity’s lifetime: the one in force when it began, then each until it ended', () => {
    // Sparta, 900–192 BCE.
    expect(mapsDuring({ y: -899 }, { y: -191 }).map((b) => b.file)).toEqual([
      'world_bc1000.geojson', 'world_bc700.geojson', 'world_bc500.geojson', 'world_bc400.geojson', 'world_bc323.geojson', 'world_bc300.geojson', 'world_bc200.geojson',
    ]);
    // Still there: every map since, thinned evenly, keeping the first and the last.
    const open = mapsDuring({ y: 300 }, undefined, 5).map((b) => b.y);
    expect(open).toHaveLength(5);
    expect(open[0]).toBe(300);
    expect(open.at(-1)).toBe(2010);
  });

  it('cuts borders to the polity’s own lifespan', () => {
    const snaps = [{ from: { y: -999 }, to: { y: -699 } }, { from: { y: -299 }, to: { y: -199 } }, { from: { y: -199 }, to: { y: -99 } }, { from: { y: -99 } }];
    expect(withinLife(snaps, { y: -899, approx: true }, { y: -191 }).map((s) => [s.from.y, s.to?.y])).toEqual([[-899, -699], [-299, -199], [-199, -191]]);
    expect(withinLife([{ from: { y: 1900 } }], { y: 1800 }).map((s) => [s.from.y, s.to?.y])).toEqual([[1900, undefined]]);
  });
});

describe('GeoJSON files', () => {
  it('finds named areas in a FeatureCollection and skips points', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Athens' }, geometry: square(23, 38, 1) },
        { type: 'Feature', properties: { NAME: ' Sparta ' }, geometry: square(22, 37, 1) },
        { type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [23, 38] } },
      ],
    };
    expect(parseGeoJsonAreas(JSON.stringify(fc)).map((a) => a.name)).toEqual(['Athens', 'Sparta']);
  });

  it('reads a bare geometry or a single Feature', () => {
    expect(parseGeoJsonAreas(JSON.stringify(square(23, 38, 1)))).toEqual([{ name: undefined, geometry: square(23, 38, 1) }]);
    expect(parseGeoJsonAreas(JSON.stringify({ type: 'Feature', properties: { title: 'Thebes' }, geometry: square(23, 38, 1) }))[0].name).toBe('Thebes');
  });

  it('explains files it can’t use', () => {
    expect(() => parseGeoJsonAreas('not json')).toThrow('This file isn’t valid GeoJSON.');
    expect(() => parseGeoJsonAreas(JSON.stringify({ type: 'Point', coordinates: [0, 0] }))).toThrow(/No areas in this file/);
  });

  it('keeps a 1 km island at the fine level that the import level drops', () => {
    const island = square(23.4, 37.7, 0.01);
    expect(simplifyArea(island)).toBeNull();
    expect(simplifyArea(island, FINE.tolerance, FINE.decimals)).toEqual(island);
  });
});
