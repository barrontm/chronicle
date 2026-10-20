import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import { bbox, labelPoint } from '../data/geo';
import { presenceAt, regionExtent, snapshotAt, valueAt } from '../model/atYear';
import { formatYear, toDecimalYear } from '../model/dates';
import type { Flow, FlowCause, FlowEnd, FlowRoute, Lane, Place, Relation, Series, SeriesPoint, Territory, TerritorySnapshot, TimelineItem } from '../model/types';

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

/** An AI-drafted entry waiting for review: drawn at every place, whatever the year, so Bob sees the whole draft. */
export interface DraftPin { id: string; title: string; color: string; lon: number; lat: number }

export function draftPins(items: TimelineItem[], colorOf: ColorOf): { pins: DraftPin[]; bounds: [number, number, number, number] | null } {
  const pins = items.flatMap((item) => placesToDraw(item).map((p, i) => ({
    id: `${item.id}#${i}`, title: item.title, color: colorOf(item.categoryId) ?? '#666', lon: p.lon, lat: p.lat,
  })));
  if (!pins.length) return { pins, bounds: null };
  const lons = pins.map((p) => p.lon);
  const lats = pins.map((p) => p.lat);
  return { pins, bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] };
}

export function pinsAt(items: TimelineItem[], year: number, opts: { fadeYears: number; keepPast: boolean; colorOf: ColorOf; selectedId?: string }): FeatureCollection<Point, PinProps> {
  const features: Feature<Point, PinProps>[] = [];
  for (const item of items) {
    const color = opts.colorOf(item.categoryId);
    // A place without dates is on the map in every year; anything else needs its start (presenceAt says).
    if (!color) continue;
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

// ---------- Migration flows ----------

/** Causes in the order the legend and the editor list them. Colors are pigments, resolved by MapView. */
export const CAUSES: Array<{ id: FlowCause; label: string; color: string }> = [
  { id: 'conflict', label: 'Conflict & persecution', color: 'var(--pig-cinnabar)' },
  { id: 'economic', label: 'Work & economy', color: 'var(--pig-ochre)' },
  { id: 'disaster', label: 'Famine & disaster', color: 'var(--pig-umber)' },
  { id: 'forced', label: 'Forced (slavery, deportation)', color: 'var(--pig-indigo)' },
  { id: 'settlement', label: 'Colonization & settlement', color: 'var(--pig-verdigris)' },
  { id: 'family', label: 'Family & other', color: 'var(--pig-lapis)' },
  { id: 'unknown', label: 'Unknown', color: 'var(--muted)' },
];
export const causeOf = (id: FlowCause) => CAUSES.find((c) => c.id === id) ?? CAUSES[CAUSES.length - 1];

/** Where route ends are: present-day countries come from the bundled basemap. */
export interface FlowPlaces {
  countries: Map<string, { name: string; lon: number; lat: number }>;
  territories: Territory[];
  year: number;
}

/** Whole years count, as for entries: points 1846…1855 cover all of 1855. Nothing is drawn outside them. */
export function rateAt(points: SeriesPoint[], year: number): number | undefined {
  if (!points.length) return undefined;
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (year < Math.floor(lo) || year >= Math.floor(hi) + 1) return undefined;
  return valueAt(points, Math.min(hi, Math.max(lo, year)));
}

export interface ActiveRoute { flow: Flow; index: number; route: FlowRoute; value: number }

/** Routes with people on them in `year`, for flows that pass `show` (visible category, cause not filtered out). */
export function activeRoutes(flows: Flow[], year: number, show: (f: Flow) => boolean): ActiveRoute[] {
  const out: ActiveRoute[] = [];
  for (const flow of flows) {
    if (!show(flow)) continue;
    flow.routes.forEach((route, index) => {
      const value = rateAt(route.points, year);
      if (value !== undefined && value > 0) out.push({ flow, index, route, value });
    });
  }
  return out;
}

/** The largest value ever recorded, per measure, so widths stay comparable as the year plays. Flows and stocks never share a scale. */
export function flowScale(flows: Flow[]): Record<Flow['measure'], number> {
  const max = { moved: 0, living: 0 };
  for (const f of flows) for (const r of f.routes) for (const p of r.points) if (p.v > max[f.measure]) max[f.measure] = p.v;
  return max;
}

export function endPlace(end: FlowEnd, places: FlowPlaces): { name: string; lon: number; lat: number } | undefined {
  if ('country' in end) return places.countries.get(end.country);
  if ('territoryId' in end) {
    const t = places.territories.find((x) => x.id === end.territoryId);
    if (!t) return undefined;
    const geometry = snapshotAt(t, places.year)?.geometry ?? [...t.snapshots].reverse().find((s) => s.geometry)?.geometry;
    return geometry ? { name: t.title, ...labelPoint(geometry) } : undefined;
  }
  return end;
}

/** "about 130,000", "about 1.3 million": estimates, so two significant figures. */
export function aboutPeople(v: number): string {
  if (v >= 1e6) return `about ${Number((v / 1e6).toPrecision(2))} million`;
  const digits = Math.max(0, Math.floor(Math.log10(Math.max(v, 1))) - 1);
  const r = Math.round(v / 10 ** digits) * 10 ** digits;
  return `about ${r.toLocaleString('en')}`;
}

export function routeYears(points: SeriesPoint[]): string {
  if (!points.length) return '';
  const xs = points.map((p) => Math.floor(p.x));
  const [a, b] = [Math.min(...xs), Math.max(...xs)];
  return a === b ? formatYear(a) : `${formatYear(a)}–${formatYear(b)}`;
}

/** "Ireland → United States · famine & disaster · about 130,000 a year (1846–1855)" */
export function describeRoute(r: ActiveRoute, from: string, to: string): string {
  const cause = causeOf(r.flow.cause).label;
  const amount = r.flow.measure === 'moved' ? `${aboutPeople(r.value)} a year` : `${aboutPeople(r.value)} living there`;
  return `${from} → ${to} · ${cause[0].toLowerCase()}${cause.slice(1)} · ${amount} (${routeYears(r.route.points)})`;
}

const RAD = Math.PI / 180;
const toVec = ([lon, lat]: Position) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];

/**
 * A curved route from a to b: the great circle, bowed a little to the right
 * of the direction of travel so that A → B and B → A don't sit on top of each
 * other. Longitudes are unwrapped, so routes across the Pacific stay continuous.
 */
export function arcPoints(a: Position, b: Position, n = 48): Position[] {
  const [va, vb] = [toVec(a), toVec(b)];
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const pts: Position[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let lon: number;
    let lat: number;
    if (omega < 1e-9) [lon, lat] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    else {
      const [ka, kb] = [Math.sin((1 - t) * omega) / Math.sin(omega), Math.sin(t * omega) / Math.sin(omega)];
      const v = [0, 1, 2].map((k) => ka * va[k] + kb * vb[k]);
      lon = Math.atan2(v[1], v[0]) / RAD;
      lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD;
    }
    const prev = pts[i - 1];
    if (prev) while (lon - prev[0] > 180) lon -= 360;
    if (prev) while (prev[0] - lon > 180) lon += 360;
    pts.push([lon, lat]);
  }
  const [dx, dy] = [pts[n][0] - pts[0][0], pts[n][1] - pts[0][1]];
  const len = Math.hypot(dx, dy);
  if (len === 0) return pts;
  const bow = 0.12 * len;
  return pts.map(([lon, lat], i) => {
    const s = Math.sin(Math.PI * (i / n)) * bow;
    return [round4(lon + (dy / len) * s), round4(Math.max(-85, Math.min(85, lat - (dx / len) * s)))];
  });
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / RAD;

/** Compass bearing (degrees clockwise from north, as the map shows it) of the last step of a line. */
export function endBearing(line: Position[]): number {
  const [p, q] = [line[line.length - 2], line[line.length - 1]];
  return Math.atan2(q[0] - p[0], mercY(q[1]) - mercY(p[1])) / RAD;
}

export interface FlowLineProps {
  id: string;
  label: string;
  color: string;
  width: number;
  /** People moving per year get moving dashes; people living abroad a still arrow. */
  moving: boolean;
  /** Fraction of the route a dash travels per second. */
  speed: number;
}

export function flowFeatures(active: ActiveRoute[], places: FlowPlaces, scale: Record<Flow['measure'], number>, colorOf: (c: FlowCause) => string) {
  const lines: Feature<LineString, FlowLineProps>[] = [];
  const heads: Feature<Point, { id: string; color: string; bearing: number; size: number }>[] = [];
  for (const r of active) {
    const a = endPlace(r.route.from, places);
    const b = endPlace(r.route.to, places);
    if (!a || !b || (a.lon === b.lon && a.lat === b.lat)) continue;
    const coords = arcPoints([a.lon, a.lat], [b.lon, b.lat]);
    const share = scale[r.flow.measure] > 0 ? r.value / scale[r.flow.measure] : 1;
    const color = colorOf(r.flow.cause);
    const width = 1.5 + 10 * share;
    const id = `${r.flow.id}#${r.index}`;
    lines.push({
      type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
      properties: { id, label: describeRoute(r, a.name, b.name), color, width, moving: r.flow.measure === 'moved', speed: 0.06 + 0.24 * Math.sqrt(share) },
    });
    heads.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords[coords.length - 1] }, properties: { id, color, bearing: endBearing(coords), size: 0.5 + width / 12 } });
  }
  return { lines: fc(lines), heads: fc(heads) };
}

