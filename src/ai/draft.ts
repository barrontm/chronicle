import { remove, upsert } from '../model/doc';
import type { Highlight, Lane, Provenance, Relation, Source, Territory, TimelineDoc, TimelineItem } from '../model/types';

/**
 * A set of AI-drafted records waiting for Bob. Nothing here is in the doc
 * until he accepts a record; then it goes in through `upsert`, provenance and
 * all. Rejected records are simply forgotten.
 */
export type DraftStatus = 'pending' | 'accepted' | 'rejected';

export interface DraftEntry {
  item: TimelineItem;
  /** Sources the entry cites that aren't saved yet (its Wikipedia page). */
  newSources: Source[];
  /** The page's intro, quoted; saved with the entry as a highlight. */
  highlight?: Highlight;
  /** A polity's territory, saved with it: new, or one Bob had (as it was, so Undo puts it back). */
  territory?: Tied;
  /** Claude's one-line reason, shown while reviewing and never saved. */
  why: string;
  /** Problems that stop it being accepted as it is (e.g. no date on Wikidata). */
  problems: string[];
  /** Words of Bob's highlight (or its section) that the entry rests on, shown while reviewing. */
  quote?: string;
  status: DraftStatus;
}

export interface DraftConnection {
  relation: Relation;
  /** Words of Bob's highlight (or its section) that the connection rests on. */
  quote?: string;
  status: DraftStatus;
}

export interface DraftSet {
  feature: string;
  request: string;
  provenance: Provenance;
  /** Drafted from this highlight: accepted records join its `usedBy`, and connections cite it. */
  highlightId?: string;
  /** The lanes Claude suggests for the highlight, each with the words it rests on. Bob takes one only by picking it. */
  lanes?: { value: Lane; quote: string }[];
  entries: DraftEntry[];
  connections: DraftConnection[];
  /** What the validator left out, in Bob's words. */
  dropped: string[];
}

/**
 * Put an accepted entry and the sources it cites into the doc. Drafted from
 * Bob's highlight (`highlightId`), the highlight now justifies the entry and
 * lends it its lanes.
 */
export function acceptEntry(doc: TimelineDoc, entry: DraftEntry, now = Date.now(), highlightId?: string): TimelineDoc {
  let d = doc;
  for (const s of entry.newSources) if (!d.sources.some((x) => x.id === s.id)) d = upsert(d, 'sources', s, now);
  const lanes = d.highlights.find((h) => h.id === highlightId)?.lanes;
  d = upsert(d, 'items', lanes?.length && !entry.item.lanes?.length ? { ...entry.item, lanes } : entry.item, now);
  if (entry.territory) d = upsert(d, 'territories', entry.territory.next, now);
  if (entry.highlight) d = upsert(d, 'highlights', { ...entry.highlight, usedBy: [entry.item.id] }, now);
  return highlightId ? usedBy(d, highlightId, entry.item.id, now) : d;
}

/** A polity's territory as saved with its entry, and as it was before when Bob already had it. */
export interface Tied { next: Territory; before?: Territory }

/** Take back a polity's territory: a new one goes, one Bob had goes back to how it was. */
function untie(doc: TimelineDoc, t: Tied, now: number): TimelineDoc {
  if (t.before) return upsert(doc, 'territories', t.before, now);
  return doc.territories.some((x) => x.id === t.next.id) ? remove(doc, 'territories', t.next.id, now) : doc;
}

/**
 * What Bob ticked under "Becomes", or filled in himself, for one highlight:
 * records he has, to link it to (with the connections Wikidata suggests), and
 * new entries, to add the same way as an accepted draft.
 */
export interface Becoming {
  link: { id: string; relations?: Relation[] }[];
  add: { item: TimelineItem; newSources?: Source[]; relations?: Relation[]; territory?: Tied }[];
}

/** What `addBecoming` changed, so one Undo can take it all back. */
export interface Became { highlightId: string; added: string[]; linked: string[]; relations: string[]; territories?: Tied[] }

/**
 * Link the highlight to the records Bob has and add the new ones through
 * `acceptEntry`, so each cites the highlight and takes its lanes. Connections
 * go in once both their ends are there.
 */
export function addBecoming(doc: TimelineDoc, highlightId: string, b: Becoming, now = Date.now()): { doc: TimelineDoc; became: Became } {
  const before = doc.highlights.find((h) => h.id === highlightId)?.usedBy ?? [];
  const became: Became = { highlightId, added: [], linked: [], relations: [] };
  let d = doc;
  for (const l of b.link) {
    if (!before.includes(l.id) && !became.linked.includes(l.id)) became.linked.push(l.id);
    d = usedBy(d, highlightId, l.id, now);
  }
  for (const a of b.add) {
    d = acceptEntry(d, { item: a.item, newSources: a.newSources ?? [], territory: a.territory, why: '', problems: [], status: 'pending' }, now, highlightId);
    became.added.push(a.item.id);
    if (a.territory) (became.territories ??= []).push(a.territory);
  }
  const ids = new Set(d.items.map((i) => i.id));
  for (const r of [...b.link, ...b.add].flatMap((x) => x.relations ?? [])) {
    if (!ids.has(r.fromId) || !ids.has(r.toId) || d.relations.some((x) => x.id === r.id)) continue;
    d = upsert(d, 'relations', r, now);
    became.relations.push(r.id);
  }
  return { doc: d, became };
}

