import type { MultiPolygon, Polygon, Position } from 'geojson';
import { toDecimalYear } from './dates';
import { snapshotAt } from './atYear';
import type { Place, Relation, Territory, TimelineItem } from './types';

/**
 * What's in a polity, for opening it into its six lanes (Phase 4, docs/design.md "Picking and
 * opening"). It mirrors "What's in an era":
 *  1. what's `part of` it (its territory or its entry), directly;
 *  2. else the polities that hold the entry's place in its year, and those its connections name
 *     as taking part (a war connected to Athens and to Sparta is in both);
 *  3. else the polities of what it's part of, following part-of links up (a battle → its war).
 * An entry can be in several polities. A polity's own entry isn't in it: it's the strip itself.
 *
 * A world event holds what's part of it (all the way down) and what's connected to it.
 */

export interface PolityInput {
  items: readonly TimelineItem[];
  territories: readonly Territory[];
  relations: readonly Relation[];
}

/** Whether a point is inside a ring (ray casting). */
function inRing([x, y]: [number, number], ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether borders hold a point: inside an outer ring and none of its holes. */
export function holds(g: Polygon | MultiPolygon, lon: number, lat: number): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some(([outer, ...holes]) => !!outer && inRing([lon, lat], outer) && !holes.some((h) => inRing([lon, lat], h)));
}

/** The year a place is looked up in: a birthplace at the start, a deathplace at the end, else the middle (an event's year). */
export function placeYear(it: Pick<TimelineItem, 'kind' | 'start' | 'end'>, p: Pick<Place, 'role'>): number | undefined {
  if (!it.start) return undefined;
  const s = toDecimalYear(it.start);
  const e = it.kind === 'event' || !it.end ? s : toDecimalYear(it.end);
  return p.role === 'born' ? s : p.role === 'died' ? e : (s + e) / 2;
}

/** Each polity (by territory id) with the entries in it, in the order of `items`. */
export function polityMembers(o: PolityInput): Map<string, string[]> {
  const byItem = new Map<string, string>();
  for (const t of o.territories) if (t.itemId) byItem.set(t.itemId, t.id);
  const terrIds = new Set(o.territories.map((t) => t.id));
  // A polity named by an id: its territory, or the entry that is its strip.
  const polityOf = (id: string) => (terrIds.has(id) ? id : byItem.get(id));

  const partOf = new Map<string, string[]>();
  const named = new Map<string, Set<string>>();
  const name = (entry: string, pol: string) => (named.get(entry) ?? named.set(entry, new Set()).get(entry)!).add(pol);
  for (const r of o.relations) {
    if (r.type === 'part-of') { partOf.set(r.fromId, [...(partOf.get(r.fromId) ?? []), r.toId]); continue; }
    const a = polityOf(r.fromId), b = polityOf(r.toId);
    if (a && !b) name(r.toId, a);
    if (b && !a) name(r.fromId, b);
  }

  const shaped = o.territories.filter((t) => t.snapshots.some((s) => s.geometry));
  const own = (it: TimelineItem): Set<string> => {
    const out = new Set(named.get(it.id) ?? []);
    for (const p of it.places ?? []) {
      const y = placeYear(it, p);
      if (y === undefined) continue;
      for (const t of shaped) {
        const g = snapshotAt(t, y)?.geometry;
        if (g && holds(g, p.lon, p.lat)) out.add(t.id);
      }
    }
    return out;
  };

  const byId = new Map(o.items.map((i) => [i.id, i]));
  const memo = new Map<string, Set<string>>();
  const of = (id: string, seen: Set<string>): Set<string> => {
    const hit = memo.get(id);
    if (hit) return hit;
    const it = byId.get(id);
    const ups = partOf.get(id) ?? [];
    const direct = new Set(ups.flatMap((u) => polityOf(u) ?? []));
    let out = direct.size ? direct : it ? own(it) : new Set<string>();
    if (!out.size && !seen.has(id)) {
      seen.add(id);
      out = new Set(ups.flatMap((u) => [...of(u, seen)]));
    }
    memo.set(id, out);
    return out;
  };

  const members = new Map<string, string[]>(o.territories.map((t) => [t.id, []]));
  for (const it of o.items) {
    if (terrIds.has(it.id)) continue;
    for (const t of of(it.id, new Set())) if (t !== byItem.get(it.id)) members.get(t)?.push(it.id);
  }
  return members;
}

/** What a world event holds: what's part of it, all the way down, and what's connected to it. */
export function worldMembers(id: string, o: Pick<PolityInput, 'relations'>): string[] {
  const parts = new Map<string, string[]>();
  for (const r of o.relations) if (r.type === 'part-of') parts.set(r.toId, [...(parts.get(r.toId) ?? []), r.fromId]);
  const out = [id];
  for (let i = 0; i < out.length && out.length < 2000; i++) for (const p of parts.get(out[i]) ?? []) if (!out.includes(p)) out.push(p);
  for (const r of o.relations) {
    if (r.type === 'part-of') continue;
    const other = r.fromId === id ? r.toId : r.toId === id ? r.fromId : undefined;
    if (other && !out.includes(other)) out.push(other);
  }
  return out.slice(1);
}