/**
 * The moving dashes on people-per-year routes at `seconds` into the animation:
 * evenly spaced along each route, travelling from origin to destination at the
 * route's speed, so bigger flows visibly move faster.
 */
export function flowDashes(lines: FeatureCollection<LineString, FlowLineProps>, seconds: number): FeatureCollection<LineString, { color: string; width: number }> {
  const out: Feature<LineString, { color: string; width: number }>[] = [];
  for (const f of lines.features) {
    if (!f.properties.moving) continue;
    const c = f.geometry.coordinates;
    const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], mercY(c[i][1]) - mercY(c[i - 1][1])));
    const total = cum[cum.length - 1];
    if (total === 0) continue;
    const count = Math.max(3, Math.min(24, Math.round(total / 4)));
    const phase = (seconds * f.properties.speed) % 1;
    const at = (frac: number): Position => {
      const d = frac * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
    };
    for (let k = 0; k < count; k++) {
      const start = (k / count + phase) % 1;
      const end = Math.min(1, start + 0.35 / count);
      if (end - start < 0.002) continue;
      out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [at(start), at((start + end) / 2), at(end)] }, properties: { color: f.properties.color, width: f.properties.width } });
    }
  }
  return fc(out);
}

// ---------- Following the timeline (Phase 4: the overview) ----------

