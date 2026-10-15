import { isValidHistDate, compareHistDate } from './dates';
import {
  SCHEMA_VERSION,
  type Citation,
  type ItemKind,
  type Note,
  type Relation,
  type RelationType,
  type Series,
  type Source,
  type Territory,
  type TimelineDoc,
  type TimelineItem,
} from './types';

export function newId(prefix = 'x'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

/** Categories a brand-new timeline starts with. The user can rename, recolor or add more. */
export const DEFAULT_CATEGORIES = [
  { id: 'politics', label: 'Politics & government', color: 'var(--pig-lapis)' },
  { id: 'war', label: 'War & conflict', color: 'var(--pig-cinnabar)' },
  { id: 'ideas', label: 'Philosophy & religion', color: 'var(--pig-umber)' },
  { id: 'science', label: 'Science', color: 'var(--pig-verdigris)' },
  { id: 'technology', label: 'Technology', color: 'var(--pig-ochre)' },
  { id: 'society', label: 'Society & economy', color: 'var(--pig-madder)' },
  { id: 'arts', label: 'Art & literature', color: 'var(--pig-indigo)' },
];

export function createEmptyDoc(title = 'My history'): TimelineDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('doc'),
    title,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    items: [],
    series: [],
    territories: [],
    notes: [],
    sources: [],
    relations: [],
    deleted: {},
    updatedAt: Date.now(),
  };
}

// ---------- Validation ----------

export class DocValidationError extends Error {
  constructor(public problems: string[]) {
    super(`This file isn't a valid timeline: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''}`);
  }
}

const KINDS: ItemKind[] = ['event', 'span', 'person'];
export const RELATION_TYPES: RelationType[] = ['influenced', 'caused', 'part-of', 'responded-to', 'related'];

export function validateItem(item: TimelineItem, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  const name = item.title ? `"${item.title}"` : `item ${item.id}`;
  if (!item.id) p.push('an item is missing its id');
  if (!item.title?.trim()) p.push(`${name} has no title`);
  if (!KINDS.includes(item.kind)) p.push(`${name} has unknown kind "${item.kind}"`);
  if (!item.start || !isValidHistDate(item.start)) p.push(`${name} has an invalid start date`);
  if (item.end && !isValidHistDate(item.end)) p.push(`${name} has an invalid end date`);
  if (item.kind === 'span' && !item.end) p.push(`${name} is a span but has no end date`);
  if (item.kind === 'event' && item.end) p.push(`${name} is an event but has an end date`);
  if (item.start && item.end && isValidHistDate(item.start) && isValidHistDate(item.end) && compareHistDate(item.end, item.start) < 0) {
    p.push(`${name} ends before it starts`);
  }
  if (!categoryIds.has(item.categoryId)) p.push(`${name} uses unknown category "${item.categoryId}"`);
  for (const pl of item.places ?? []) {
    if (!Number.isFinite(pl.lat) || !Number.isFinite(pl.lon) || Math.abs(pl.lat) > 90 || Math.abs(pl.lon) > 180) p.push(`${name} has a place with invalid coordinates`);
  }
  if (item.excerpt && !item.excerpt.text?.trim()) p.push(`${name} has an empty excerpt`);
  return p;
}

export function validateSeries(s: Series, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  if (!s.id || !s.title) p.push('a series is missing its id or title');
  if (!categoryIds.has(s.categoryId)) p.push(`series "${s.title}" uses unknown category "${s.categoryId}"`);
  if (!Array.isArray(s.points) || s.points.length < 2) p.push(`series "${s.title}" needs at least two points`);
  else if (s.points.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.v))) p.push(`series "${s.title}" has non-numeric points`);
  else if (s.scale === 'log' && s.points.some((pt) => pt.v <= 0)) p.push(`series "${s.title}" is log-scale but has values ≤ 0`);
  return p;
}

