import type { MultiPolygon, Polygon } from 'geojson';
import { formatRange, toDecimalYear } from './dates';
import { withBobsOrder } from './bandOrder';
import { ELSEWHERE, isEra } from './eras';
import type { DatedItem, HistDate, Highlight, PolityGroup, Region, Relation, Territory } from './types';

/**
 * What the overview (the timeline's level 0) draws, decided from Bob's doc (docs/design.md,
 * Overview): a band per region in the automatic order, its polities as strips, groups of
 * city-states that fold into one, world events with the regions they touched, and the entries
 * Bob shows at the top.
 */

export interface OPolity {
  /** The territory's id. */
  id: string;
  /** Its timeline entry, if it has one. */
  itemId?: string;
  /** Its name, without a trailing "(…)" Bob added to tell it apart: the strip is short of room. */
  title: string;
  fullTitle: string;
  region: string;
  /** Its life in decimal years: from the earliest of its entry, borders and strength points to the latest. */
  s: number;
  e: number;
  approx: boolean;
  endApprox: boolean;
  when: string;
  /** The group it folds into, if any. */
  group?: string;
  t: Territory;
}

export interface OGroup { id: string; title: string; region: string; members: string[]; s: number; e: number }

export interface ORegion {
  /** Bob's region, or '' for "Elsewhere". */
  name: string;
  label: string;
  /** Its parent (Bob's word, such as "Mediterranean"), if it has one. */
  parent?: string;
  /** Which of the parents it's under, in order, for the strips' tone. */
  tone: number;
}

export interface OWorld {
  /** The world event's entry. */
  id: string;
  /** The region it's named in: Bob's region for a period, else the one most of its polities are in. */
  home: string;
  /** Every region it touched, its home among them. */
  touches: string[];
}

export interface Overview {
  /** The bands in order: the automatic one, with those Bob moved at their places. */
  regions: ORegion[];
  /** The automatic order of the bands' names, for saving where Bob moves one. */
  auto: string[];
  polities: OPolity[];
  groups: OGroup[];
  /** World events placed in their regions. */
  worlds: OWorld[];
  /** The top row: entries Bob shows in the overview, and world events no polity places, most prominent first. */
  top: string[];
}

export interface OverviewInput {
  /** Entries in the categories shown, with dates. */
  items: DatedItem[];
  /** Territories in the categories shown. */
  territories: Territory[];
  relations: Relation[];
  highlights: Highlight[];
  groups?: PolityGroup[];
  /** Bob's regions (v10), for their larger areas and the places of the bands he moved. */
  regions?: readonly Region[];
  prominence: (id: string) => number;
  /** Today, as a decimal year: where a polity still there stops. */
  now: number;
}

/** "Athens (Attica)" → "Athens". */
const short = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s;
const exact = (d: HistDate): HistDate => ({ ...d, approx: undefined });

/** A polity's region: its own, else its entry's, else Elsewhere (''). */
export const polityRegion = (t: Pick<Territory, 'region'>, item?: Pick<DatedItem, 'region'>) => t.region?.trim() || item?.region?.trim() || ELSEWHERE;

/** A polity's life: from its entry, its borders and Bob's strength points; still there if its last borders have no end and its entry none. */
export function polityLife(t: Territory, item: DatedItem | undefined, now: number): Pick<OPolity, 's' | 'e' | 'approx' | 'endApprox' | 'when'> | undefined {
  const starts: HistDate[] = [...t.snapshots.map((s) => s.from), ...(t.strength ?? []).map((p) => p.at), ...(item ? [item.start] : [])];
  if (!starts.length) return undefined;
  const ends: HistDate[] = [...t.snapshots.map((s) => s.to ?? s.from), ...(t.strength ?? []).map((p) => p.at), ...(item ? [item.end ?? item.start] : [])];
  const first = starts.reduce((a, b) => (toDecimalYear(b) < toDecimalYear(a) ? b : a));
  const last = ends.reduce((a, b) => (toDecimalYear(b) > toDecimalYear(a) ? b : a));
  const latest = [...t.snapshots].sort((a, b) => toDecimalYear(b.from) - toDecimalYear(a.from))[0];
  const s = toDecimalYear(first);
  if (!item?.end && latest && !latest.to) return { s, e: Math.max(now, s), approx: !!first.approx, endApprox: false, when: `Since ${formatRange(exact(first))}` };
  return { s, e: Math.max(toDecimalYear(last), s), approx: !!first.approx, endApprox: !!last.approx, when: formatRange(exact(first), exact(last)) };
}

