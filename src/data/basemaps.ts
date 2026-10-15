import type { Feature, FeatureCollection } from 'geojson';
import { formatYear, toAstronomical } from '../model/dates';
import type { TerritorySnapshot } from '../model/types';
import { areaKm2, isArea, simplifyArea, type Area } from './geo';

/**
 * The historical-basemaps dataset (github.com/aourednik/historical-basemaps,
 * GPL-3.0): one world map of polities per snapshot year. Bob imports the
 * polities he studies into his doc; the full maps are only fetched for the
 * optional reference backdrop and are never saved.
 */
export const BASEMAPS_CREDIT = { name: 'historical-basemaps (A. Ourednik), GPL-3.0', url: 'https://github.com/aourednik/historical-basemaps' };
const RAW = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';

/** Snapshot years as they appear in the file names; negative = BCE (historian's sense). */
const FILE_YEARS = [
  -123000, -10000, -8000, -5000, -4000, -3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1,
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650,
  1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010,
];

export interface BasemapYear {
  /** Astronomical year (500 BCE = -499). */
  y: number;
  file: string;
}

export const BASEMAP_YEARS: BasemapYear[] = FILE_YEARS.map((fy) => ({
  y: fy < 0 ? toAstronomical(-fy, 'BCE') : fy,
  file: fy < 0 ? `world_bc${-fy}.geojson` : `world_${fy}.geojson`,
}));

export function basemapUrl(b: BasemapYear): string {
  return `${RAW}/${b.file}`;
}

/** The latest snapshot at or before `year` (or the earliest one, before the dataset begins). */
export function basemapFor(year: number): BasemapYear {
  let best = BASEMAP_YEARS[0];
  for (const b of BASEMAP_YEARS) if (b.y <= year) best = b;
  return best;
}

export function nextBasemap(b: BasemapYear): BasemapYear | undefined {
  return BASEMAP_YEARS[BASEMAP_YEARS.indexOf(b) + 1];
}

const nameOf = (f: Feature) => (f.properties?.NAME as string | null | undefined)?.trim() || undefined;

/** Polity names in one snapshot, sorted, without blanks or duplicates. */
export function polityNames(fc: FeatureCollection): string[] {
  return [...new Set(fc.features.map(nameOf).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
}

/** All the pieces of one polity in a snapshot merged into a single MultiPolygon. */
export function polityGeometry(fc: FeatureCollection, name: string): Area | null {
  const coords = fc.features
    .filter((f) => nameOf(f) === name && isArea(f.geometry))
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : (f.geometry as Area & { type: 'MultiPolygon' }).coordinates));
  return coords.length ? { type: 'MultiPolygon', coordinates: coords } : null;
}

/**
 * Turn a polity's appearances across loaded snapshots into TerritorySnapshots.
 * Each lasts until the next dataset year (whether or not the polity is in it),
 * which is the best the dataset can say about when borders changed.
 * Geometry is simplified so backups stay small.
 */
export function snapshotsFor(name: string, loaded: Array<{ year: BasemapYear; fc: FeatureCollection }>, tolerance = 0.05): TerritorySnapshot[] {
  return [...loaded]
    .sort((a, b) => a.year.y - b.year.y)
    .flatMap(({ year, fc }) => {
      const raw = polityGeometry(fc, name);
      const geometry = raw && simplifyArea(raw, tolerance);
      if (!geometry) return [];
      const next = nextBasemap(year);
      const snap: TerritorySnapshot = { from: { y: year.y }, geometry, areaKm2: Math.round(areaKm2(geometry)) };
      if (next) snap.to = { y: next.y };
      return [snap];
    });
}

// ---------- Network ----------

const loaded = new Map<string, Promise<FeatureCollection>>();

/**
 * Fetch one snapshot. Kept in memory for the session; the service worker also
 * caches it, so maps seen once still work offline.
 */
export function fetchBasemap(b: BasemapYear): Promise<FeatureCollection> {
  let p = loaded.get(b.file);
  if (!p) {
    p = fetch(basemapUrl(b)).then(async (res) => {
      if (!res.ok) throw new Error(`The historical map for ${formatYear(b.y)} couldn’t be loaded (${res.status}). Try again in a moment.`);
      return (await res.json()) as FeatureCollection;
    });
    // Don't remember failures, so a retry after reconnecting works.
    p.catch(() => loaded.delete(b.file));
    loaded.set(b.file, p);
  }
  return p;
}
