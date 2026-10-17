import { remove, upsert } from '../model/doc';
import type { Dimension, Highlight, Provenance, Relation, Source, TimelineDoc, TimelineItem } from '../model/types';

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
  /** The dimension Claude suggests for the highlight, with the words it rests on. Bob takes it only by picking it. */
  dimension?: { value: Dimension; quote: string };
  entries: DraftEntry[];
  connections: DraftConnection[];
  /** What the validator left out, in Bob's words. */
  dropped: string[];
}

/**
 * Put an accepted entry and the sources it cites into the doc. Drafted from
 * Bob's highlight (`highlightId`), the highlight now justifies the entry and
 * lends it its dimension.
 */
export function acceptEntry(doc: TimelineDoc, entry: DraftEntry, now = Date.now(), highlightId?: string): TimelineDoc {
  let d = doc;
  for (const s of entry.newSources) if (!d.sources.some((x) => x.id === s.id)) d = upsert(d, 'sources', s, now);
  const dimension = d.highlights.find((h) => h.id === highlightId)?.dimension;
  d = upsert(d, 'items', dimension && !entry.item.dimension ? { ...entry.item, dimension } : entry.item, now);
  if (entry.highlight) d = upsert(d, 'highlights', { ...entry.highlight, usedBy: [entry.item.id] }, now);
  return highlightId ? usedBy(d, highlightId, entry.item.id, now) : d;
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