type Centre = [number, number];

/** The middle of a territory's biggest borders (its box's centre), for ordering regions on the map. */
function centreOf(t: Territory): Centre | undefined {
  const withShape = t.snapshots.filter((s) => s.geometry);
  if (!withShape.length) return undefined;
  const big = withShape.reduce((a, b) => ((b.areaKm2 ?? 0) > (a.areaKm2 ?? 0) ? b : a));
  const g = big.geometry as Polygon | MultiPolygon;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p[0] ?? []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x0 <= x1 ? [(x0 + x1) / 2, (y0 + y1) / 2] : undefined;
}

/** Degrees between two centres, with longitude shrunk by latitude. */
const dist = ([x1, y1]: Centre, [x2, y2]: Centre) => Math.hypot((x1 - x2) * Math.cos((((y1 + y2) / 2) * Math.PI) / 180), y1 - y2);

/** Held–Karp is exact up to this many regions under one parent; past it the path is greedy, west to east. */
const EXACT_MAX = 9;

/**
 * The automatic order (A, docs/design.md): parents west to east; inside a parent, the path
 * through its regions that keeps neighbours together; then, where two parents meet, the ends
 * that are most connected. Regions with no borders anywhere go at the end of their parent;
 * "Elsewhere" goes last.
 */
export function orderRegions(names: string[], centre: ReadonlyMap<string, Centre>, parentOf: (r: string) => string | undefined, link: (a: string, b: string) => number): string[] {
  const keyOf = (r: string) => parentOf(r) ?? `\u0000${r}`;
  const byParent = new Map<string, string[]>();
  for (const r of names) if (r !== ELSEWHERE) byParent.set(keyOf(r), [...(byParent.get(keyOf(r)) ?? []), r]);
  const lonOf = (ids: string[]) => { const cs = ids.flatMap((r) => (centre.has(r) ? [centre.get(r)![0]] : [])); return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : Infinity; };
  const parents = [...byParent.entries()].map(([key, ids]) => ({ key, ids, lon: lonOf(ids) }))
    .sort((a, b) => a.lon - b.lon || a.key.localeCompare(b.key));
  const sim = (a: string, b: string) => 20 * Math.exp(-dist(centre.get(a)!, centre.get(b)!) / 15) + 0.01 * link(a, b);

  // Each parent's best paths through its mapped regions (any near the best, so the seams can choose).
  const paths = parents.map(({ ids }) => {
    const mapped = ids.filter((r) => centre.has(r)).sort((a, b) => centre.get(a)![0] - centre.get(b)![0] || a.localeCompare(b));
    const rest = ids.filter((r) => !centre.has(r)).sort((a, b) => a.localeCompare(b));
    const n = mapped.length;
    if (n <= 1) return [{ v: 0, path: [...mapped, ...rest] }];
    let found: { v: number; path: string[] }[];
    if (n <= EXACT_MAX) {
      // dp[mask][last]: the best path through `mask` ending at `last`, per start.
      found = [];
      for (let s0 = 0; s0 < n; s0++) {
        const v = new Float64Array((1 << n) * n).fill(-Infinity);
        const prev = new Int8Array((1 << n) * n).fill(-1);
        v[(1 << s0) * n + s0] = 0;
        for (let mask = 0; mask < 1 << n; mask++) for (let last = 0; last < n; last++) {
          const cur = v[mask * n + last];
          if (cur === -Infinity) continue;
          for (let nx = 0; nx < n; nx++) {
            if (mask & (1 << nx)) continue;
            const k = (mask | (1 << nx)) * n + nx, w = cur + sim(mapped[last], mapped[nx]);
            if (w > v[k]) { v[k] = w; prev[k] = last; }
          }
        }
        const full = (1 << n) - 1;
        for (let e0 = 0; e0 < n; e0++) {
          if (e0 === s0 || v[full * n + e0] === -Infinity) continue;
          const path: number[] = [];
          for (let mask = full, at = e0; at >= 0;) { path.push(at); const p = prev[mask * n + at]; mask &= ~(1 << at); at = p; }
          found.push({ v: v[full * n + e0], path: path.reverse().map((i) => mapped[i]) });
        }
      }
    } else {
      const path = [mapped[0]], left = new Set(mapped.slice(1));
      let v = 0;
      while (left.size) {
        const at = path[path.length - 1];
        const nx = [...left].reduce((a, b) => (sim(at, b) > sim(at, a) ? b : a));
        v += sim(at, nx);
        path.push(nx);
        left.delete(nx);
      }
      found = [{ v, path }];
    }
    const top = Math.max(...found.map((f) => f.v));
    return found.filter((f) => f.v >= top * 0.97).map((f) => ({ v: f.v, path: [...f.path, ...rest] }));
  });
  // Where parents meet, the most connected ends sit side by side.
  let layer = paths[0]?.map((p) => ({ v: p.v, order: p.path })) ?? [];
  for (let k = 1; k < paths.length; k++) {
    layer = paths[k].map((p) => {
      let best: { v: number; order: string[] } | undefined;
      for (const q of layer) {
        const v = q.v + link(q.order[q.order.length - 1], p.path[0]) + p.v;
        if (!best || v > best.v) best = { v, order: [...q.order, ...p.path] };
      }
      return best!;
    });
  }
  const out = layer.length ? layer.reduce((a, b) => (b.v > a.v ? b : a)).order : [];
  return names.includes(ELSEWHERE) ? [...out, ELSEWHERE] : out;
}