/** How a polity dealt with another in a year: through a war or battle, an alliance, a treaty, trade, or a plain connection. */
export type ContactHow = 'war' | 'allied' | 'trade' | 'peace';
export interface Contact { territoryId: string; how: ContactHow; via: string[] }

export const CONTACT_LABEL: Record<ContactHow, string> = { war: 'at war', allied: 'allied', trade: 'trade', peace: 'at peace' };
export const CONTACT_COLOR: Record<ContactHow, string> = { war: 'var(--pig-cinnabar)', allied: 'var(--pig-lapis)', trade: 'var(--pig-ochre)', peace: 'var(--pig-umber)' };
/** Strongest first: two polities at war in a year that also traded are at war. */
const CONTACT_RANK: Record<ContactHow, number> = { war: 3, allied: 2, trade: 1, peace: 0 };

export interface ContactDoc {
  items: readonly TimelineItem[];
  territories: readonly Territory[];
  relations: readonly Relation[];
  flows?: readonly Flow[];
}

/** Whole years an entry covers, its end year included (a battle in 431 BCE covers all of it). */
function yearsOf(it: TimelineItem): [number, number] | undefined {
  if (!it.start) return undefined;
  const s = toDecimalYear(it.start);
  const e = it.end ? toDecimalYear(it.end) : s;
  return [Math.floor(Math.min(s, e)), Math.floor(Math.max(s, e))];
}

/** A war or a battle: what it is, else Bob's War lane. */
const isWar = (it: TimelineItem) => it.subject === 'war' || it.subject === 'battle' || (!it.subject && !!it.lanes?.includes('war'));

