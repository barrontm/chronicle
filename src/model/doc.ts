import { isArea, labelPoint } from '../data/geo';
import { isValidHistDate, compareHistDate } from './dates';
import {
  SCHEMA_VERSION,
  type Citation,
  type Flow,
  type FlowCause,
  type FlowEnd,
  type ItemKind,
  type Note,
  type Provenance,
  type Relation,
  type RelationType,
  type Series,
  type SeriesPoint,
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
    flows: [],
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

function checkPoints(label: string, pts: SeriesPoint[], scale: Series['scale']): string[] {
  if (pts.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.v))) return [`${label} has non-numeric points`];
  if (scale === 'log' && pts.some((pt) => pt.v <= 0)) return [`${label} is log-scale but has values ≤ 0`];
  return [];
}

export function validateSeries(s: Series, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  const name = `series "${s.title}"`;
  if (!s.id || !s.title) p.push('a series is missing its id or title');
  if (!categoryIds.has(s.categoryId)) p.push(`${name} uses unknown category "${s.categoryId}"`);
  const regions = Object.entries(s.regions ?? {});
  if (!Array.isArray(s.points)) p.push(`${name} has malformed points`);
  // A map-only series (values per country, no world curve) is fine; otherwise a curve needs two points.
  else if (s.points.length < 2 && !regions.length) p.push(`${name} needs at least two points`);
  else p.push(...checkPoints(name, s.points, s.scale));
  for (const [key, pts] of regions) {
    if (!Array.isArray(pts)) p.push(`${name} has malformed values for "${key}"`);
    else p.push(...checkPoints(`${name} (${key})`, pts, s.scale));
  }
  return p;
}

export function validateTerritory(t: Territory, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  const name = t.title ? `territory "${t.title}"` : `territory ${t.id}`;
  if (!t.id || !t.title?.trim()) p.push('a territory is missing its id or title');
  if (!categoryIds.has(t.categoryId)) p.push(`${name} uses unknown category "${t.categoryId}"`);
  if (!Array.isArray(t.snapshots)) return [...p, `${name} has malformed snapshots`];
  for (const s of t.snapshots) {
    if (!s.from || !isValidHistDate(s.from) || (s.to && !isValidHistDate(s.to))) p.push(`${name} has a snapshot with an invalid date`);
    if (s.geometry !== undefined && !isArea(s.geometry)) p.push(`${name} has a snapshot that isn't a polygon`);
  }
  return p;
}

export const FLOW_CAUSES: FlowCause[] = ['conflict', 'economic', 'disaster', 'forced', 'settlement', 'family', 'unknown'];

function validEnd(e: FlowEnd | undefined): boolean {
  if (!e || typeof e !== 'object') return false;
  if ('country' in e) return /^[A-Z]{3}$/.test(e.country);
  // A territory that was deleted on another device is tolerated; the route just isn't drawn.
  if ('territoryId' in e) return typeof e.territoryId === 'string' && !!e.territoryId;
  return Number.isFinite(e.lat) && Number.isFinite(e.lon) && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180;
}

