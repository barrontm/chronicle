import { compareHistDate } from '../model/dates';
import { newId } from '../model/doc';
import {
  P, classParentsQuery, classesToFetch, claimsFor, coordsOf, dateClaim, factRelations, firstValue, idOf, idsOf, linkedIds,
  parseClassParents, parseSubjectEntity, toSubject, type ClassParents, type Claims, type Subject,
} from '../model/subjects';
import type { Highlight, HistDate, ItemKind, Place, Relation, Source, TimelineItem } from '../model/types';
import { fetchCommonsFile, resultToMedia } from './commons';

/**
 * Add an entry from Wikipedia. Three anonymous CORS endpoints:
 *  - Wikipedia search (title, short description, thumbnail)
 *  - Wikipedia page summary (intro text, Wikidata id, coordinates)
 *  - Wikidata claims (dates with their precision, human or not, places, image)
 * Parsers are pure so they can be tested against saved responses.
 */
const WIKI = 'https://en.wikipedia.org';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WDQS = 'https://query.wikidata.org/sparql';

// Wikidata items we read (properties are in model/subjects).
const HUMAN = 'Q5';

export interface WikiSearchResult {
  /** Page key for URLs, e.g. "Battle_of_Marathon". */
  key: string;
  title: string;
  description?: string;
  thumbUrl?: string;
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract?: string;
  qid?: string;
  pageUrl: string;
  coords?: { lat: number; lon: number };
}

/** What Wikidata tells us about an entity, before any further lookups. */
export interface WikidataFacts {
  isHuman: boolean;
  born?: HistDate;
  died?: HistDate;
  start?: HistDate;
  end?: HistDate;
  pointInTime?: HistDate;
  coords?: { lat: number; lon: number };
  imageFile?: string;
  birthPlaceId?: string;
  deathPlaceId?: string;
  locationId?: string;
  /** Wikidata ids of people this one was influenced by (P737). */
  influencedByIds: string[];
}

/** An entry ready for the editor, plus any sources it cites that aren't saved yet. */
export interface ItemDraft {
  item: TimelineItem;
  newSources: Source[];
  /** Connections to entries already on the timeline, suggested by Wikidata. */
  relations?: Relation[];
  /** The page's intro, quoted, saved as a highlight used by the entry. */
  highlight?: Highlight;
}

export function buildSearchUrl(query: string, limit = 10): string {
  return `${WIKI}/w/rest.php/v1/search/page?${new URLSearchParams({ q: query, limit: String(limit) })}`;
}

export function buildSummaryUrl(key: string): string {
  return `${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(key)}`;
}

export function buildEntityUrl(qid: string): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'claims', format: 'json', origin: '*' })}`;
}

/** An article's Wikidata item, found by its English Wikipedia title (redirects followed). */
export function buildSubjectUrl(title: string): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', sites: 'enwiki', titles: title.replace(/_/g, ' '), normalize: '1', props: 'claims|labels', languages: 'en', format: 'json', origin: '*' })}`;
}

/** P279 parents of some classes, from the query service (the API would send each class's every claim). */
export function buildClassParentsUrl(classIds: string[]): string {
  return `${WDQS}?${new URLSearchParams({ query: classParentsQuery(classIds), format: 'json' })}`;
}

/** Just the coordinates of one place, so we don't download a whole city's claims. */
export function buildCoordsUrl(qid: string): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetclaims', entity: qid, property: P.coords, format: 'json', origin: '*' })}`;
}

export function buildLabelsUrl(qids: string[]): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', ids: qids.join('|'), props: 'labels', languages: 'en', format: 'json', origin: '*' })}`;
}

/** Labels plus English Wikipedia page titles, so a suggestion can be added from Wikipedia. */
export function buildLabelsAndPagesUrl(qids: string[]): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', ids: qids.join('|'), props: 'labels|sitelinks', sitefilter: 'enwiki', languages: 'en', format: 'json', origin: '*' })}`;
}

/** Pages matching a place name, with their coordinates and short description, in one request. */
export function buildPlaceSearchUrl(query: string, limit = 8): string {
  return `${WIKI}/w/api.php?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query, gsrlimit: String(limit), gsrnamespace: '0',
    prop: 'coordinates|description', coprimary: 'primary', format: 'json', formatversion: '2', origin: '*',
  })}`;
}

/** Everyone whose "influenced by" (P737) names this person. */
export function buildInfluencedSearchUrl(qid: string): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:${P.influencedBy}=${qid}`, srlimit: '50', srnamespace: '0', format: 'json', origin: '*' })}`;
}

const https = (u: string | undefined) => (u?.startsWith('//') ? `https:${u}` : u);

