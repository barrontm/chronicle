import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { labelPoint } from '../data/geo';
import { presenceAt, regionExtent, snapshotAt, valueAt } from '../model/atYear';
import type { Place, Relation, Series, Territory, TerritorySnapshot, TimelineItem } from '../model/types';

/**
 * Turns the doc into GeoJSON for one year of the map. Pure (no MapLibre), so
 * MapView stays a thin renderer and this logic can be unit-tested.
 * Colors are passed in already resolved (CSS variables don't reach WebGL).
 */

type ColorOf = (categoryId: string) => string | undefined;

export interface PinProps { id: string; title: string; color: string; opacity: number; kind: TimelineItem['kind']; selected: boolean }
export interface TerritoryProps { id: string; title: string; color: string; areaKm2?: number }
export interface CircleProps { id: string; title: string; value: number; radius: number; color: string }

const fc = <G extends Feature['geometry'], P>(features: Feature<G, P>[]): FeatureCollection<G, P> => ({ type: 'FeatureCollection', features });

/** Which of an entry's places to draw: a person at their birthplace (or wherever is known), anything else at its sites. */
export function placesToDraw(item: TimelineItem): Place[] {
  const places = item.places ?? [];
  if (!places.length) return [];
  if (item.kind === 'person') {
    const p = places.find((x) => x.role === 'born') ?? places.find((x) => x.role !== 'died') ?? places[0];
    return [p];
  }
  const sites = places.filter((x) => (x.role ?? 'site') === 'site');
  return sites.length ? sites : places.slice(0, 1);
}

export function pinsAt(items: TimelineItem[], year: number, opts: { fadeYears: number; keepPast: boolean; colorOf: ColorOf; selectedId?: string }): FeatureCollection<Point, PinProps> {
  const features: Feature<Point, PinProps>[] = [];
  for (const item of items) {
    const color = opts.colorOf(item.categoryId);
    if (!color || !item.start) continue;
    const opacity = presenceAt(item, year, opts.fadeYears, opts.keepPast);
    if (opacity <= 0) continue;
    for (const pl of placesToDraw(item)) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pl.lon, pl.lat] },
        properties: { id: item.id, title: item.title, color, opacity, kind: item.kind, selected: item.id === opts.selectedId },
      });
    }
  }
  return fc(features);
}

/** Connections between entries that are both on the map right now, drawn as lines. */
export function arcsBetween(relations: Relation[], pins: FeatureCollection<Point, PinProps>): FeatureCollection<LineString, { id: string; color: string; opacity: number }> {
  const byId = new Map<string, Feature<Point, PinProps>>();
  for (const f of pins.features) if (!byId.has(f.properties.id)) byId.set(f.properties.id, f);
  const features: Feature<LineString, { id: string; color: string; opacity: number }>[] = [];
  for (const r of relations) {
    const a = byId.get(r.fromId);
    const b = byId.get(r.toId);
    if (!a || !b) continue;
    const [ax, ay] = a.geometry.coordinates;
    const [bx, by] = b.geometry.coordinates;
    if (ax === bx && ay === by) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[ax, ay], [bx, by]] },
      properties: { id: r.id, color: a.properties.color, opacity: Math.min(a.properties.opacity, b.properties.opacity) },
    });
  }
  return fc(features);
}

export interface TerritoriesAt {
  shapes: FeatureCollection<NonNullable<TerritorySnapshot['geometry']>, TerritoryProps>;
  labels: Array<{ id: string; title: string; lon: number; lat: number }>;
  /** Changes only when a different snapshot becomes current, so the map can skip redrawing. */
  key: string;
}

export function territoriesAt(territories: Territory[], year: number, colorOf: ColorOf): TerritoriesAt {
  const shapes: Feature<NonNullable<TerritorySnapshot['geometry']>, TerritoryProps>[] = [];
  const labels: TerritoriesAt['labels'] = [];
  const keys: string[] = [];
  for (const t of territories) {
    const color = colorOf(t.categoryId);
    const snap = color ? snapshotAt(t, year) : undefined;
    if (!snap?.geometry || !color) continue;
    keys.push(`${t.id}@${t.snapshots.indexOf(snap)}:${color}:${t.title}`);
    shapes.push({ type: 'Feature', geometry: snap.geometry, properties: { id: t.id, title: t.title, color, areaKm2: snap.areaKm2 } });
    labels.push({ id: t.id, title: t.title, ...labelPoint(snap.geometry) });
  }
  return { shapes: fc(shapes), labels, key: keys.join('|') };
}

const isCountryCode = (k: string) => /^[A-Z]{3}$/.test(k);

/** 0…1 position on the color ramp for each country with a value this year. */
export function choroplethAt(series: Series, year: number): { shades: Map<string, number>; values: Map<string, number>; extent: [number, number] | null } {
  const shades = new Map<string, number>();
  const values = new Map<string, number>();
  const regions = series.regions ?? {};
  const extent = regionExtent(regions, isCountryCode);
  if (!extent) return { shades, values, extent };
  const log = series.scale === 'log' && extent[0] > 0;
  const f = log ? Math.log10 : (v: number) => v;
  const [lo, hi] = [f(extent[0]), f(extent[1])];
  for (const [code, pts] of Object.entries(regions)) {
    if (!isCountryCode(code)) continue;
    const v = valueAt(pts, year);
    if (v === undefined || (log && v <= 0)) continue;
    values.set(code, v);
    shades.set(code, hi > lo ? (f(v) - lo) / (hi - lo) : 1);
  }
  return { shades, values, extent };
}

/** Circles on territories sized by a value (area ∝ value), for trends recorded per territory. */
export function territoryCircles(series: Series, territories: TerritoriesAt, year: number, color: string): FeatureCollection<Point, CircleProps> {
  const regions = series.regions ?? {};
  const extent = regionExtent(regions, (k) => !isCountryCode(k));
  const features: Feature<Point, CircleProps>[] = [];
  if (!extent || extent[1] <= 0) return fc(features);
  for (const l of territories.labels) {
    const pts = regions[l.id];
    const v = pts && valueAt(pts, year);
    if (v === undefined || v <= 0) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
      properties: { id: l.id, title: l.title, value: v, radius: 6 + 34 * Math.sqrt(v / extent[1]), color },
    });
  }
  return fc(features);
}

/** Does this trend have anything to put on the map? */
export function mapKindOf(series: Series): 'countries' | 'territories' | 'both' | null {
  const keys = Object.keys(series.regions ?? {});
  const c = keys.some(isCountryCode);
  const t = keys.some((k) => !isCountryCode(k));
  return c && t ? 'both' : c ? 'countries' : t ? 'territories' : null;
}

/** Hex/rgb color mix for the choropleth ramp (MapLibre needs concrete colors). */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const m = pa.map((x, i) => Math.round(x + (pb[i] - x) * t));
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
}

export function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
