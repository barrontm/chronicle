import { isArea, labelPoint } from '../data/geo';
import { isValidHistDate, compareHistDate } from './dates';
import {
  DIMENSIONS,
  LANES,
  OVERVIEW_MARKS,
  SCHEMA_VERSION,
  SUBJECT_KINDS,
  type Citation,
  type Excerpt,
  type Highlight,
  type Flow,
  type FlowCause,
  type FlowEnd,
  type ItemKind,
  type Lane,
  type Dimension,
  type Note,
  type PolityGroup,
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
    highlights: [],
    notes: [],
    sources: [],
    relations: [],
    groups: [],
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

/** Problems with a `lanes` list: not an array, or a lane that isn't one of the six. */
function checkLanes(owner: string, lanes: unknown): string[] {
  if (lanes === undefined) return [];
  if (!Array.isArray(lanes)) return [`${owner} has malformed lanes`];
  return lanes.filter((l) => !LANES.includes(l)).map((l) => `${owner} has unknown lane "${l}"`);
}

export function validateItem(item: TimelineItem, categoryIds: Set<string>): string[] {
  const p: string[] = [];
  const name = item.title ? `"${item.title}"` : `item ${item.id}`;
  if (!item.id) p.push('an item is missing its id');
  if (!item.title?.trim()) p.push(`${name} has no title`);
  if (!KINDS.includes(item.kind)) p.push(`${name} has unknown kind "${item.kind}"`);
  // A place may have no dates (on the map, not the timeline), or only its founding (still there).
  const place = item.subject === 'place';
  if (item.start ? !isValidHistDate(item.start) : !place) p.push(`${name} has an invalid start date`);
  if (item.end && !isValidHistDate(item.end)) p.push(`${name} has an invalid end date`);
  if (item.kind === 'span' && !item.end && !place) p.push(`${name} is a span but has no end date`);
  if (item.kind === 'event' && item.end) p.push(`${name} is an event but has an end date`);
  if (item.start && item.end && isValidHistDate(item.start) && isValidHistDate(item.end) && compareHistDate(item.end, item.start) < 0) {
    p.push(`${name} ends before it starts`);
  }
  if (!categoryIds.has(item.categoryId)) p.push(`${name} uses unknown category "${item.categoryId}"`);
  for (const pl of item.places ?? []) {
    if (!Number.isFinite(pl.lat) || !Number.isFinite(pl.lon) || Math.abs(pl.lat) > 90 || Math.abs(pl.lon) > 180) p.push(`${name} has a place with invalid coordinates`);
  }
  if (item.dimension !== undefined && !DIMENSIONS.includes(item.dimension)) p.push(`${name} has unknown dimension "${item.dimension}"`);
  p.push(...checkLanes(name, item.lanes));
  if (item.overview !== undefined && !OVERVIEW_MARKS.includes(item.overview)) p.push(`${name} has an unknown overview mark "${item.overview}"`);
  if (item.subject !== undefined && !SUBJECT_KINDS.includes(item.subject)) p.push(`${name} is an unknown kind of thing "${item.subject}"`);
  if (item.region !== undefined && typeof item.region !== 'string') p.push(`${name} has a malformed region`);
  for (const t of item.themes ?? []) {
    if (!t.label?.trim()) p.push(`${name} has a theme with no label`);
    if (!Array.isArray(t.highlightIds)) p.push(`${name} has a theme with malformed highlights`);
  }
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
  if (t.region !== undefined && typeof t.region !== 'string') p.push(`${name} has a malformed region`);
  if (t.strength !== undefined) {
    if (!Array.isArray(t.strength)) p.push(`${name} has malformed strength`);
    else for (const s of t.strength) {
      if (!s?.at || !isValidHistDate(s.at)) p.push(`${name} has a strength point with an invalid date`);
      if (![1, 2, 3, 4, 5].includes(s?.level)) p.push(`${name} has a strength level that isn't 1 to 5`);
      if (s?.highlightIds !== undefined && !Array.isArray(s.highlightIds)) p.push(`${name} has a strength point with malformed highlights`);
    }
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
  for (const it of doc.items) checkCitations(`"${it.title}"`, it.citations);
  for (const h of doc.highlights) {
    checkUnique(h.id);
    if (!h.text?.trim()) p.push(`highlight ${h.id} is empty`);
    if (!sourceIds.has(h.sourceId)) p.push(`highlight ${h.id} quotes unknown source "${h.sourceId}"`);
    if (!Array.isArray(h.usedBy)) p.push(`highlight ${h.id} has malformed links`);
    if (h.dimension !== undefined && !DIMENSIONS.includes(h.dimension)) p.push(`highlight ${h.id} has unknown dimension "${h.dimension}"`);
    p.push(...checkLanes(`highlight ${h.id}`, h.lanes));
    if (h.anchor !== undefined && typeof h.anchor?.exact !== 'string') p.push(`highlight ${h.id} has a malformed anchor`);
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
    if (r.highlightIds !== undefined && !Array.isArray(r.highlightIds)) p.push(`connection ${r.id} has malformed evidence`);
    if (r.side !== undefined && r.side !== 1 && r.side !== 2) p.push(`connection ${r.id} has a side that isn't 1 or 2`);
  }
  for (const g of doc.groups ?? []) {
    checkUnique(g.id);
    if (!g.id || !g.title?.trim()) p.push('a group is missing its id or title');
    if (!Array.isArray(g.territoryIds)) p.push(`group "${g.title}" has malformed members`);
  }
  if (doc.regionParents !== undefined) {
    const rp = doc.regionParents;
    if (!rp || typeof rp !== 'object' || Array.isArray(rp) || Object.values(rp).some((v) => typeof v !== 'string')) p.push('the region parents are malformed');
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
  if (r.schemaVersion === 5) r = migrate5to6(r);
  if (r.schemaVersion === 6) r = migrate6to7(r);
  if (r.schemaVersion === 7) r = migrate7to8(r);
  if (r.schemaVersion === 8) r = migrate8to9(r);
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
    highlights: r.highlights ?? [],
    groups: r.groups ?? [],
    ...(r.regionParents ? { regionParents: r.regionParents } : {}),
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

/**
 * v6 adds highlights (and dimensions, period themes, connection effects and
 * evidence, all optional). Each entry's quoted excerpt becomes a highlight used
 * by that entry. Its id comes from the entry's, so two devices that upgrade
 * the same timeline make the same highlight and merging doesn't double it.
 */
function migrate5to6(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  const highlights: Highlight[] = [...(r.highlights ?? [])];
  const items = (r.items ?? []).map((it) => {
    const { excerpt, ...rest } = it as typeof it & { excerpt?: Excerpt };
    if (excerpt?.text?.trim() && excerpt.sourceId) {
      highlights.push({ id: `h_${it.id}`, sourceId: excerpt.sourceId, text: excerpt.text, usedBy: [it.id], updatedAt: it.updatedAt });
    }
    return rest;
  });
  return { ...r, schemaVersion: 6, items, highlights };
}

/** v7 adds optional `subject` and `region` on entries; older entries keep neither and draw as their `kind`. */
function migrate6to7(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 7 };
}

/** v8 lets a place (`subject: 'place'`) have no dates, or only its founding; every v7 entry is already valid. */
function migrate7to8(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  return { ...r, schemaVersion: 8 };
}

/** The lane a v8 dimension became. Social has none: those are left to the automatic sort. */
const LANE_OF_DIMENSION: Record<Dimension, Lane | undefined> = {
  political: 'politics', economic: 'economy', intellectual: 'ideas', religious: 'ideas', technological: 'technology', social: undefined,
};

/**
 * v9 adds lanes, the overview mark, territories' region and strength, polity groups, region
 * parents and a connection's side. Entries and highlights get `lanes` from their `dimension`,
 * which stays so nothing is lost; a territory takes its period's region. Nothing is restamped,
 * so two devices that upgrade the same timeline still merge cleanly.
 */
function migrate8to9(r: Partial<TimelineDoc>): Partial<TimelineDoc> {
  const withLanes = <T extends { dimension?: Dimension; lanes?: Lane[] }>(x: T): T => {
    const lane = x.dimension && LANE_OF_DIMENSION[x.dimension];
    return lane && !x.lanes ? { ...x, lanes: [lane] } : x;
  };
  const items = (r.items ?? []).map(withLanes);
  const regionOf = new Map(items.filter((it) => it.region?.trim()).map((it) => [it.id, it.region!]));
  const territories = (r.territories ?? []).map((t) => {
    const region = t.itemId ? regionOf.get(t.itemId) : undefined;
    return region && !t.region ? { ...t, region } : t;
  });
  return { ...r, schemaVersion: 9, items, territories, highlights: (r.highlights ?? []).map(withLanes), groups: r.groups ?? [] };
}

export function serializeDoc(doc: TimelineDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ---------- Mutations (pure; return a new doc) ----------

/** The collections of id'd, timestamped records inside a doc. */
export type Collection = 'items' | 'series' | 'territories' | 'flows' | 'notes' | 'sources' | 'relations' | 'highlights' | 'groups';
export type RecordOf<C extends Collection> = {
  items: TimelineItem;
  series: Series;
  territories: Territory;
  flows: Flow;
  notes: Note;
  sources: Source;
  relations: Relation;
  highlights: Highlight;
  groups: PolityGroup;
}[C];

export function upsert<C extends Collection>(doc: TimelineDoc, collection: C, record: RecordOf<C>, now = Date.now()): TimelineDoc {
  const list = (doc[collection] ?? []) as RecordOf<C>[];
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
 *  - deleting a record unlinks its highlights (they stay, as quotes from their source)
 *  - deleting a source deletes the highlights quoted from it (an unattributed quote is worse than none)
 *  - deleting a highlight drops it from connections' evidence and periods' themes
 * Notes themselves are never deleted as a side effect; your writing is kept.
 */
export function remove(doc: TimelineDoc, collection: Collection, id: string, now = Date.now()): TimelineDoc {
  const deleted = { ...doc.deleted, [id]: now };
  let next: TimelineDoc = { ...doc, [collection]: ((doc[collection] ?? []) as { id: string }[]).filter((r) => r.id !== id), deleted, updatedAt: now };

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
    next = {
      ...next,
      series,
      flows: next.flows.map((f) => detachTerritory(f, doc.territories.find((t) => t.id === id), now)),
      groups: next.groups?.map((g) => (g.territoryIds.includes(id) ? { ...g, territoryIds: g.territoryIds.filter((x) => x !== id), updatedAt: now } : g)),
    };
  }
  if (collection === 'sources') {
    const strip = <T extends { citations?: Citation[]; updatedAt: number }>(r: T): T =>
      r.citations?.some((c) => c.sourceId === id) ? { ...r, citations: r.citations.filter((c) => c.sourceId !== id), updatedAt: now } : r;
    next = { ...next, items: next.items.map(strip), notes: next.notes.map(strip) };
    for (const h of next.highlights.filter((x) => x.sourceId === id)) next = remove(next, 'highlights', h.id, now);
  }
  if (collection === 'highlights') {
    next = {
      ...next,
      relations: next.relations.map((r) => (r.highlightIds?.includes(id) ? { ...r, highlightIds: r.highlightIds.filter((x) => x !== id), updatedAt: now } : r)),
      items: next.items.map((it) => (it.themes?.some((t) => t.highlightIds.includes(id))
        ? { ...it, themes: it.themes.map((t) => ({ ...t, highlightIds: t.highlightIds.filter((x) => x !== id) })), updatedAt: now }
        : it)),
      territories: next.territories.map((t) => (t.strength?.some((s) => s.highlightIds?.includes(id))
        ? { ...t, strength: t.strength.map((s) => (s.highlightIds?.includes(id) ? { ...s, highlightIds: s.highlightIds.filter((x) => x !== id) } : s)), updatedAt: now }
        : t)),
    };
  } else {
    next = { ...next, highlights: next.highlights.map((h) => (h.usedBy.includes(id) ? { ...h, usedBy: h.usedBy.filter((x) => x !== id), updatedAt: now } : h)) };
  }
  return { ...next, deleted: { ...next.deleted, ...deleted } };
}

/** Route ends at a deleted territory become named points where its latest borders were labeled. */
function detachTerritory(f: Flow, t: Territory | undefined, now: number): Flow {
  if (!t || !f.routes.some((r) => ('territoryId' in r.from && r.from.territoryId === t.id) || ('territoryId' in r.to && r.to.territoryId === t.id))) return f;
  const shape = [...t.snapshots].reverse().find((s) => s.geometry)?.geometry;
  const swap = (e: FlowEnd): FlowEnd => ('territoryId' in e && e.territoryId === t.id && shape ? { name: t.title, ...labelPoint(shape) } : e);
  return { ...f, routes: f.routes.map((r) => ({ ...r, from: swap(r.from), to: swap(r.to) })), updatedAt: now };
}

// ---------- Queries ----------

/** Highlights behind a record: the quotes that justify it. */
export function highlightsFor(doc: TimelineDoc, id: string): Highlight[] {
  return doc.highlights.filter((h) => h.usedBy.includes(id));
}

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

// ---------- Influences between lanes ----------

/** The effects the connection editor offers first, in this order (`docs/design.md`). */
export const EFFECTS = ['caused', 'enabled', 'prompted', 'funded', 'strengthened', 'weakened', 'legitimised', 'ended'] as const;

/** The effect vocabulary: the usual words, then Bob's own words from his connections, each once. */
export function effectWords(relations: readonly Relation[]): string[] {
  const words: string[] = [...EFFECTS];
  for (const r of relations) {
    const w = r.effect?.trim().toLowerCase();
    if (w && !words.includes(w)) words.push(w);
  }
  return words;
}

/** How one acted on the other, read from the cause ("Weakened") or from the effect ("Weakened by"). */
export function describeEffect(r: Pick<Relation, 'type' | 'effect'>, direction: 'out' | 'in'): string {
  const w = r.effect?.trim();
  if (!w) return describeRelation(r.type, direction);
  const cap = w[0].toUpperCase() + w.slice(1);
  return direction === 'out' ? cap : `${cap} by`;
}

/** A connection between entries in different lanes: from the cause's lane to the effect's (see `laneInfluence`). */
export interface LaneInfluence { r: Relation; from: Lane; to: Lane }

/**
 * Whether a connection is an influence between lanes, and which lanes its arrow joins. `lanesOf`
 * is each entry's lanes (`entryLanes`). "Part of" links and links inside one lane aren't.
 */
export function laneInfluence(r: Relation, lanesOf: ReadonlyMap<string, readonly Lane[]>): LaneInfluence | undefined {
  if (r.type === 'part-of' || r.fromId === r.toId) return undefined;
  const a = lanesOf.get(r.fromId) ?? [], b = lanesOf.get(r.toId) ?? [];
  // It leaves the cause's first lane and lands in the effect's first lane the cause isn't in (else the first that's
  // different): League treasury (Politics, Economy) funded the Parthenon (Economy, Philosophy and religion) lands in the latter.
  const from = a[0];
  const to = b.find((l) => !a.includes(l)) ?? b.find((l) => l !== from);
  return from && to ? { r, from, to } : undefined;
}

/** Every influence between lanes, optionally only those with both ends in `ids`. */
export function laneInfluences(relations: readonly Relation[], lanesOf: ReadonlyMap<string, readonly Lane[]>, ids?: ReadonlySet<string>): LaneInfluence[] {
  const out: LaneInfluence[] = [];
  for (const r of relations) {
    if (ids && !(ids.has(r.fromId) && ids.has(r.toId))) continue;
    const inf = laneInfluence(r, lanesOf);
    if (inf) out.push(inf);
  }
  return out;
}

/** An entry's effects on other lanes, both ways: what it acted on (`on`) and what acted on it (`by`). */
export function effectsOf(relations: readonly Relation[], lanesOf: ReadonlyMap<string, readonly Lane[]>, id: string): { on: LaneInfluence[]; by: LaneInfluence[] } {
  const mine = laneInfluences(relations.filter((r) => r.fromId === id || r.toId === id), lanesOf);
  return { on: mine.filter((x) => x.r.fromId === id), by: mine.filter((x) => x.r.toId === id) };
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
    highlights: mergeList(a.highlights ?? [], b.highlights ?? [], deleted),
    groups: mergeList(a.groups ?? [], b.groups ?? [], deleted),
    // A region's parent is open vocabulary with no stamp of its own: the newer copy wins per region.
    ...(a.regionParents || b.regionParents ? { regionParents: { ...(newer === a ? b : a).regionParents, ...newer.regionParents } } : {}),
    deleted,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

/** The territory Bob picked as where an era was on the map: one linked to it as `part of`. */
export function eraTerritory(doc: Pick<TimelineDoc, 'relations' | 'territories'>, eraId: string): Territory | undefined {
  const r = doc.relations.find((x) => x.type === 'part-of' && x.toId === eraId && doc.territories.some((t) => t.id === x.fromId));
  return r && doc.territories.find((t) => t.id === r.fromId);
}

/** Make a territory where an era was on the map (a `part of` connection), or, with none, go back to where its entries are. */
export function setEraTerritory(doc: TimelineDoc, eraId: string, territoryId: string | undefined, now = Date.now()): TimelineDoc {
  let next = doc;
  for (const r of doc.relations) {
    if (r.type !== 'part-of' || r.toId !== eraId || !doc.territories.some((t) => t.id === r.fromId)) continue;
    if (r.fromId === territoryId) return next;
    next = remove(next, 'relations', r.id, now);
  }
  return territoryId ? upsert(next, 'relations', { id: newId('r'), fromId: territoryId, toId: eraId, type: 'part-of', updatedAt: now }, now) : next;
}

/**
 * Set a region's parent (Greece → Mediterranean), or with none, take it away. Region parents are
 * Bob's words with no record of their own, so this stamps the doc rather than going through `upsert`.
 */
export function setRegionParent(doc: TimelineDoc, region: string, parent: string | undefined, now = Date.now()): TimelineDoc {
  const r = region.trim(), p = parent?.trim();
  if (!r || (doc.regionParents?.[r] ?? '') === (p ?? '')) return doc;
  const next = { ...doc.regionParents };
  if (p && p !== r) next[r] = p;
  else delete next[r];
  return { ...doc, regionParents: next, updatedAt: now };
}
