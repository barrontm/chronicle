import { toDecimalYear } from '../model/dates';
import type { HistDate, TerritorySnapshot } from '../model/types';

/**
 * Seshat's polity borders: the Cliopatria dataset (github.com/Seshat-Global-History-Databank/cliopatria,
 * CC BY 4.0), about 1,600 polities from 3400 BCE to 2024 CE. scripts/build-cliopatria.ts writes one
 * file per polity in public/data/borders/ and an index to find them; both are fetched when needed and
 * cached by the service worker once seen, never precached.
 */
export const CLIOPATRIA_CREDIT = {
  name: 'Cliopatria, Seshat Global History Databank (CC BY 4.0), simplified',
  url: 'https://github.com/Seshat-Global-History-Databank/cliopatria',
};

/** Whether a territory's borders came from Seshat. */
export const isCliopatria = (source?: { name: string }) => !!source?.name.startsWith('Cliopatria');

/** One polity in the index: what it's called and where and when its borders are. */
export interface CliopatriaPolity {
  /** Its file: public/data/borders/<id>.json. */
  id: string;
  name: string;
  /** A group of polities drawn together, named in brackets in Cliopatria: "(Macedonian Empire)". */
  group?: true;
  /** Wikidata ids and Wikipedia titles its rows give (usually one each). */
  wikidata: string[];
  wikipedia: string[];
  /** Each set of borders: from, to (astronomical, `to` the first year after) and its box in whole degrees, west, south, east, north. */
  rows: Array<[number, number, number, number, number, number]>;
}

export interface CliopatriaIndex {
  release: string;
  polities: CliopatriaPolity[];
}

export interface CliopatriaFile {
  id: string;
  name: string;
  snapshots: TerritorySnapshot[];
}

/** A name as the maps and Wikipedia might both spell it: no accents, case, "the" or "(ancient city)". */
export const plainName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*/g, ' ')
  .toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();

/** A Wikipedia title as written in a link or in Cliopatria: underscores or spaces, any first letter. */
const plainTitle = (s: string) => s.replace(/_/g, ' ').trim().toLowerCase();

/** What Bob's polity is known as: its Wikidata id, its Wikipedia article and its names. */
export interface WantedPolity {
  wikidataId?: string;
  titles?: string[];
  names: string[];
}

/** Years a polity's rows share with Bob's span (all its years when he has no dates). */
function overlap(p: CliopatriaPolity, s: number, e: number): number {
  return p.rows.reduce((n, [from, to]) => n + Math.max(0, Math.min(to, e) - Math.max(from, s)), 0);
}

/**
 * The polity in Cliopatria that Bob's means: by Wikidata id, else Wikipedia title, else name.
 * Only polities with borders in his polity's years count; among several, a single polity beats a
 * group of them, then the one with more years in common.
 */
export function matchCliopatria(index: CliopatriaIndex, wanted: WantedPolity, start?: HistDate, end?: HistDate): CliopatriaPolity | undefined {
  const s = start ? toDecimalYear(start) : -Infinity, e = end ? toDecimalYear(end) : Infinity;
  const alive = index.polities.filter((p) => !start || overlap(p, s, e) > 0);
  const titles = new Set((wanted.titles ?? []).map(plainTitle).filter(Boolean));
  const names = new Set(wanted.names.map(plainName).filter(Boolean));
  const tests: Array<(p: CliopatriaPolity) => boolean> = [
    (p) => !!wanted.wikidataId && p.wikidata.includes(wanted.wikidataId),
    (p) => p.wikipedia.some((t) => titles.has(plainTitle(t))),
    (p) => names.has(plainName(p.name)),
  ];
  const span = (p: CliopatriaPolity) => (start ? overlap(p, s, e) : p.rows.reduce((n, [from, to]) => n + to - from, 0));
  for (const test of tests) {
    const found = alive.filter(test);
    if (found.length) return found.sort((a, b) => Number(!!a.group) - Number(!!b.group) || span(b) - span(a))[0];
  }
  return undefined;
}

// ---------- Network ----------

const BORDERS = () => `${import.meta.env.BASE_URL}data/borders/`;
let index: Promise<CliopatriaIndex> | undefined;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seshat’s borders couldn’t be loaded (${res.status}). Try again in a moment.`);
  return (await res.json()) as T;
}

/** The index, once per session; the service worker keeps it for offline use. */
export function fetchCliopatriaIndex(): Promise<CliopatriaIndex> {
  if (!index) {
    index = getJson<CliopatriaIndex>(`${BORDERS()}index.json`);
    // Don't remember failures, so a retry after reconnecting works.
    index.catch(() => { index = undefined; });
  }
  return index;
}

export function fetchCliopatria(id: string): Promise<CliopatriaFile> {
  return getJson<CliopatriaFile>(`${BORDERS()}${id}.json`);
}
