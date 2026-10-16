import type { Place } from './types';

const ROLE_PREFIX: Record<NonNullable<Place['role']>, string> = { site: '', born: 'Born in ', died: 'Died in ' };

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** "37.97°N, 23.72°E": how a place's coordinates read in the app. */
export function formatCoords(p: { lat: number; lon: number }): string {
  return `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;
}

/** "Born in Stagira (40.53°N, 23.75°E)". */
export function placeLabel(pl: Place): string {
  const coords = formatCoords(pl);
  return `${ROLE_PREFIX[pl.role ?? 'site']}${pl.name ? `${pl.name} (${coords})` : coords}`;
}

/** Coordinates as Bob types them back in: "37.9715, 23.7257". */
export function coordsText(p: { lat: number; lon: number }): string {
  return `${round4(p.lat)}, ${round4(p.lon)}`;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
/** One axis with a hemisphere letter: 37.97° N, 37°58′N, 37°58′12″N. */
const DMS = new RegExp(String.raw`${NUM}\s*°?\s*(?:${NUM}\s*'\s*)?(?:${NUM}\s*"\s*)?([NSEW])\b`, 'gi');
/** Two signed decimals: "37.97, 23.72", "-33.9 18.4". Latitude first. */
const DECIMAL = new RegExp(String.raw`^([+-]?\d+(?:\.\d+)?)\s*°?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?$`);

/**
 * Reads coordinates the way Wikipedia and atlases print them, latitude first:
 * "37.97, 23.72", "37.97° N, 23.72° E" or "37°58′N 23°43′E". Undefined if it can't.
 */
export function parseCoords(text: string): { lat: number; lon: number } | undefined {
  const t = text.trim().replace(/[′’‘`]/g, "'").replace(/[″“”]/g, '"').replace(/''/g, '"').replace(/º/g, '°');
  if (!t) return undefined;
  let lat: number | undefined;
  let lon: number | undefined;
  const axes = [...t.matchAll(DMS)];
  if (axes.length === 2) {
    for (const [, d, m, s, hemi] of axes) {
      if ((m && Number(m) >= 60) || (s && Number(s) >= 60)) return undefined;
      const h = hemi.toUpperCase();
      const v = (Number(d) + Number(m ?? 0) / 60 + Number(s ?? 0) / 3600) * (h === 'S' || h === 'W' ? -1 : 1);
      if (h === 'N' || h === 'S') lat = v;
      else lon = v;
    }
  } else {
    const m = t.match(DECIMAL);
    if (m) [lat, lon] = [Number(m[1]), Number(m[2])];
  }
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat: round4(lat), lon: round4(lon) };
}