export function validateFlow(f: Flow, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  const name = f.title ? `migration "${f.title}"` : `migration ${f.id}`;
  if (!f.id || !f.title?.trim()) p.push('a migration is missing its id or title');
  if (!categoryIds.has(f.categoryId)) p.push(`${name} uses unknown category "${f.categoryId}"`);
  if (!FLOW_CAUSES.includes(f.cause)) p.push(`${name} has unknown cause "${f.cause}"`);
  if (f.measure !== 'moved' && f.measure !== 'living') p.push(`${name} has unknown measure "${f.measure}"`);
  if (!Array.isArray(f.routes)) return [...p, `${name} has malformed routes`];
  for (const r of f.routes) {
    if (!validEnd(r.from) || !validEnd(r.to)) p.push(`${name} has a route with an invalid end`);
    if (!Array.isArray(r.points) || r.points.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.v) || pt.v < 0)) p.push(`${name} has a route with invalid numbers`);
  }
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
  for (const t of doc.territories) {
    checkUnique(t.id);
    p.push(...validateTerritory(t, catIds));
  }
  for (const f of doc.flows) {
    checkUnique(f.id);
    p.push(...validateFlow(f, catIds));
  }
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
  const checkDrafted = (owner: string, d: unknown) => {
    if (d === undefined) return;
    const v = d as Provenance;
    if (!v || typeof v.model !== 'string' || typeof v.prompt !== 'string' || !Number.isFinite(v.draftedAt)) p.push(`${owner} has malformed draft details`);
  };
  for (const it of doc.items) checkDrafted(`"${it.title}"`, it.drafted);
  for (const t of doc.territories) checkDrafted(`territory "${t.title}"`, t.drafted);
  for (const f of doc.flows) checkDrafted(`migration "${f.title}"`, f.drafted);
  for (const r of doc.relations) {
    checkUnique(r.id);
    checkDrafted(`connection ${r.id}`, r.drafted);
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
  if (r.schemaVersion === 2) r = migrate2to3(r);
  if (r.schemaVersion === 3) r = migrate3to4(r);
  if (r.schemaVersion === 4) r = migrate4to5(r);
  const doc: TimelineDoc = {
    schemaVersion: SCHEMA_VERSION,
    id: r.id ?? newId('doc'),
    title: r.title ?? 'Imported timeline',
    categories: r.categories ?? [],
    items: r.items ?? [],
    series: r.series ?? [],
    territories: r.territories ?? [],
    flows: r.flows ?? [],
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
 * A doc saved on this device, possibly by an older or newer version of the
 * app. Older docs go through the same migrations as imported files; a newer
 * one is returned untouched so the caller can open it read-only and never
 * write an older shape over it.
 */
export function openStoredDoc(raw: unknown): { doc: TimelineDoc; status: 'current' | 'upgraded' | 'newer' } {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof v === 'number' && v > SCHEMA_VERSION) return { doc: raw as TimelineDoc, status: 'newer' };
  if (v === SCHEMA_VERSION) return { doc: raw as TimelineDoc, status: 'current' };
  return { doc: parseDoc(JSON.stringify(raw)), status: 'upgraded' };
}

/**
 * v2 adds optional fields only (item places, excerpt and wikidataId; source
 * accessed date), so a v1 doc is already a valid v2 doc.
 */
function migrate1to2(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 2 };
}

/**
 * v3 types territory geometry and adds optional territory itemId/wikidataId
 * and series regions. v2 territories were never drawn, so any geometry that
 * isn't a polygon is dropped rather than failing the import.
 */
function migrate2to3(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return {
    ...r,
    schemaVersion: 3,
    territories: (r.territories ?? []).map((t) => ({
      ...t,
      snapshots: (t.snapshots ?? []).map((s) => (s.geometry === undefined || isArea(s.geometry) ? s : { ...s, geometry: undefined })),
    })),
  };
}

/** v4 adds migration flows. */
function migrate3to4(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 4, flows: r.flows ?? [] };
}

/** v5 adds optional `drafted` provenance on entries, connections, territories and flows. */
function migrate4to5(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 5 };
}