/**
 * The polities `polityId` (a territory) dealt with between two years, each once, strongest contact first.
 * A war, battle, alliance or treaty in those years connected to both says how, from their sides
 * (decision "v9 holds"): opposite sides of a war or battle are at war and the same side allied;
 * opposite sides of anything else are at peace, otherwise allied. A polity's entry stands for it.
 * A migration route for work and the economy between them is trade, and a connection between the
 * two territories themselves is at peace. A polity's own entry is dated: it took part in it.
 */
export function contactsDuring(polityId: string, from: number, to: number, doc: ContactDoc): Contact[] {
  const byItem = new Map<string, string>();
  for (const t of doc.territories) if (t.itemId) byItem.set(t.itemId, t.id);
  const terrIds = new Set(doc.territories.map((t) => t.id));
  const polityOf = (id: string) => (terrIds.has(id) ? id : byItem.get(id));
  const items = new Map(doc.items.map((i) => [i.id, i]));

  // Each entry's polities and their sides, from its connections.
  const sides = new Map<string, Map<string, 1 | 2 | undefined>>();
  const direct: string[][] = [];
  const take = (entry: string, pol: string, side?: 1 | 2) => {
    const m = sides.get(entry) ?? sides.set(entry, new Map()).get(entry)!;
    if (!m.has(pol) || side) m.set(pol, side);
  };
  for (const r of doc.relations) {
    if (r.type === 'part-of') continue;
    // Two territories connected directly; else a polity and an entry, which is dated even when it's
    // another polity's own entry (the Delian League founded: Athens and the League took part in it).
    if (terrIds.has(r.fromId) && terrIds.has(r.toId)) { if (r.fromId !== r.toId) direct.push([r.fromId, r.toId, r.id]); continue; }
    const a = polityOf(r.fromId), b = polityOf(r.toId);
    if (a && (!b || terrIds.has(r.fromId))) { take(r.toId, a, r.side); if (b) take(r.toId, b); }
    else if (b) { take(r.fromId, b, r.side); if (a) take(r.fromId, a); }
  }

  const best = new Map<string, Contact>();
  const add = (tid: string, how: ContactHow, via: string) => {
    if (tid === polityId) return;
    const c = best.get(tid);
    if (!c || CONTACT_RANK[how] > CONTACT_RANK[c.how]) best.set(tid, { territoryId: tid, how, via: [via] });
    else if (c.how === how && !c.via.includes(via)) c.via.push(via);
  };
  for (const [entry, m] of sides) {
    if (!m.has(polityId)) continue;
    const it = items.get(entry);
    const ys = it && yearsOf(it);
    if (!ys || ys[0] > to || ys[1] < from) continue;
    const mine = m.get(polityId);
    const war = isWar(it);
    for (const [other, side] of m) {
      if (other === polityId) continue;
      const same = !!mine && !!side && mine === side, opposite = !!mine && !!side && mine !== side;
      add(other, war ? (same ? 'allied' : 'war') : opposite ? 'peace' : 'allied', entry);
    }
  }
  for (const f of doc.flows ?? []) {
    if (f.cause !== 'economic') continue;
    for (const r of f.routes) {
      const a = 'territoryId' in r.from ? r.from.territoryId : undefined, b = 'territoryId' in r.to ? r.to.territoryId : undefined;
      const other = a === polityId ? b : b === polityId ? a : undefined;
      if (!other) continue;
      const xs = r.points.map((p) => Math.floor(p.x));
      if (xs.length && Math.min(...xs) <= to && Math.max(...xs) >= from) add(other, 'trade', f.id);
    }
  }
  for (const [a, b, id] of direct) {
    if (a === polityId) add(b, 'peace', id);
    else if (b === polityId) add(a, 'peace', id);
  }
  const title = new Map(doc.territories.map((t) => [t.id, t.title]));
  return [...best.values()].sort((x, y) => CONTACT_RANK[y.how] - CONTACT_RANK[x.how] || (title.get(x.territoryId) ?? '').localeCompare(title.get(y.territoryId) ?? ''));
}

/** The polities `polityId` dealt with in `year`, and how (`contactsDuring` for one year). */
export function contactsAt(polityId: string, year: number, doc: ContactDoc): Contact[] {
  const y = Math.floor(year);
  return contactsDuring(polityId, y, y, doc);
}