/** Take back what `addBecoming` did: its connections and new entries go, and the highlight lets go of what it linked. */
export function undoBecoming(doc: TimelineDoc, became: Became, now = Date.now()): TimelineDoc {
  let d = doc;
  for (const id of became.relations) if (d.relations.some((r) => r.id === id)) d = remove(d, 'relations', id, now);
  for (const id of became.added) if (d.items.some((i) => i.id === id)) d = remove(d, 'items', id, now);
  for (const t of became.territories ?? []) d = untie(d, t, now);
  const h = d.highlights.find((x) => x.id === became.highlightId);
  if (h && became.linked.some((id) => h.usedBy.includes(id))) {
    d = upsert(d, 'highlights', { ...h, usedBy: h.usedBy.filter((id) => !became.linked.includes(id)) }, now);
  }
  return d;
}

/** A connection can be accepted once both its ends are on the timeline. */
export function canAcceptConnection(doc: TimelineDoc, c: DraftConnection): boolean {
  const ids = new Set(doc.items.map((i) => i.id));
  return ids.has(c.relation.fromId) && ids.has(c.relation.toId);
}

/** Put an accepted connection into the doc; drafted from a highlight, it cites it as evidence and the highlight lists it. */
export function acceptConnection(doc: TimelineDoc, c: DraftConnection, now = Date.now(), highlightId?: string): TimelineDoc {
  if (!canAcceptConnection(doc, c)) return doc;
  const r = c.relation;
  const cited = highlightId && !r.highlightIds?.includes(highlightId) ? { ...r, highlightIds: [...(r.highlightIds ?? []), highlightId] } : r;
  const d = upsert(doc, 'relations', cited, now);
  return highlightId ? usedBy(d, highlightId, r.id, now) : d;
}

function usedBy(doc: TimelineDoc, highlightId: string, recordId: string, now: number): TimelineDoc {
  const h = doc.highlights.find((x) => x.id === highlightId);
  if (!h || h.usedBy.includes(recordId)) return doc;
  return upsert(doc, 'highlights', { ...h, usedBy: [...h.usedBy, recordId] }, now);
}

/** Take back an accepted entry, with the set's connections accepted to it. Its highlights let go of both. */
export function undoEntry(doc: TimelineDoc, set: DraftSet, entry: DraftEntry, now = Date.now()): TimelineDoc {
  const id = entry.item.id;
  let d = doc;
  for (const c of set.connections) if (c.relation.fromId === id || c.relation.toId === id) d = undoConnection(d, c, now);
  if (entry.territory) d = untie(d, entry.territory, now);
  return d.items.some((i) => i.id === id) ? remove(d, 'items', id, now) : d;
}

export function undoConnection(doc: TimelineDoc, c: DraftConnection, now = Date.now()): TimelineDoc {
  return doc.relations.some((r) => r.id === c.relation.id) ? remove(doc, 'relations', c.relation.id, now) : doc;
}

/** Accepted means it's in the doc (Bob may have added it through the editor); otherwise what he chose in review. */
export function statusIn(doc: TimelineDoc, x: DraftEntry | DraftConnection): DraftStatus {
  const there = 'item' in x ? doc.items.some((i) => i.id === x.item.id) : doc.relations.some((r) => r.id === x.relation.id);
  return there ? 'accepted' : x.status === 'rejected' ? 'rejected' : 'pending';
}

/** Records in the set Bob hasn't accepted or rejected yet. */
export function waiting(doc: TimelineDoc, set: DraftSet | null | undefined): number {
  if (!set) return 0;
  return [...set.entries, ...set.connections].filter((x) => statusIn(doc, x) === 'pending').length;
}

/** Entries still waiting, with a place to show on the map. */
export function pendingWithPlaces(set: DraftSet | null): TimelineItem[] {
  return (set?.entries ?? []).filter((e) => e.status === 'pending' && e.item.places?.length).map((e) => e.item);
}

/**
 * What of Claude's drafts the timeline shows: dated entries still waiting (dashed ghosts), and
 * connections still waiting whose ends are both in Chronicle or drafted (dashed arrows).
 */
export function pendingOnTimeline(doc: TimelineDoc, sets: Array<DraftSet | null | undefined>): { items: TimelineItem[]; relations: Relation[] } {
  const items: TimelineItem[] = [];
  const relations: Relation[] = [];
  for (const set of sets) {
    if (!set) continue;
    for (const e of set.entries) if (statusIn(doc, e) === 'pending' && Number.isFinite(e.item.start?.y)) items.push(e.item);
    for (const c of set.connections) if (statusIn(doc, c) === 'pending') relations.push(c.relation);
  }
  return { items, relations };
}

/** The version line at the top of a feature's prompt.md ("Version: 3") → "entries@3". */
export function promptId(feature: string, prompt: string): string {
  const v = /^Version:\s*(\S+)/.exec(prompt)?.[1];
  if (!v) throw new Error(`${feature}/prompt.md has no version line`);
  return `${feature}@${v}`;
}

/** The prompt without its version line, as sent to Claude. */
export function promptBody(prompt: string): string {
  return prompt.replace(/^Version:.*\n+/, '');
}