export function parseSearch(json: unknown): WikiSearchResult[] {
  const pages = (json as { pages?: Array<{ key: string; title: string; description?: string | null; thumbnail?: { url?: string } | null }> })?.pages;
  return (pages ?? []).map((p) => ({
    key: p.key,
    title: p.title,
    description: p.description ?? undefined,
    thumbUrl: https(p.thumbnail?.url),
  }));
}

export function parseSummary(json: unknown): WikiSummary {
  const j = json as {
    title?: string; description?: string; extract?: string; wikibase_item?: string;
    content_urls?: { desktop?: { page?: string } }; coordinates?: { lat: number; lon: number };
  };
  if (!j?.title) throw new Error('Wikipedia sent back a page we couldn’t read. Try another result.');
  return {
    title: j.title,
    description: j.description || undefined,
    extract: j.extract?.trim() || undefined,
    qid: j.wikibase_item || undefined,
    pageUrl: j.content_urls?.desktop?.page ?? `${WIKI}/wiki/${encodeURIComponent(j.title.replace(/ /g, '_'))}`,
    coords: j.coordinates ? { lat: j.coordinates.lat, lon: j.coordinates.lon } : undefined,
  };
}

export function parseEntity(json: unknown, qid: string): WikidataFacts {
  const claims = (json as { entities?: Record<string, { claims?: Claims }> })?.entities?.[qid]?.claims ?? {};
  return {
    isHuman: claimsFor(claims, P.instanceOf).some((c) => (c.mainsnak?.datavalue?.value as { id?: string })?.id === HUMAN),
    born: dateClaim(claims, P.born),
    died: dateClaim(claims, P.died),
    start: dateClaim(claims, P.start) ?? dateClaim(claims, P.inception),
    end: dateClaim(claims, P.end) ?? dateClaim(claims, P.dissolved),
    pointInTime: dateClaim(claims, P.pointInTime),
    coords: coordsOf(claims),
    imageFile: firstValue<string>(claims, P.image),
    birthPlaceId: idOf(claims, P.birthPlace),
    deathPlaceId: idOf(claims, P.deathPlace),
    locationId: idOf(claims, P.location),
    influencedByIds: idsOf(claims, P.influencedBy),
  };
}

/** wbgetclaims response → coordinates, if the place has any. */
export function parseCoords(json: unknown): { lat: number; lon: number } | undefined {
  return coordsOf((json as { claims?: Claims })?.claims ?? {});
}

export function parseLabels(json: unknown): Record<string, string> {
  const entities = (json as { entities?: Record<string, { labels?: { en?: { value?: string } } }> })?.entities ?? {};
  return Object.fromEntries(Object.entries(entities).flatMap(([id, e]) => (e.labels?.en?.value ? [[id, e.labels.en.value]] : [])));
}

/** Search results from `buildInfluencedSearchUrl` → Wikidata ids. */
export function parseInfluencedSearch(json: unknown): string[] {
  const hits = (json as { query?: { search?: Array<{ title?: string }> } })?.query?.search ?? [];
  return hits.flatMap((h) => (h.title && /^Q\d+$/.test(h.title) ? [h.title] : []));
}

export interface PlaceResult {
  name: string;
  description?: string;
  lat: number;
  lon: number;
}

/** `buildPlaceSearchUrl` response → pages that have coordinates, best match first. */
export function parsePlaceSearch(json: unknown): PlaceResult[] {
  type Page = { title?: string; index?: number; description?: string; coordinates?: Array<{ lat?: number; lon?: number }> };
  const pages = (json as { query?: { pages?: Page[] } })?.query?.pages ?? [];
  return [...pages]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p) => {
      const c = p.coordinates?.[0];
      return p.title && typeof c?.lat === 'number' && typeof c.lon === 'number' ? [{ name: p.title, description: p.description, lat: c.lat, lon: c.lon }] : [];
    });
}

/** English Wikipedia page titles by Wikidata id, from `buildLabelsAndPagesUrl`. */
export function parsePages(json: unknown): Record<string, string> {
  const entities = (json as { entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }> })?.entities ?? {};
  return Object.fromEntries(Object.entries(entities).flatMap(([id, e]) => (e.sitelinks?.enwiki?.title ? [[id, e.sitelinks.enwiki.title]] : [])));
}

/** One person Wikipedia says is linked by influence to the one you're looking at. */
export interface InfluenceSuggestion {
  qid: string;
  label: string;
  /** English Wikipedia page key, when there is one, for "Add from Wikipedia". */
  pageKey?: string;
  /** 'by': they influenced this person. 'on': this person influenced them. */
  direction: 'by' | 'on';
  /** The entry already on the timeline, if any. */
  existingId?: string;
}