export function validateDoc(doc: TimelineDoc): string[] {
  const p: string[] = [];
  const catIds = new Set(doc.categories.map((c) => c.id));
  const allIds = new Set<string>();
  const checkUnique = (id: string) => {
    if (allIds.has(id)) p.push(`duplicate id "${id}"`);
    allIds.add(id);
  };
  for (const it of doc.items) {
    checkUnique(it.id);
    p.push(...validateItem(it, catIds));
  }
  for (const s of doc.series) {
    checkUnique(s.id);
    p.push(...validateSeries(s, catIds));
  }
  for (const t of doc.territories) checkUnique(t.id);
  const sourceIds = new Set(doc.sources.map((s) => s.id));
  for (const s of doc.sources) {
    checkUnique(s.id);
    if (!s.title?.trim()) p.push(`source ${s.id} has no title`);
  }
  const checkCitations = (owner: string, cites?: Citation[]) => {
    for (const c of cites ?? []) if (!sourceIds.has(c.sourceId)) p.push(`${owner} cites unknown source "${c.sourceId}"`);
  };
  for (const it of doc.items) {
    checkCitations(`"${it.title}"`, it.citations);
    if (it.excerpt) checkCitations(`the excerpt on "${it.title}"`, [{ sourceId: it.excerpt.sourceId }]);
  }
  for (const n of doc.notes) {
    checkUnique(n.id);
    if (!n.title?.trim()) p.push(`note ${n.id} has no title`);
    checkCitations(`note "${n.title}"`, n.citations);
    // Dangling links are tolerated (a linked item may have been deleted on another device) but not unknown kinds of data.
    if (!Array.isArray(n.linkedIds)) p.push(`note "${n.title}" has malformed links`);
  }
  for (const r of doc.relations) {
    checkUnique(r.id);
    if (!RELATION_TYPES.includes(r.type)) p.push(`connection ${r.id} has unknown type "${r.type}"`);
    if (r.fromId === r.toId) p.push(`connection ${r.id} links an item to itself`);
  }
  return p;
}

/**
 * Turn untrusted JSON (an imported file) into a current-schema doc, or throw
 * DocValidationError with human-readable problems. Add migrations here as
 * schemaVersion increases: each step upgrades N → N+1.
 */
export function parseDoc(json: string): TimelineDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new DocValidationError(['the file is not valid JSON']);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DocValidationError(['the file does not contain a timeline object']);
  let r = raw as Partial<TimelineDoc>;
  if (typeof r.schemaVersion !== 'number') throw new DocValidationError(['the file has no schemaVersion']);
  if (r.schemaVersion > SCHEMA_VERSION) {
    throw new DocValidationError([`the file was made by a newer version of the app (schema ${r.schemaVersion}); update the app first`]);
  }
  if (r.schemaVersion === 1) r = migrate1to2(r);
  const doc: TimelineDoc = {
    schemaVersion: SCHEMA_VERSION,
    id: r.id ?? newId('doc'),
    title: r.title ?? 'Imported timeline',
    categories: r.categories ?? [],
    items: r.items ?? [],
    series: r.series ?? [],
    territories: r.territories ?? [],
    notes: r.notes ?? [],
    sources: r.sources ?? [],
    relations: r.relations ?? [],
    deleted: r.deleted ?? {},
    updatedAt: r.updatedAt ?? Date.now(),
  };
  const problems = validateDoc(doc);
  if (problems.length) throw new DocValidationError(problems);
  return doc;
}

/**
 * v2 adds optional fields only (item places, excerpt and wikidataId; source
 * accessed date), so a v1 doc is already a valid v2 doc.
 */
function migrate1to2(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 2 };
}