export function overview(o: OverviewInput): Overview {
  const itemById = new Map(o.items.map((i) => [i.id, i]));
  const polities: OPolity[] = [];
  for (const t of o.territories) {
    const item = t.itemId ? itemById.get(t.itemId) : undefined;
    const life = polityLife(t, item, o.now);
    if (!life) continue;
    polities.push({ id: t.id, itemId: t.itemId, title: short(t.title), fullTitle: t.title, region: polityRegion(t, item), ...life, t });
  }
  const polById = new Map(polities.map((p) => [p.id, p]));

  // Groups of city-states: their region is their members'.
  const groups: OGroup[] = [];
  for (const g of o.groups ?? []) {
    const ms = g.territoryIds.map((id) => polById.get(id)).filter((p): p is OPolity => !!p && !p.group);
    if (!ms.length) continue;
    const region = ms[0].region;
    const members = ms.filter((p) => p.region === region);
    for (const p of members) p.group = g.id;
    groups.push({ id: g.id, title: g.title, region, members: members.map((p) => p.id), s: Math.min(...members.map((p) => p.s)), e: Math.max(...members.map((p) => p.e)) });
  }

  // What's part of what, and the highlights on each entry with what's part of it.
  const parts = new Map<string, string[]>();
  for (const r of o.relations) if (r.type === 'part-of') parts.set(r.toId, [...(parts.get(r.toId) ?? []), r.fromId]);
  const within = (id: string): string[] => {
    const out = [id];
    for (let i = 0; i < out.length && out.length < 500; i++) for (const p of parts.get(out[i]) ?? []) if (!out.includes(p)) out.push(p);
    return out;
  };
  const hl = new Map<string, number>();
  for (const h of o.highlights) for (const id of h.usedBy) hl.set(id, (hl.get(id) ?? 0) + 1);
  // Which polities took part in each entry: territories connected to it.
  const takers = new Map<string, Set<string>>();
  const take = (entry: string, t: string) => (takers.get(entry) ?? takers.set(entry, new Set()).get(entry)!).add(t);
  for (const r of o.relations) {
    if (polById.has(r.fromId) && !polById.has(r.toId)) take(r.toId, r.fromId);
    if (polById.has(r.toId) && !polById.has(r.fromId)) take(r.fromId, r.toId);
  }

  // Region links: polities in two regions dealing with each other through one entry, weighted by Bob's highlights on it.
  const links = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const bump = (a: string, b: string, v: number) => { if (a !== b) links.set(pairKey(a, b), (links.get(pairKey(a, b)) ?? 0) + v); };
  for (const [entry, ts] of takers) {
    const regions = [...new Set([...ts].map((t) => polById.get(t)!.region))];
    const w = 1 + within(entry).reduce((n, id) => n + (hl.get(id) ?? 0), 0);
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) bump(regions[i], regions[j], w);
  }
  for (const r of o.relations) {
    const a = polById.get(r.fromId), b = polById.get(r.toId);
    if (a && b) bump(a.region, b.region, 1);
  }
  const link = (a: string, b: string) => links.get(pairKey(a, b)) ?? 0;

  // Regions: the polities', and the eras'.
  const names = new Set(polities.map((p) => p.region));
  for (const i of o.items) if (isEra(i)) names.add(i.region?.trim() || ELSEWHERE);
  const centres = new Map<string, Centre[]>();
  for (const p of polities) { const c = centreOf(p.t); if (c) centres.set(p.region, [...(centres.get(p.region) ?? []), c]); }
  const centre = new Map([...centres].map(([r, cs]) => [r, [cs.reduce((a, c) => a + c[0], 0) / cs.length, cs.reduce((a, c) => a + c[1], 0) / cs.length] as Centre]));
  const parents = new Map((o.regions ?? []).map((r) => [r.name, r.parent?.trim() || undefined]));
  const parentOf = (r: string) => (r === ELSEWHERE ? undefined : parents.get(r));
  const auto = orderRegions([...names], centre, parentOf, link);
  const placed = new Map((o.regions ?? []).flatMap((r) => (r.order !== undefined ? [[r.name, r.order] as const] : [])));
  const order = withBobsOrder(auto, (r) => placed.get(r), parentOf);
  const parentsInOrder = [...new Set(order.map((r) => parentOf(r) ?? `\u0000${r}`))];
  const regions = order.map((name): ORegion => ({ name, label: name === ELSEWHERE ? 'Elsewhere' : name, parent: parentOf(name), tone: parentsInOrder.indexOf(parentOf(name) ?? `\u0000${name}`) }));
  const rank = new Map(order.map((r, i) => [r, i]));

  // World events: named in their home region, gilt along the top of every region they touched.
  const worlds: OWorld[] = [];
  const top: string[] = [];
  for (const i of o.items) {
    if (i.overview === 'shown') { top.push(i.id); continue; }
    if (i.overview !== 'world') continue;
    const count = new Map<string, number>();
    for (const id of within(i.id)) for (const t of takers.get(id) ?? []) { const r = polById.get(t)!.region; count.set(r, (count.get(r) ?? 0) + 1); }
    const own = isEra(i) ? i.region?.trim() : undefined;
    if (own) count.set(own, Infinity);
    if (!count.size) { top.push(i.id); continue; }
    const touches = [...count.keys()].filter((r) => rank.has(r)).sort((a, b) => rank.get(a)! - rank.get(b)!);
    if (!touches.length) { top.push(i.id); continue; }
    const home = touches.reduce((a, b) => (count.get(b)! > count.get(a)! ? b : a));
    worlds.push({ id: i.id, home, touches });
  }
  top.sort((a, b) => o.prominence(b) - o.prominence(a) || toDecimalYear(itemById.get(a)!.start) - toDecimalYear(itemById.get(b)!.start) || a.localeCompare(b));
  return { regions, auto, polities, groups, worlds, top };
}