/** Person if Wikidata says human; a period if it has distinct start and end; otherwise an event. */
export function kindAndDates(f: WikidataFacts): { kind: ItemKind; start?: HistDate; end?: HistDate } {
  if (f.isHuman) return { kind: 'person', start: f.born, end: f.died };
  if (f.start && f.end && compareHistDate(f.end, f.start) > 0) return { kind: 'span', start: f.start, end: f.end };
  return { kind: 'event', start: f.pointInTime ?? f.start };
}

const capitalize = (s: string | undefined) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Assemble an unsaved entry from what Wikipedia and Wikidata said. */
export function buildDraft(args: {
  summary: WikiSummary;
  facts?: WikidataFacts;
  places?: Place[];
  existingSources: Source[];
  categoryId: string;
  today: string;
}): ItemDraft {
  const { summary, facts, existingSources, categoryId, today } = args;
  const reused = existingSources.find((s) => s.url === summary.pageUrl);
  const source: Source = reused ?? { id: newId('s'), kind: 'web', title: summary.title, authors: 'Wikipedia contributors', publisher: 'Wikipedia', url: summary.pageUrl, accessed: today, updatedAt: 0 };
  const { kind, start, end } = facts ? kindAndDates(facts) : { kind: 'event' as const, start: undefined, end: undefined };
  const places = args.places?.length ? args.places : summary.coords ? [{ name: summary.title, ...summary.coords, role: 'site' as const }] : undefined;
  const item: TimelineItem = {
    id: newId('i'),
    kind,
    title: summary.title,
    // The editor treats a missing start as "fill this in".
    start: start as HistDate,
    ...(end ? { end } : {}),
    categoryId,
    description: capitalize(summary.description),
    citations: [{ sourceId: source.id }],
    ...(places ? { places } : {}),
    ...(summary.qid ? { wikidataId: summary.qid } : {}),
    updatedAt: 0,
  };
  const highlight: Highlight | undefined = summary.extract
    ? { id: newId('h'), sourceId: source.id, text: summary.extract, ...(summary.qid ? { subjectQid: summary.qid } : {}), usedBy: [item.id], updatedAt: 0 }
    : undefined;
  return { item, newSources: reused ? [] : [source], ...(highlight ? { highlight } : {}) };
}

// ---------- Network ----------

