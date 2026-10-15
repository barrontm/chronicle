import { compareHistDate, fromWikidataTime } from '../model/dates';
import { newId } from '../model/doc';
import type { HistDate, ItemKind, Place, Source, TimelineItem } from '../model/types';
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

// Wikidata properties and items we read.
const HUMAN = 'Q5';
const CIRCA = 'Q5727902';
const P = {
  instanceOf: 'P31', born: 'P569', died: 'P570', start: 'P580', end: 'P582', pointInTime: 'P585',
  inception: 'P571', dissolved: 'P576', coords: 'P625', image: 'P18', birthPlace: 'P19', deathPlace: 'P20',
  location: 'P276', circumstances: 'P1480',
} as const;

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
}

/** An entry ready for the editor, plus any sources it cites that aren't saved yet. */
export interface ItemDraft {
  item: TimelineItem;
  newSources: Source[];
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

/** Just the coordinates of one place, so we don't download a whole city's claims. */
export function buildCoordsUrl(qid: string): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetclaims', entity: qid, property: P.coords, format: 'json', origin: '*' })}`;
}

export function buildLabelsUrl(qids: string[]): string {
  return `${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', ids: qids.join('|'), props: 'labels', languages: 'en', format: 'json', origin: '*' })}`;
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

interface Snak { snaktype?: string; datavalue?: { value?: unknown } }
interface Claim { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }
type Claims = Record<string, Claim[] | undefined>;

/** Preferred-rank values first, then normal; deprecated values and "unknown value" are skipped. */
function claimsFor(claims: Claims, prop: string): Claim[] {
  const usable = (claims[prop] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
  const preferred = usable.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : usable;
}

const firstValue = <T>(claims: Claims, prop: string): T | undefined => claimsFor(claims, prop)[0]?.mainsnak?.datavalue?.value as T | undefined;

function dateClaim(claims: Claims, prop: string): HistDate | undefined {
  const c = claimsFor(claims, prop)[0];
  const v = c?.mainsnak?.datavalue?.value as { time?: string; precision?: number } | undefined;
  if (!v?.time) return undefined;
  const circa = (c?.qualifiers?.[P.circumstances] ?? []).some((q) => (q.datavalue?.value as { id?: string })?.id === CIRCA);
  return fromWikidataTime(v.time, v.precision ?? 9, circa) ?? undefined;
}

function coordsOf(claims: Claims): { lat: number; lon: number } | undefined {
  const v = firstValue<{ latitude: number; longitude: number }>(claims, P.coords);
  return v ? { lat: v.latitude, lon: v.longitude } : undefined;
}

const idOf = (claims: Claims, prop: string) => firstValue<{ id?: string }>(claims, prop)?.id;

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
    ...(summary.extract ? { excerpt: { text: summary.extract, sourceId: source.id } } : {}),
    ...(places ? { places } : {}),
    ...(summary.qid ? { wikidataId: summary.qid } : {}),
    updatedAt: 0,
  };
  return { item, newSources: reused ? [] : [source] };
}

// ---------- Network ----------

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}. Try again in a moment.`);
  return res.json();
}

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<WikiSearchResult[]> {
  return parseSearch(await getJson(buildSearchUrl(query), signal));
}

export async function fetchSummary(key: string, signal?: AbortSignal): Promise<WikiSummary> {
  return parseSummary(await getJson(buildSummaryUrl(key), signal));
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
  let places: Place[] = [];
  if (summary.qid) {
    facts = parseEntity(await getJson(buildEntityUrl(summary.qid), opts.signal), summary.qid);
    places = await fetchPlaces(facts, opts.signal);
  }
  const draft = buildDraft({ summary, facts, places, existingSources: opts.existingSources, categoryId: opts.categoryId, today: opts.today });
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