export function serializeDoc(doc: TimelineDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ---------- Mutations (pure; return a new doc) ----------

/** The collections of id'd, timestamped records inside a doc. */
export type Collection = 'items' | 'series' | 'territories' | 'flows' | 'notes' | 'sources' | 'relations';
type RecordOf<C extends Collection> = {
  items: TimelineItem;
  series: Series;
  territories: Territory;
  flows: Flow;
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
 *  - deleting an entry unlinks its migrations; deleting a territory turns
 *    route ends there into named points, so the routes stay on the map
 * Notes themselves are never deleted as a side effect; your writing is kept.
 */
export function remove(doc: TimelineDoc, collection: Collection, id: string, now = Date.now()): TimelineDoc {
  const deleted = { ...doc.deleted, [id]: now };
  let next: TimelineDoc = { ...doc, [collection]: (doc[collection] as { id: string }[]).filter((r) => r.id !== id), deleted, updatedAt: now };

  if (collection === 'items' || collection === 'series' || collection === 'territories' || collection === 'flows') {
    const dropped = next.relations.filter((r) => r.fromId === id || r.toId === id);
    for (const r of dropped) deleted[r.id] = now;
    next = {
      ...next,
      relations: next.relations.filter((r) => r.fromId !== id && r.toId !== id),
      notes: next.notes.map((n) => (n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id), updatedAt: now } : n)),
    };
  }
  if (collection === 'items') {
    next = {
      ...next,
      territories: next.territories.map((t) => (t.itemId === id ? { ...t, itemId: undefined, updatedAt: now } : t)),
      flows: next.flows.map((f) => (f.itemId === id ? { ...f, itemId: undefined, updatedAt: now } : f)),
    };
  }
  if (collection === 'territories') {
    // Values recorded for the territory go with it; the rest of the trend stays,
    // unless nothing is left of it.
    const series: Series[] = [];
    for (const s of next.series) {
      if (!s.regions || !(id in s.regions)) { series.push(s); continue; }
      const { [id]: _gone, ...regions } = s.regions;
      if (s.points.length < 2 && !Object.keys(regions).length) deleted[s.id] = now;
      else series.push({ ...s, regions, updatedAt: now });
    }
    next = { ...next, series, flows: next.flows.map((f) => detachTerritory(f, doc.territories.find((t) => t.id === id), now)) };
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

/** Route ends at a deleted territory become named points where its latest borders were labeled. */
function detachTerritory(f: Flow, t: Territory | undefined, now: number): Flow {
  if (!t || !f.routes.some((r) => ('territoryId' in r.from && r.from.territoryId === t.id) || ('territoryId' in r.to && r.to.territoryId === t.id))) return f;
  const shape = [...t.snapshots].reverse().find((s) => s.geometry)?.geometry;
  const swap = (e: FlowEnd): FlowEnd => ('territoryId' in e && e.territoryId === t.id && shape ? { name: t.title, ...labelPoint(shape) } : e);
  return { ...f, routes: f.routes.map((r) => ({ ...r, from: swap(r.from), to: swap(r.to) })), updatedAt: now };
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

/** Who influenced `id` (by) and whom `id` influenced (on), from "influenced" connections. */
export function influencesOf(relations: Relation[], id: string): { by: string[]; on: string[] } {
  const infl = relations.filter((r) => r.type === 'influenced');
  return {
    by: infl.filter((r) => r.toId === id).map((r) => r.fromId),
    on: infl.filter((r) => r.fromId === id).map((r) => r.toId),
  };
}

export interface BibliographyEntry {
  source: Source;
  locator?: string;
  /** Where the citation was found, for sources not cited by the entry itself: a note's or a connected entry's title. */
  via?: string;
}

/** Lowercase, accents and punctuation dropped, so "Aristotélēs" and "aristoteles" match. */
function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Whether an authors field ("Durant, Will; Durant, Ariel", "Plato, trans. Grube")
 * names this person: the whole name, its "Last, First" form, or the name as
 * whole words within one author.
 */
export function authoredBy(authors: string | undefined, person: string): boolean {
  const name = normalizeName(person);
  if (!authors || !name) return false;
  return authors.split(/;|&|\band\b/i).some((raw) => {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const reversed = parts.length >= 2 ? normalizeName(`${parts[1]} ${parts[0]}`) : undefined;
    const a = normalizeName(raw);
    return a === name || reversed === name || ` ${a} `.includes(` ${name} `);
  });
}

/**
 * Everything to read on an entry: sources it cites, sources cited by notes about
 * it and by entries connected to it, and, for a person, sources they wrote.
 */
export function bibliographyFor(doc: TimelineDoc, id: string): { cited: BibliographyEntry[]; related: BibliographyEntry[]; works: Source[] } {
  const item = doc.items.find((i) => i.id === id);
  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const cited = (item?.citations ?? []).flatMap((c) => {
    const source = sources.get(c.sourceId);
    return source ? [{ source, locator: c.locator }] : [];
  });
  const seen = new Set(cited.map((e) => e.source.id));
  const related: BibliographyEntry[] = [];
  const addFrom = (citations: Citation[] | undefined, via: string) => {
    for (const c of citations ?? []) {
      const source = sources.get(c.sourceId);
      if (!source || seen.has(source.id)) continue;
      seen.add(source.id);
      related.push({ source, locator: c.locator, via });
    }
  };
  for (const n of notesFor(doc, id)) addFrom(n.citations, n.title);
  const { outgoing, incoming } = relationsFor(doc, id);
  for (const otherId of [...outgoing.map((r) => r.toId), ...incoming.map((r) => r.fromId)]) {
    const other = doc.items.find((i) => i.id === otherId);
    if (other) addFrom(other.citations, other.title);
  }
  const works = item?.kind === 'person' ? doc.sources.filter((s) => authoredBy(s.authors, item.title)) : [];
  return { cited, related, works };
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
    flows: mergeList(a.flows ?? [], b.flows ?? [], deleted),
    notes: mergeList(a.notes, b.notes, deleted),
    sources: mergeList(a.sources, b.sources, deleted),
    relations: mergeList(a.relations, b.relations, deleted),
    deleted,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}
