import type { FeatureCollection } from 'geojson';
import { isArea, labelPoint } from './geo';

/** A present-day country from the bundled basemap, with a point to draw routes to. */
export interface CountryPlace { code: string; name: string; lon: number; lat: number }

/** Countries in the bundled Natural Earth file (properties iso3 and name), sorted by name. */
export function parseCountries(fc: FeatureCollection): CountryPlace[] {
  const byCode = new Map<string, CountryPlace>();
  for (const f of fc.features) {
    const code = String(f.properties?.iso3 ?? '');
    if (!/^[A-Z]{3}$/.test(code) || byCode.has(code) || !isArea(f.geometry)) continue;
    byCode.set(code, { code, name: String(f.properties?.name ?? code), ...labelPoint(f.geometry) });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let file: Promise<FeatureCollection> | null = null;

/** The bundled countries file (precached, so this works offline). Fetched once. */
export function loadCountriesFile(): Promise<FeatureCollection> {
  file ??= fetch(`${import.meta.env.BASE_URL}geo/countries.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn’t load the list of countries (${r.status}).`);
      return r.json() as Promise<FeatureCollection>;
    })
    .catch((e: unknown) => {
      file = null;
      throw e;
    });
  return file;
}

let loading: Promise<CountryPlace[]> | null = null;

/** The bundled countries as places, loaded once. */
export function loadCountries(): Promise<CountryPlace[]> {
  loading ??= loadCountriesFile().then(parseCountries).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}