/** What the timeline has picked or open, which the map follows. */
export interface TimelineFocus {
  /** The strip or world event picked on the overview: `pol:<territory>`, or the world event's id. */
  pick?: string;
  /** Opened into its six lanes (level 1). */
  open?: boolean;
  /** The lane opened to all its entries, and what's in it. */
  lane?: Lane;
  laneIds?: string[];
}

export interface FollowProps { id: string; color: string; fill: number; width: number; dashed: boolean }
export interface FollowPinProps { id: string; title: string; color: string; opacity: number }
export interface FollowAt {
  shapes: FeatureCollection<NonNullable<TerritorySnapshot['geometry']>, FollowProps>;
  pins: FeatureCollection<Point, FollowPinProps>;
  /** Territory labels to mark: the picked one, and the others with how they dealt with it ("at war"). */
  marks: Map<string, { how: ContactHow | 'picked' | 'gold'; text?: string }>;
  /** Where to fit the map for the pick, and for the region; each refits only when its key changes. */
  pickFit?: { key: string; bounds: [number, number, number, number] };
  regionFit?: { key: string; bounds: [number, number, number, number] };
}

export interface FollowInput extends ContactDoc {
  focus: TimelineFocus;
  /** The region Bob clicked on the map, if any. */
  region?: string;
  year: number;
  /** The years in view on the timeline. */
  window: { start: number; end: number };
  /** What's in a world event (`worldMembers`). */
  worldMembers?: (id: string) => string[];
}

/** A territory's borders in a year, else its nearest snapshot's (a polity with borders only later still has a place). */
function shapeOf(t: Territory, year: number) {
  const now = snapshotAt(t, year)?.geometry;
  if (now) return now;
  const shaped = t.snapshots.filter((s) => s.geometry);
  return shaped.sort((a, b) => Math.abs(toDecimalYear(a.from) - year) - Math.abs(toDecimalYear(b.from) - year))[0]?.geometry;
}

function union(boxes: [number, number, number, number][]): [number, number, number, number] | undefined {
  if (!boxes.length) return undefined;
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}

const LANE_PIGMENT: Record<Lane, string> = { politics: 'lapis', war: 'cinnabar', economy: 'ochre', ideas: 'indigo', technology: 'verdigris', nature: 'terre' };

/**
 * The map's half of the overview (docs/design.md, "The map follows"). A picked polity is drawn in
 * ink and the polities it dealt with in the year in their contact's colour, named with how; the map
 * fits it and those it fought or allied with (never a far trade partner). An alliance that is part of
 * it (the Delian League) is its reach, dashed lapis. An open lane shows its layer: War everyone it
 * fought in the years in view; Politics its borders before, dashed; the others their entries' pins
 * in view, stronger near the year. A picked world event shows the polities it touched in gold and
 * its entries' pins. A region Bob clicked is fitted.
 */
