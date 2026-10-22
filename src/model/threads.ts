import { describeEffect } from './doc';
import type { Lane, Relation } from './types';

/**
 * Threads across polities and eras (docs/design.md, Long range: Threads). Bob's connections are
 * rolled up by where their ends are: each end belongs to the polities it's in (`polityMembers`), or,
 * failing that, to its era. Each pair of those gets one thread, with how many links it holds, its
 * main effect and main lane, weighted by `prominence` so the links Bob has worked on most count most.
 * A link whose ends share a polity is inside it (an influence between lanes), not a thread.
 */

/** A thread's end: a polity as `pol:<territory>`, or an era by its id. */
export type ThreadEnd = string;

export interface ThreadInput {
  relations: readonly Relation[];
  /** Each polity (by territory id) with the entries in it (`polityMembers`). */
  polities: ReadonlyMap<string, readonly string[]>;
  /** Polities' own entries: their strips. Connections can also point at a territory itself. */
  polityItems?: ReadonlyMap<string, string>;
  /** Eras with the entries in them, for entries in no polity. An inner era's entries count for its outer era. */
  eras?: ReadonlyArray<{ id: string; members: readonly string[]; region?: string; parent?: string }>;
  /** Each polity's region (by territory id): an era and a polity in the same region don't make a thread. */
  polityRegions?: ReadonlyMap<string, string>;
  /** Each entry's lanes in pigment order (`entryLanes`). */
  lanesOf: ReadonlyMap<string, readonly Lane[]>;
  prominence: (id: string) => number;
  /** Each entry's years. */
  years: (id: string) => { s: number; e: number } | undefined;
}

export interface ThreadLink {
  r: Relation;
  /** 1, plus a share of the prominence of its ends. */
  weight: number;
  /** The year it happened (`linkYear`). */
  year: number;
  /** Which end of the thread its cause is in. */
  from: ThreadEnd;
}