/** Wikipedia and Wikidata answer 429 when asked too fast (a draft's labels and coordinates go at once), so wait and ask again, twice. */
const RETRY_MS = [1500, 4000];

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res = await fetch(url, { signal });
  for (const ms of RETRY_MS) {
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, ms));
    signal?.throwIfAborted();
    res = await fetch(url, { signal });
  }
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}. Try again in a moment.`);
  return res.json();
}

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<WikiSearchResult[]> {
  return parseSearch(await getJson(buildSearchUrl(query), signal));
}

export async function fetchSummary(key: string, signal?: AbortSignal): Promise<WikiSummary> {
  return parseSummary(await getJson(buildSummaryUrl(key), signal));
}

/** Places on Wikipedia matching a name, for the place picker. */
export async function lookUpPlace(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  return parsePlaceSearch(await getJson(buildPlaceSearchUrl(query), signal));
}

/** Places from Wikidata: the entity's own coordinates, or birth/death place, or location. */
async function fetchPlaces(f: WikidataFacts, signal?: AbortSignal): Promise<Place[]> {
  if (f.coords) return [{ ...f.coords, role: 'site' }];
  const wanted: Array<{ id: string; role: Place['role'] }> = f.isHuman
    ? [f.birthPlaceId && { id: f.birthPlaceId, role: 'born' as const }, f.deathPlaceId && { id: f.deathPlaceId, role: 'died' as const }].filter(Boolean) as Array<{ id: string; role: Place['role'] }>
    : f.locationId ? [{ id: f.locationId, role: 'site' }] : [];
  if (!wanted.length) return [];
  const [labels, ...coords] = await Promise.all([
    getJson(buildLabelsUrl([...new Set(wanted.map((w) => w.id))]), signal).then(parseLabels),
    ...wanted.map((w) => getJson(buildCoordsUrl(w.id), signal).then(parseCoords)),
  ]);
  return wanted.flatMap((w, i) => (coords[i] ? [{ name: (labels as Record<string, string>)[w.id], ...coords[i]!, role: w.role }] : []));
}

/** Who this person influenced, according to Wikidata. */
async function fetchInfluenced(qid: string, signal?: AbortSignal): Promise<string[]> {
  return parseInfluencedSearch(await getJson(buildInfluencedSearchUrl(qid), signal));
}

/** Wikidata allows 50 ids per wbgetentities call. */
async function fetchLabelsAndPages(qids: string[], signal?: AbortSignal): Promise<{ labels: Record<string, string>; pages: Record<string, string> }> {
  const chunks: string[][] = [];
  for (let i = 0; i < qids.length; i += 50) chunks.push(qids.slice(i, i + 50));
  const jsons = await Promise.all(chunks.map((c) => getJson(buildLabelsAndPagesUrl(c), signal)));
  return {
    labels: Object.assign({}, ...jsons.map(parseLabels)),
    pages: Object.assign({}, ...jsons.map(parsePages)),
  };
}

/** Influences in both directions for one person, matched against the timeline. */
export async function suggestInfluences(qid: string, existingItems: TimelineItem[], signal?: AbortSignal): Promise<InfluenceSuggestion[]> {
  const [facts, onIds] = await Promise.all([
    getJson(buildEntityUrl(qid), signal).then((j) => parseEntity(j, qid)),
    fetchInfluenced(qid, signal),
  ]);
  const byIds = facts.influencedByIds.filter((q) => q !== qid);
  const ons = [...new Set(onIds)].filter((q) => q !== qid);
  const all = [...new Set([...byIds, ...ons])];
  if (!all.length) return [];
  const { labels, pages } = await fetchLabelsAndPages(all, signal);
  const existing = new Map(existingItems.filter((i) => i.wikidataId).map((i) => [i.wikidataId!, i.id]));
  const make = (q: string, direction: 'by' | 'on'): InfluenceSuggestion => ({
    qid: q,
    label: labels[q] ?? pages[q] ?? q,
    ...(pages[q] ? { pageKey: pages[q].replace(/ /g, '_') } : {}),
    direction,
    ...(existing.has(q) ? { existingId: existing.get(q) } : {}),
  });
  return [...byIds.map((q) => make(q, 'by')), ...ons.map((q) => make(q, 'on'))];
}

/**
 * Fetch everything for one search result. If the entry is already on the
 * timeline (same Wikidata id), returns its id instead of a draft.
 */
export async function draftFromWikipedia(
  key: string,
  opts: { existingItems: TimelineItem[]; existingSources: Source[]; categoryId: string; today: string; signal?: AbortSignal },
): Promise<{ duplicateOf: string } | { draft: ItemDraft }> {
  const summary = await fetchSummary(key, opts.signal);
  const dup = summary.qid && opts.existingItems.find((i) => i.wikidataId === summary.qid);
  if (dup) return { duplicateOf: dup.id };
  let facts: WikidataFacts | undefined;
  let entity: ReturnType<typeof parseSubjectEntity>;
  let places: Place[] = [];
  if (summary.qid) {
    const json = await getJson(buildEntityUrl(summary.qid), opts.signal);
    facts = parseEntity(json, summary.qid);
    entity = parseSubjectEntity(json);
    places = await fetchPlaces(facts, opts.signal);
  }
  const draft = buildDraft({ summary, facts, places, existingSources: opts.existingSources, categoryId: opts.categoryId, today: opts.today });
  // Connections are a bonus too: what Wikidata says links the new entry to entries already on the timeline.
  if (entity) {
    let influenced: string[] = [];
    if (facts?.isHuman) {
      try {
        influenced = await fetchInfluenced(entity.qid, opts.signal);
      } catch {
        /* the other facts are still worth having */
      }
    }
    const relations = factRelations(draft.item.id, { ...entity.facts, influenced }, { items: opts.existingItems, relations: [] });
    if (relations.length) draft.relations = relations;
  }
  // The picture is a bonus: if Commons is slow or the file is odd, the entry is still worth having.
  if (facts?.imageFile) {
    try {
      const file = await fetchCommonsFile(facts.imageFile, opts.signal);
      if (file) draft.item.media = [resultToMedia({ ...file, description: summary.title })];
    } catch {
      /* keep the draft without a picture */
    }
  }
  return { draft };
}

/**
 * What an article is about: its Wikidata item, classified by walking its
 * classes up (usually no further than the item itself), and labels for its
 * facts. Undefined when the page has no Wikidata item. If the class walk or
 * the labels fail, the subject is still returned with what's known.
 */
export async function fetchSubject(title: string, signal?: AbortSignal): Promise<Subject | undefined> {
  const entity = parseSubjectEntity(await getJson(buildSubjectUrl(title), signal));
  if (!entity) return undefined;
  const parents: ClassParents = {};
  try {
    for (let need = classesToFetch(entity.classIds, parents); need.length; need = classesToFetch(entity.classIds, parents)) {
      Object.assign(parents, parseClassParents(await getJson(buildClassParentsUrl(need), signal), need));
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  let labels: Record<string, string> = {};
  const ids = linkedIds(entity.facts);
  try {
    if (ids.length) labels = parseLabels(await getJson(buildLabelsUrl(ids), signal));
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  return toSubject(entity, parents, labels);
}