export function followAt(o: FollowInput): FollowAt {
  const shapes: Feature<NonNullable<TerritorySnapshot['geometry']>, FollowProps>[] = [];
  const pins: Feature<Point, FollowPinProps>[] = [];
  const marks: FollowAt['marks'] = new Map();
  const out: FollowAt = { shapes: fc(shapes), pins: fc(pins), marks };
  const byId = new Map(o.territories.map((t) => [t.id, t]));
  const items = new Map(o.items.map((i) => [i.id, i]));
  const shape = (t: Territory, color: string, fill: number, width: number, dashed = false, geometry = shapeOf(t, o.year)) => {
    if (geometry) shapes.push({ type: 'Feature', geometry, properties: { id: t.id, color, fill, width, dashed } });
    return geometry;
  };
  const pinAll = (ids: Iterable<string>, color: string, opacityOf: (it: TimelineItem) => number) => {
    for (const id of ids) {
      const it = items.get(id);
      if (!it) continue;
      const opacity = opacityOf(it);
      if (opacity <= 0) continue;
      for (const p of placesToDraw(it)) pins.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: it.id, title: it.title, color, opacity } });
    }
  };

  if (o.region) {
    const boxes = o.territories.filter((t) => t.region === o.region).flatMap((t) => { const g = shapeOf(t, o.year); return g ? [bbox(g)] : []; });
    const b = union(boxes);
    if (b) out.regionFit = { key: o.region, bounds: b };
  }

  const pick = o.focus.pick;
  if (!pick) return out;
  const lane = o.focus.open ? o.focus.lane : undefined;
  const span = Math.max(1, o.window.end - o.window.start);
  // In view, and stronger the nearer the year.
  const nearYear = (it: TimelineItem) => {
    const ys = yearsOf(it);
    if (!ys || ys[1] < o.window.start || ys[0] > o.window.end) return 0;
    const d = o.year < ys[0] ? ys[0] - o.year : o.year > ys[1] + 1 ? o.year - ys[1] - 1 : 0;
    return 0.3 + 0.7 * Math.max(0, 1 - d / (span / 2));
  };

  if (!pick.startsWith('pol:')) {
    // A world event: the polities it touched in gold, and its entries pinned.
    const ids = new Set([pick, ...(o.worldMembers?.(pick) ?? [])]);
    const touched = new Set<string>();
    for (const t of o.territories) if (t.itemId && ids.has(t.itemId)) touched.add(t.id);
    for (const r of o.relations) {
      if (r.type === 'part-of') continue;
      if (byId.has(r.fromId) && ids.has(r.toId)) touched.add(r.fromId);
      if (byId.has(r.toId) && ids.has(r.fromId)) touched.add(r.toId);
    }
    const boxes: [number, number, number, number][] = [];
    for (const id of touched) {
      const g = shape(byId.get(id)!, 'var(--gold)', 0.3, 2);
      if (g) boxes.push(bbox(g));
      marks.set(id, { how: 'gold' });
    }
    pinAll(lane && o.focus.laneIds ? o.focus.laneIds : ids, lane ? `var(--pig-${LANE_PIGMENT[lane]})` : 'var(--gold-ink)', nearYear);
    for (const p of pins) boxes.push([...p.geometry.coordinates, ...p.geometry.coordinates] as [number, number, number, number]);
    const b = union(boxes);
    if (b) out.pickFit = { key: pick, bounds: b };
    return out;
  }

  const tid = pick.slice(4);
  const me = byId.get(tid);
  if (!me) return out;
  const boxes: [number, number, number, number][] = [];
  // Its reach: territories that are part of it (an alliance it led).
  const reach = o.relations.filter((r) => r.type === 'part-of' && byId.has(r.fromId) && (r.toId === tid || (!!me.itemId && r.toId === me.itemId))).map((r) => byId.get(r.fromId)!);
  for (const t of reach) if (snapshotAt(t, o.year)?.geometry) shape(t, 'var(--pig-lapis)', 0.08, 1.8, true);

  const contacts = lane === 'war'
    ? contactsDuring(tid, Math.floor(o.window.start), Math.floor(o.window.end), o).filter((c) => c.how === 'war')
    : contactsAt(tid, o.year, o);
  for (const c of contacts) {
    const t = byId.get(c.territoryId);
    if (!t || reach.includes(t)) continue;
    const g = shape(t, CONTACT_COLOR[c.how], c.how === 'war' && lane === 'war' ? 0.32 : 0.2, 2);
    if (g && (c.how === 'war' || c.how === 'allied')) boxes.push(bbox(g));
    marks.set(t.id, { how: c.how, text: lane === 'war' ? 'fought' : CONTACT_LABEL[c.how] });
  }
  const mine = shape(me, 'var(--ink)', 0.1, 2.6);
  if (mine) boxes.push(bbox(mine));
  marks.set(me.id, { how: 'picked' });

  if (lane === 'politics') {
    // Its borders before the ones in effect, dashed.
    const now = snapshotAt(me, o.year);
    const earlier = me.snapshots.filter((s) => s !== now && s.geometry && toDecimalYear(s.from) < (now ? toDecimalYear(now.from) : o.year));
    const prev = earlier.sort((a, b) => toDecimalYear(b.from) - toDecimalYear(a.from))[0];
    if (prev?.geometry) shape(me, 'var(--ink-2)', 0, 1.6, true, prev.geometry);
  } else if (lane && lane !== 'war') {
    pinAll(o.focus.laneIds ?? [], `var(--pig-${LANE_PIGMENT[lane]})`, nearYear);
  }
  const b = union(boxes);
  // Opening a lane refits: War takes in everyone it fought.
  if (b) out.pickFit = { key: `${pick}|${lane ?? ''}`, bounds: b };
  return out;
}
