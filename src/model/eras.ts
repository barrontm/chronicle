import { formatRange, toDecimalYear } from './dates';
import { DIMENSIONS, type DatedItem, type Dimension, type Highlight, type HistDate, type Relation, type TimelineItem } from './types';

/**
 * Eras for the overview (the timeline's level 0): every period, in a row per region, with the
 * highlights in it and the mix of their dimensions.
 *
 * What's in an era: the era itself and its themes, and every entry that is `part of` it (through
 * a war, say) or, failing that, whose middle falls in its dates. An entry in the dates of eras
 * in several regions is in each of them; inside one region it's in the innermost era, and that
 * era's highlights also count for the eras around it.
 */

export interface Era {
  id: string;
  title: string;
  /** Its row: Bob's region, or '' for "Elsewhere". */
  region: string;
  /** Decimal years. An era still going runs to `now`. */
  s: number;
  e: number;
  approx: boolean;
  endApprox: boolean;
  /** Its dates in words, without "c." (its edges show what's approximate). */
  when: string;
  /** The era it sits inside in its row, if any. */
  parent?: string;
  /** How many highlights are in it, counting its inner eras'. */
  highlights: number;
  /** Of those, how many are in each dimension (a highlight without one takes its entry's). */
  mix: Record<Dimension, number>;
  /** Entries in it and not in an inner era (never eras), for its landmarks. */
  members: string[];
}

export interface EraRegion {
  /** Bob's region, or '' for "Elsewhere". */
  name: string;
  eras: Era[];
  /** Highlights in any of its eras, each counted once. */
  highlights: number;
}

export const ELSEWHERE = '';

/** A period is an era. An older span with no kind of thing is one once Bob gives it a region. */
export function isEra(item: TimelineItem): item is DatedItem {
  if (!item.start || item.kind !== 'span') return false;
  return item.subject ? item.subject === 'period' : !!item.region?.trim();
}

/** A band shows an approximate date with a dashed edge, so its dates in words leave out the "c.". */
const exact = (d: HistDate): HistDate => ({ ...d, approx: undefined });
const emptyMix = () => Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;

/**
 * Regions with their eras, the most highlighted region first and "Elsewhere" last; eras earliest
 * first. `now` (a decimal year) is where an era without an end stops.
 */
export function eraRegions(items: TimelineItem[], highlights: Highlight[], relations: Relation[], now: number): EraRegion[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const eras = new Map<string, Era>();
  for (const it of items) {
    if (!isEra(it)) continue;
    const s = toDecimalYear(it.start);
    eras.set(it.id, {
      id: it.id, title: it.title, region: it.region?.trim() ?? ELSEWHERE, s, e: Math.max(s, it.end ? toDecimalYear(it.end) : now),
      approx: !!it.start.approx, endApprox: !!it.end?.approx, when: formatRange(exact(it.start), it.end && exact(it.end)), highlights: 0, mix: emptyMix(), members: [],
    });
  }
  if (!eras.size) return [];

  // What each entry is part of, for following part-of links up to an era.
  const partOf = new Map<string, string[]>();
  for (const r of relations) if (r.type === 'part-of') partOf.set(r.fromId, [...(partOf.get(r.fromId) ?? []), r.toId]);
  const eraByPartOf = (id: string): Era | undefined => {
    const seen = new Set([id]);
    let level = partOf.get(id) ?? [];
    while (level.length) {
      const hit = level.map((x) => eras.get(x)).find(Boolean);
      if (hit) return hit;
      level = level.flatMap((x) => (seen.has(x) ? [] : (seen.add(x), partOf.get(x) ?? [])));
    }
    return undefined;
  };
  // The innermost era of each region whose dates hold a year (a shorter era is further in).
  const list = [...eras.values()];
  const innermost = (y: number, skip?: string): Era[] => {
    const best = new Map<string, Era>();
    for (const e of list) {
      if (e.id === skip || y < e.s || y > e.e) continue;
      const b = best.get(e.region);
      if (!b || e.e - e.s < b.e - b.s || (e.e - e.s === b.e - b.s && e.id < b.id)) best.set(e.region, e);
    }
    return [...best.values()];
  };
  // An era sits inside the era it's part of, or else the innermost longer one around it in its row.
  for (const e of list) {
    const up = eraByPartOf(e.id);
    if (up && up.id !== e.id) { e.parent = up.id; continue; }
    const around = list.filter((o) => o !== e && o.region === e.region && o.s <= e.s && o.e >= e.e && (o.e - o.s > e.e - e.s || (o.e - o.s === e.e - e.s && o.id < e.id)));
    around.sort((a, b) => a.e - a.s - (b.e - b.s));
    if (around[0]) e.parent = around[0].id;
  }
  const withParents = (e: Era): Era[] => {
    const out = [e];
    for (let p = e.parent && eras.get(e.parent); p && !out.includes(p); p = p.parent && eras.get(p.parent)) out.push(p);
    return out;
  };

  // Which eras an entry is in.
  const homes = new Map<string, Era[]>();
  const homeOf = (id: string): Era[] => {
    let h = homes.get(id);
    if (h) return h;
    const e = eras.get(id);
    const it = byId.get(id);
    if (e) h = [e];
    else if (!it?.start) h = [];
    else {
      const up = eraByPartOf(id);
      const s = toDecimalYear(it.start);
      const end = it.kind === 'event' ? s : it.end ? toDecimalYear(it.end) : Math.max(s, now);
      h = up ? [up] : innermost((s + end) / 2);
      for (const x of h) x.members.push(id);
    }
    homes.set(id, h);
    return h;
  };
  for (const it of items) homeOf(it.id);

  // Each highlight counts once for every era it's in, and for the eras around those.
  const counted = new Map<string, Set<string>>();
  const count = (h: Highlight, era: Era, dim: Dimension | undefined) => {
    for (const e of withParents(era)) {
      let seen = counted.get(e.id);
      if (!seen) counted.set(e.id, (seen = new Set()));
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      e.highlights++;
      if (dim) e.mix[dim]++;
    }
  };
  const themed = new Map<string, string[]>();
  for (const it of items) for (const t of eras.has(it.id) ? it.themes ?? [] : []) for (const hid of t.highlightIds) themed.set(hid, [...(themed.get(hid) ?? []), it.id]);
  const regionSeen = new Map<string, Set<string>>();
  for (const h of highlights) {
    const users = [...h.usedBy, ...(themed.get(h.id) ?? [])];
    const dim = h.dimension ?? users.map((id) => byId.get(id)?.dimension).find(Boolean);
    for (const id of users) {
      for (const era of homeOf(id)) {
        count(h, era, dim);
        let rs = regionSeen.get(era.region);
        if (!rs) regionSeen.set(era.region, (rs = new Set()));
        rs.add(h.id);
      }
    }
  }

  const regions = new Map<string, Era[]>();
  for (const e of list) regions.set(e.region, [...(regions.get(e.region) ?? []), e]);
  return [...regions.entries()]
    .map(([name, es]): EraRegion => ({ name, eras: es.sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id)), highlights: regionSeen.get(name)?.size ?? 0 }))
    .sort((a, b) => Number(a.name === ELSEWHERE) - Number(b.name === ELSEWHERE) || b.highlights - a.highlights || a.name.localeCompare(b.name));
}