export interface Thread {
  /** `a|b`, with a before b. */
  key: string;
  a: ThreadEnd;
  b: ThreadEnd;
  /** Heaviest first. */
  links: ThreadLink[];
  count: number;
  /** The effect most of its weight carries, in words ("weakened", "influenced"). */
  effect: string;
  /** The cause's lane most of its weight carries; none when its causes have no lanes. */
  lane?: Lane;
  weight: number;
  /** Where it leaves `a` and enters `b`: the mean start of its entries on each side. */
  ya: number;
  yb: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The year a connection happened: when its effect began, or the cause's start if that came later
 * while the effect went on (the cause's start clamped into the effect's years). Without both dates, the one it has.
 */
export function linkYear(r: Pick<Relation, 'fromId' | 'toId'>, years: ThreadInput['years']): number | undefined {
  const a = years(r.fromId), b = years(r.toId);
  return a && b ? clamp(a.s, b.s, b.e) : a?.s ?? b?.s;
}

/** Each entry's thread ends: its polities, else its outermost eras. */
export function threadEnds(o: Pick<ThreadInput, 'polities' | 'polityItems' | 'eras'>): (id: string) => ThreadEnd[] {
  const ends = new Map<string, ThreadEnd[]>();
  const add = (id: string, end: ThreadEnd) => { const l = ends.get(id); if (!l) ends.set(id, [end]); else if (!l.includes(end)) l.push(end); };
  for (const [t, ids] of o.polities) { add(t, `pol:${t}`); for (const id of ids) add(id, `pol:${t}`); }
  for (const [item, t] of o.polityItems ?? []) add(item, `pol:${t}`);
  const eraById = new Map((o.eras ?? []).map((e) => [e.id, e]));
  const outer = (id: string) => { let e = eraById.get(id); for (let n = 0; e?.parent && eraById.has(e.parent) && n < 20; n++) e = eraById.get(e.parent); return e?.id ?? id; };
  const inPolity = (id: string) => ends.get(id)?.some((x) => x.startsWith('pol:'));
  for (const e of o.eras ?? []) {
    const root = outer(e.id);
    if (!inPolity(e.id)) add(e.id, root);
    for (const id of e.members) if (!inPolity(id)) add(id, root);
  }
  return (id) => ends.get(id) ?? [];
}

const top = <K>(m: Map<K, number>): K | undefined => {
  let best: K | undefined, bw = -Infinity;
  for (const [k, w] of m) if (w > bw) { best = k; bw = w; }
  return best;
};

/** Every thread, heaviest first. */
export function threads(o: ThreadInput): Thread[] {
  const endsOf = threadEnds(o);
  // Where each end is: an era and a polity in the same region aren't a thread (the polity is in the era).
  const regionOf = new Map<ThreadEnd, string>();
  for (const [t, r] of o.polityRegions ?? []) regionOf.set(`pol:${t}`, r);
  for (const e of o.eras ?? []) if (e.region !== undefined) regionOf.set(e.id, e.region);
  // A polity that is part of another (the Delian League of Athens) is its reach: links between them are inside.
  const reach = new Set<string>();
  for (const r of o.relations) {
    if (r.type !== 'part-of') continue;
    const a = endsOf(r.fromId).find((x) => x.startsWith('pol:')), b = endsOf(r.toId).find((x) => x.startsWith('pol:'));
    if (a && b && (o.polityItems?.has(r.fromId) || o.polities.has(r.fromId)) && (o.polityItems?.has(r.toId) || o.polities.has(r.toId))) reach.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  const sameRegion = (x: ThreadEnd, y: ThreadEnd) => !x.startsWith('pol:') !== !y.startsWith('pol:') && regionOf.has(x) && regionOf.get(x) === regionOf.get(y);
  const byKey = new Map<string, { a: ThreadEnd; b: ThreadEnd; links: ThreadLink[]; ys: [number[], number[]] }>();
  for (const r of o.relations) {
    if (r.type === 'part-of' || r.fromId === r.toId) continue;
    const A = endsOf(r.fromId), B = endsOf(r.toId);
    // Ends that share a polity or era: it happened inside it.
    if (!A.length || !B.length || A.some((x) => B.includes(x))) continue;
    const weight = 1 + (o.prominence(r.fromId) + o.prominence(r.toId)) / 20;
    const year = linkYear(r, o.years);
    if (year === undefined) continue;
    const sa = o.years(r.fromId)?.s ?? year, sb = o.years(r.toId)?.s ?? year;
    for (const x of A) for (const y of B) {
      if (sameRegion(x, y) || reach.has(x < y ? `${x}|${y}` : `${y}|${x}`)) continue;
      const [a, b, ya, yb] = x < y ? [x, y, sa, sb] : [y, x, sb, sa];
      const key = `${a}|${b}`;
      const t = byKey.get(key) ?? byKey.set(key, { a, b, links: [], ys: [[], []] }).get(key)!;
      t.links.push({ r, weight, year, from: x });
      t.ys[0].push(ya); t.ys[1].push(yb);
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const out: Thread[] = [];
  for (const [key, t] of byKey) {
    const effects = new Map<string, number>(), lanes = new Map<Lane, number>();
    let weight = 0;
    for (const l of t.links) {
      weight += l.weight;
      const eff = describeEffect(l.r, 'out').toLowerCase();
      effects.set(eff, (effects.get(eff) ?? 0) + l.weight);
      const lane = o.lanesOf.get(l.r.fromId)?.[0];
      if (lane) lanes.set(lane, (lanes.get(lane) ?? 0) + l.weight);
    }
    t.links.sort((p, q) => q.weight - p.weight || p.year - q.year);
    out.push({ key, a: t.a, b: t.b, links: t.links, count: t.links.length, effect: top(effects)!, lane: top(lanes), weight, ya: mean(t.ys[0]), yb: mean(t.ys[1]) });
  }
  return out.sort((p, q) => q.weight - p.weight || p.key.localeCompare(q.key));
}

/** The threads that touch any of `focus` (a polity, an era, or a folded group's members). */
export function threadsAround(list: readonly Thread[], focus: Iterable<ThreadEnd>): Thread[] {
  const f = new Set(focus);
  return list.filter((t) => f.has(t.a) || f.has(t.b));
}

/** "5 · weakened" */
export const threadLabel = (t: Pick<Thread, 'count' | 'effect'>) => `${t.count} · ${t.effect}`;