export function serializeDoc(doc: TimelineDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ---------- Mutations (pure; return a new doc) ----------

/** The collections of id'd, timestamped records inside a doc. */
export type Collection = 'items' | 'series' | 'territories' | 'notes' | 'sources' | 'relations';
type RecordOf<C extends Collection> = {
  items: TimelineItem;
  series: Series;
  territories: Territory;
  notes: Note;
  sources: Source;
  relations: Relation;
}[C];

export function upsert<C extends Collection>(doc: TimelineDoc, collection: C, record: RecordOf<C>, now = Date.now()): TimelineDoc {
  const list = doc[collection] as RecordOf<C>[];
  const next = { ...record, updatedAt: now };
  const exists = list.some((r) => r.id === record.id);
  const updated = exists ? list.map((r) => (r.id === record.id ? next : r)) : [...list, next];
  const deleted = { ...doc.deleted };
  delete deleted[record.id];
  return { ...doc, [collection]: updated, deleted, updatedAt: now };
}

/**
 * Remove a record and clean up anything pointing at it:
 *  - deleting an item/series/territory removes its connections and unlinks it from notes
 *  - deleting a source removes citations of it
 * Notes themselves are never deleted as a side effect; your writing is kept.
 */
export function remove(doc: TimelineDoc, collection: Collection, id: string, now = Date.now()): TimelineDoc {
  const deleted = { ...doc.deleted, [id]: now };
  let next: TimelineDoc = { ...doc, [collection]: (doc[collection] as { id: string }[]).filter((r) => r.id !== id), deleted, updatedAt: now };

  if (collection === 'items' || collection === 'series' || collection === 'territories') {
    const dropped = next.relations.filter((r) => r.fromId === id || r.toId === id);
    for (const r of dropped) deleted[r.id] = now;
    next = {
      ...next,
      relations: next.relations.filter((r) => r.fromId !== id && r.toId !== id),
      notes: next.notes.map((n) => (n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id), updatedAt: now } : n)),
    };
  }
  if (collection === 'sources') {
    const strip = <T extends { citations?: Citation[]; updatedAt: number }>(r: T): T =>
      r.citations?.some((c) => c.sourceId === id) ? { ...r, citations: r.citations.filter((c) => c.sourceId !== id), updatedAt: now } : r;
    // A quoted excerpt without its source is unattributed text, so it goes with the source.
    const dropExcerpt = (it: TimelineItem): TimelineItem => {
      if (it.excerpt?.sourceId !== id) return it;
      const { excerpt: _excerpt, ...rest } = it;
      return { ...rest, updatedAt: now };
    };
    next = { ...next, items: next.items.map((it) => dropExcerpt(strip(it))), notes: next.notes.map(strip) };
  }
  return next;
}

// ---------- Queries ----------

export function notesFor(doc: TimelineDoc, id: string): Note[] {
  return doc.notes.filter((n) => n.linkedIds.includes(id));
}

export function relationsFor(doc: TimelineDoc, id: string): { outgoing: Relation[]; incoming: Relation[] } {
  return {
    outgoing: doc.relations.filter((r) => r.fromId === id),
    incoming: doc.relations.filter((r) => r.toId === id),
  };
}

/** Human phrasing for a connection, read in either direction. */
export function describeRelation(type: RelationType, direction: 'out' | 'in'): string {
  const out: Record<RelationType, string> = {
    influenced: 'Influenced',
    caused: 'Led to',
    'part-of': 'Part of',
    'responded-to': 'Responded to',
    related: 'Related to',
  };
  const inn: Record<RelationType, string> = {
    influenced: 'Influenced by',
    caused: 'Caused by',
    'part-of': 'Includes',
    'responded-to': 'Prompted',
    related: 'Related to',
  };
  return (direction === 'out' ? out : inn)[type];
}

// ---------- Merge (for syncing one person's devices) ----------

type Stamped = { id: string; updatedAt: number };

function mergeList<T extends Stamped>(a: T[], b: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const cur = byId.get(x.id);
    if (!cur || x.updatedAt > cur.updatedAt) byId.set(x.id, x);
  }
  return [...byId.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= x.updatedAt));
}

/**
 * Merge two copies of the same timeline edited on different devices.
 * Per-record last-writer-wins by updatedAt; a deletion wins over any edit made
 * before it. Right for one person across devices (see docs/decisions.md);
 * it is NOT a multi-user collaborative merge.
 */
export function mergeDocs(a: TimelineDoc, b: TimelineDoc): TimelineDoc {
  const deleted: Record<string, number> = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, t);
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const catById = new Map([...b.categories, ...a.categories].map((c) => [c.id, c]));
  for (const c of newer.categories) catById.set(c.id, c);
  return {
    ...newer,
    categories: [...catById.values()],
    items: mergeList(a.items, b.items, deleted),
    series: mergeList(a.series, b.series, deleted),
    territories: mergeList(a.territories, b.territories, deleted),
    notes: mergeList(a.notes, b.notes, deleted),
    sources: mergeList(a.sources, b.sources, deleted),
    relations: mergeList(a.relations, b.relations, deleted),
    deleted,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}
